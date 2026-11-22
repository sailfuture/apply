import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { getFamilyAuth } from "@/lib/family-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import { smsConsentParentFields } from "@/lib/sms/consent";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const familyId = user.publicMetadata.registration_families_id as
    | number
    | undefined;
  if (!familyId) {
    return NextResponse.json({ error: "No family found" }, { status: 400 });
  }

  const family = await xano.families.getById(familyId);
  const parentIds = xano.families.getParentIds(family);
  const { id } = await params;
  const parentId = Number(id);

  if (!parentIds.includes(parentId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();

  // `sms_consent` is a VIRTUAL field from the apply-flow consent
  // checkbox — never written to Xano as-is. It maps to the real
  // consent columns via the shared helper, and only for the caller's
  // OWN parent row: express SMS consent is personal, so one parent
  // can't consent (or decline) on another adult's behalf. For any
  // other row the field is dropped silently — the UI only renders the
  // checkbox on the signed-in parent's card, so a mismatch here is a
  // stale/hand-crafted request, not a user action.
  const {
    sms_consent: smsConsentRaw,
    // Sent by the confirmation dialog only; never a column.
    confirm_email_change: confirmEmailChange,
    ...fields
  } = body ?? {};
  const target = await xano.parents.getById(parentId);
  const isOwnRow = !!target?.clerk_user_id && target.clerk_user_id === userId;
  const targetHasAccount = !!target?.clerk_user_id;

  // A guardian's email is also their SIGN-IN email once they have an
  // account. Another parent on the family must not be able to change
  // it: this route used to accept the edit and re-point that person's
  // login (unverified) — and the registration step re-saves every
  // parent on the family whenever anything on the page changes. For a
  // row that belongs to someone else's account the email is dropped
  // here; their own edits, and edits to an invited parent who has not
  // signed up yet, go through as before.
  if (targetHasAccount && !isOwnRow) {
    delete fields.email;
  }

  // The account holder changing their OWN sign-in email must have
  // confirmed it (the forms show a dialog and then send
  // `confirm_email_change: true`). The forms also save every field on a
  // timer and on blur, so without this a half-typed or mistyped address
  // became the sign-in email with no question asked. An unconfirmed
  // change is simply not applied; the rest of the save goes through.
  if (isOwnRow && typeof fields.email === "string") {
    const next = fields.email.trim().toLowerCase();
    const current = (target?.email ?? "").trim().toLowerCase();
    if (next !== current && confirmEmailChange !== true) {
      delete fields.email;
    }
  }

  // An incomplete address (the forms save while the parent is still
  // typing) is refused here with a message. Xano rejects it anyway, and
  // that used to surface as an unexplained 500.
  if (
    typeof fields.email === "string" &&
    fields.email.trim() !== "" &&
    !LOOKS_LIKE_EMAIL.test(fields.email.trim())
  ) {
    return NextResponse.json(
      { error: "Please enter a complete email address." },
      { status: 400 }
    );
  }

  let patch: Record<string, unknown> = fields;
  if (typeof smsConsentRaw === "boolean" && isOwnRow) {
    patch = { ...fields, ...smsConsentParentFields(smsConsentRaw) };
  }

  const updated = await xano.parents.update(parentId, patch);

  // Mirror name / email / phone into Clerk so the user's Clerk profile
  // (avatar initials, sign-out menu, sign-in identifier) matches what
  // they typed on the application. Only runs when the parent row has a
  // clerk_user_id (invited-but-not-signed-up parents have a pending
  // row with no Clerk linkage). Every Clerk call is wrapped so a single
  // failure doesn't fail the rest — the Xano write already succeeded
  // and we don't want a Clerk hiccup to roll the user's edit back. The
  // Clerk → Xano webhook reconciles any drift on the next user.updated
  // event.
  //
  // The sign-in identifiers (email, phone) are only ever mirrored from
  // the account holder's own edit. Someone else filling in a guardian's
  // phone number updates the contact record, not that person's login.
  if (updated.clerk_user_id) {
    const clerkBody: Record<string, unknown> = { ...fields };
    if (!isOwnRow) {
      delete clerkBody.email;
      delete clerkBody.phone;
    }
    await syncParentToClerk(updated.clerk_user_id, clerkBody);
  }

  return NextResponse.json(updated, { status: 200 });
}

/**
 * Push first/last name + primary email + primary phone updates from a
 * Xano parent row into the matching Clerk user. Each sync is independent
 * and best-effort — failures log but don't throw, so a partial sync still
 * gets as much through as possible. Email and phone are added via the
 * dedicated Clerk collections (you can't change them via `updateUser`)
 * and marked verified + primary so the parent stays signed in.
 */
/** A complete-looking address: something@something.tld, no spaces. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function syncParentToClerk(
  clerkUserId: string,
  body: Record<string, unknown>
): Promise<void> {
  const clerk = await clerkClient();

  // Name — `updateUser` accepts these directly.
  const namePatch: { firstName?: string; lastName?: string } = {};
  if (typeof body.first_name === "string") namePatch.firstName = body.first_name;
  if (typeof body.last_name === "string") namePatch.lastName = body.last_name;
  if (namePatch.firstName !== undefined || namePatch.lastName !== undefined) {
    try {
      await clerk.users.updateUser(clerkUserId, namePatch);
    } catch (err) {
      console.error(`Failed to sync name to Clerk user ${clerkUserId}:`, err);
    }
  }

  // Email — only runs when the field is present + non-empty + actually
  // different from the current Clerk primary. We add the new address as
  // verified + primary, then remove the old primary so the user has
  // exactly one email on file. Skipping verification keeps the user
  // signed in; we trust the form input since the parent typed it.
  const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  // Only a complete address may become the sign-in email. The forms
  // autosave while the parent is still typing, and a half-typed value
  // ("jane@gm") used to be written to Clerk as a verified primary.
  if (emailRaw && !LOOKS_LIKE_EMAIL.test(emailRaw)) {
    console.warn(
      `Not mirroring an incomplete email to Clerk user ${clerkUserId}.`
    );
  } else if (emailRaw) {
    try {
      const user = await clerk.users.getUser(clerkUserId);
      const currentPrimary = user.emailAddresses.find(
        (e) => e.id === user.primaryEmailAddressId
      );
      const currentPrimaryEmail = currentPrimary?.emailAddress?.toLowerCase() ?? "";
      if (emailRaw !== currentPrimaryEmail) {
        const created = await clerk.emailAddresses.createEmailAddress({
          userId: clerkUserId,
          emailAddress: emailRaw,
          verified: true,
          primary: true,
        });
        // Remove the old primary so the account doesn't accumulate stale
        // emails. Best-effort — leaving it around isn't fatal.
        if (currentPrimary && currentPrimary.id !== created.id) {
          try {
            await clerk.emailAddresses.deleteEmailAddress(currentPrimary.id);
          } catch (err) {
            console.error(
              `Failed to remove old Clerk email ${currentPrimary.id}:`,
              err
            );
          }
        }
      }
    } catch (err) {
      console.error(`Failed to sync email to Clerk user ${clerkUserId}:`, err);
    }
  }

  // Phone — same pattern as email. Strip non-digits + add E.164 leading
  // "+" since Clerk requires E.164 format. We assume US numbers (10 or
  // 11 digits with leading 1); other formats fall through to whatever
  // the user typed.
  const phoneRaw = typeof body.phone === "string" ? body.phone : "";
  const phoneE164 = toE164(phoneRaw);
  if (phoneE164) {
    try {
      const user = await clerk.users.getUser(clerkUserId);
      const currentPrimary = user.phoneNumbers.find(
        (p) => p.id === user.primaryPhoneNumberId
      );
      const currentPrimaryPhone = currentPrimary?.phoneNumber ?? "";
      if (phoneE164 !== currentPrimaryPhone) {
        const created = await clerk.phoneNumbers.createPhoneNumber({
          userId: clerkUserId,
          phoneNumber: phoneE164,
          verified: true,
          primary: true,
        });
        if (currentPrimary && currentPrimary.id !== created.id) {
          try {
            await clerk.phoneNumbers.deletePhoneNumber(currentPrimary.id);
          } catch (err) {
            console.error(
              `Failed to remove old Clerk phone ${currentPrimary.id}:`,
              err
            );
          }
        }
      }
    } catch (err) {
      console.error(`Failed to sync phone to Clerk user ${clerkUserId}:`, err);
    }
  }
}

/** Best-effort US phone → E.164. Returns "" when the input doesn't look
 *  like a US phone (Clerk rejects non-E.164 anyway, so we'd rather skip
 *  than send garbage). */
function toE164(raw: string): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getFamilyAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { familyId } = session;
  if (!familyId) {
    return NextResponse.json({ error: "No family found" }, { status: 400 });
  }

  const family = await xano.families.getById(familyId);
  const parentIds = xano.families.getParentIds(family);
  const { id } = await params;
  const parentId = Number(id);

  if (!parentIds.includes(parentId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await xano.parents.delete(parentId);
  return NextResponse.json({ success: true }, { status: 200 });
}
