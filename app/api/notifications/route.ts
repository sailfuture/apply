import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * The authenticated family's communications log — every email the
 * school sent them (from the `registration_email_notifications`
 * audit) merged with their SMS thread (`sms_messages`), newest
 * first.
 *
 * Parent-safe view: failed / dry-run email attempts and internal
 * bookkeeping (Resend ids, Twilio sids, admin error messages) are
 * not exposed; texts include both directions since it's the
 * family's own conversation.
 */
export async function GET() {
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
    return NextResponse.json({ entries: [] }, { status: 200 });
  }

  // Both accessors already degrade to [] on failure, so a missing
  // table or transient Xano error yields an empty (not broken) log.
  const [emails, texts] = await Promise.all([
    xano.emailNotifications.getByFamily(familyId),
    xano.smsMessages.getByFamilyId(familyId),
  ]);

  const entries: ParentNotificationEntry[] = [
    ...emails
      .filter((e) => e.status === "sent")
      .map((e) => ({
        key: `email-${e.id}`,
        kind: "email" as const,
        at: e.created_at,
        subject: e.subject || "(no subject)",
        recipients: e.recipient_emails || "",
        body: null,
        direction: "outbound" as const,
      })),
    ...texts.map((t) => ({
      key: `sms-${t.id}`,
      kind: "sms" as const,
      at: t.created_at,
      subject: null,
      recipients: "",
      body: t.body || "",
      direction: t.direction === "inbound" ? ("inbound" as const) : ("outbound" as const),
    })),
  ].sort((a, b) => b.at - a.at);

  return NextResponse.json({ entries });
}

export interface ParentNotificationEntry {
  key: string;
  kind: "email" | "sms";
  /** Unix ms. */
  at: number;
  /** Email subject (email entries only). */
  subject: string | null;
  /** Comma-separated recipient list (email entries only). */
  recipients: string;
  /** Message text (SMS entries only). */
  body: string | null;
  /** "outbound" = school → family; "inbound" = the family's reply. */
  direction: "outbound" | "inbound";
}

export interface ParentNotificationsResponse {
  entries: ParentNotificationEntry[];
}
