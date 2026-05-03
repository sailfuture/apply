import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

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
  const updated = await xano.parents.update(parentId, body);

  // Mirror name / email / phone into Clerk so the user's Clerk profile
  // (avatar initials, sign-out menu, sign-in identifier) matches what
  // they typed on the application. Only runs when the parent row has a
  // clerk_user_id (invited-but-not-signed-up parents have a pending
  // row with no Clerk linkage). Every Clerk call is wrapped so a single
  // failure doesn't fail the rest — the Xano write already succeeded
  // and we don't want a Clerk hiccup to roll the user's edit back. The
  // Clerk → Xano webhook reconciles any drift on the next user.updated
  // event.
  if (updated.clerk_user_id) {
    await syncParentToClerk(updated.clerk_user_id, body);
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
  if (emailRaw) {
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

  await xano.parents.delete(parentId);
  return NextResponse.json({ success: true }, { status: 200 });
}
