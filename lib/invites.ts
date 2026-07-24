import { clerkClient } from "@clerk/nextjs/server";
import { xano, type XanoParent } from "@/lib/xano";

/**
 * Shared logic behind the "Resend invite" safety button on
 * secondary parent / guardian contacts.
 *
 * The auto-invite on add (parent-side `/api/invites` + admin-side
 * `/api/admin/parents`) is best-effort — the Clerk `createInvitation`
 * call is wrapped in a try/catch that only logs — so an invite can
 * silently fail and leave a parent stuck at `invite_status: "pending"`
 * with no email ever delivered. This module is the manual recovery
 * path: it (re)sends the invitation for an EXISTING row.
 *
 * Two invariants make it safe to click repeatedly (the user asked
 * that we "not make it possible to send invites more than once —
 * we don't want parent duplicates"):
 *
 *   1. It never creates a `registration_parents` row. It only ever
 *      operates on a row that already exists, so it cannot fan out
 *      into duplicate parents no matter how many times it runs.
 *   2. It never stacks Clerk invitations. Before sending a fresh one
 *      it revokes any pending invitation already on file for the
 *      email, so Clerk only ever holds a single live invite per
 *      contact.
 *
 * It also self-heals: if a Clerk account already exists for the email
 * but our row never got its `clerk_user_id` stamped (e.g. a missed
 * `user.created` webhook), it links the account and flips the row to
 * "active" instead of pointlessly re-inviting.
 */

/** Outcome of a resend attempt. `status` mirrors the parent row's
 *  `invite_status` after the call. */
export type ResendInviteResult = {
  status: "active" | "pending";
  /** Human-readable summary for the client toast. */
  message: string;
  /** True when a fresh invitation email actually went out this call. */
  emailSent: boolean;
};

/** Thrown for caller-fixable problems (missing email, Clerk down).
 *  Carries the HTTP status the route should surface. */
export class InviteError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "InviteError";
    this.status = status;
  }
}

/** Build the `/sign-up` redirect with name + email pre-filled, matching
 *  the auto-invite flows so the resent link lands on the same populated
 *  form. */
function buildSignUpRedirect(
  parent: Pick<XanoParent, "first_name" | "last_name" | "email">
): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const params = new URLSearchParams();
  if (parent.first_name) params.set("firstName", parent.first_name);
  if (parent.last_name) params.set("lastName", parent.last_name);
  if (parent.email) params.set("email", parent.email);
  const qs = params.toString();
  return `${appUrl}/sign-up${qs ? `?${qs}` : ""}`;
}

/**
 * (Re)send a Clerk invitation for an existing parent/guardian row.
 * See the module doc for the safety invariants. Guards run in order:
 *
 *   1. No email on file            → InviteError(400)
 *   2. Row already linked to Clerk → "active" (nothing to send)
 *   3. Clerk account exists for the
 *      email but row not linked     → link + "active", no email
 *   4. Otherwise                    → revoke stale pending invite(s),
 *                                      send a fresh one → "pending"
 */
export async function resendParentInvite(
  parent: XanoParent
): Promise<ResendInviteResult> {
  const email = (parent.email ?? "").trim();
  if (!email) {
    throw new InviteError(
      "This contact has no email address on file, so there's nothing to invite. Add an email first.",
      400
    );
  }

  // Guard 2 — the row already carries its Clerk linkage, so the
  // contact has accepted. The button hides in this state; this is the
  // server-side mirror of that guard.
  if (parent.clerk_user_id) {
    return {
      status: "active",
      message: "This contact has already accepted their invitation.",
      emailSent: false,
    };
  }

  const clerk = await clerkClient();

  // Guard 3 — self-heal. A Clerk user may already exist for this email
  // even though our row's `clerk_user_id` is blank (missed webhook,
  // account made directly in Clerk). Re-inviting would just error
  // ("email taken by an existing user"), so adopt the account instead.
  let existingUserId = "";
  try {
    const users = await clerk.users.getUserList({
      emailAddress: [email],
      limit: 1,
    });
    existingUserId = users.data[0]?.id ?? "";
  } catch (err) {
    // Non-fatal — fall through to the invitation path. Worst case the
    // createInvitation below throws and we surface a retryable error.
    console.error("[resendParentInvite] getUserList failed:", err);
  }

  if (existingUserId) {
    await xano.parents.update(parent.id, {
      clerk_user_id: existingUserId,
      invite_status: "active",
    });
    return {
      status: "active",
      message: "This contact already has an account — marked active.",
      emailSent: false,
    };
  }

  // Guard 4 — revoke any pending invitation for this email so we never
  // leave two live invites outstanding, then send a fresh one.
  try {
    const pending = await clerk.invitations.getInvitationList({
      query: email,
      status: "pending",
    });
    for (const inv of pending.data) {
      if (inv.emailAddress.toLowerCase() !== email.toLowerCase()) continue;
      try {
        await clerk.invitations.revokeInvitation(inv.id);
      } catch (err) {
        console.error(
          `[resendParentInvite] revoke invitation ${inv.id} failed:`,
          err
        );
      }
    }
  } catch (err) {
    // Non-fatal — `ignoreExisting: true` below still lets the fresh
    // send succeed even if a stale invite lingers.
    console.error("[resendParentInvite] getInvitationList failed:", err);
  }

  try {
    await clerk.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: buildSignUpRedirect({
        first_name: parent.first_name,
        last_name: parent.last_name,
        email,
      }),
      // Belt-and-suspenders: if a revoke above raced or was missed,
      // don't hard-fail on a duplicate — Clerk refreshes instead of
      // erroring. Still one live invite per email.
      ignoreExisting: true,
    });
  } catch (err) {
    console.error("[resendParentInvite] createInvitation failed:", err);
    throw new InviteError(
      "Clerk couldn't send the invitation just now. Please try again in a moment.",
      502
    );
  }

  // Keep the row's status coherent. It should already be "pending",
  // but older / hand-edited rows may carry a blank or stale value.
  if (parent.invite_status !== "pending") {
    try {
      await xano.parents.update(parent.id, { invite_status: "pending" });
    } catch (err) {
      console.error("[resendParentInvite] status sync failed:", err);
    }
  }

  return {
    status: "pending",
    message: "Invitation sent.",
    emailSent: true,
  };
}
