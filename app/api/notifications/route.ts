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
    return NextResponse.json(
      {
        entries: [],
        read_at: 0,
        sms_number: "",
      } satisfies ParentNotificationsResponse,
      { status: 200 }
    );
  }

  // The message accessors already degrade to [] on failure, so a
  // missing table or transient Xano error yields an empty (not
  // broken) log. The family row (for the read watermark) is likewise
  // best-effort.
  const [emails, texts, family] = await Promise.all([
    xano.emailNotifications.getByFamily(familyId),
    xano.smsMessages.getByFamilyId(familyId),
    xano.families.getById(familyId).catch(() => null),
  ]);

  const entries: ParentNotificationEntry[] = [
    ...emails
      .filter((e) => e.status === "sent")
      .map((e) => ({
        key: `email-${e.id}`,
        kind: "email" as const,
        at: e.created_at,
        /** Audit-row id — pass to /api/notifications/email/[id] to
         *  load the full email content. Viewable when we stored the
         *  body ourselves OR Resend still has it; null when neither. */
        email_id: (e.html ?? "").trim() || e.resend_id ? e.id : null,
        subject: e.subject || "(no subject)",
        recipients: e.recipient_emails || "",
        body: null,
        direction: "outbound" as const,
      })),
    ...texts.map((t) => ({
      key: `sms-${t.id}`,
      kind: "sms" as const,
      at: t.created_at,
      email_id: null,
      subject: null,
      recipients: "",
      body: t.body || "",
      direction: t.direction === "inbound" ? ("inbound" as const) : ("outbound" as const),
    })),
  ].sort((a, b) => b.at - a.at);

  // The number to tell parents to text back. Prefer the one THIS
  // family actually received texts from (their thread's most recent
  // outbound `from_number`) — sends route through a Twilio Messaging
  // Service whose pool can hold more than one number, so the env var
  // is only a fallback for families with no texts yet.
  const lastOutbound = [...texts]
    .reverse()
    .find((t) => t.direction !== "inbound" && t.from_number);
  const smsNumber =
    lastOutbound?.from_number || process.env.TWILIO_PHONE_NUMBER || "";

  return NextResponse.json({
    entries,
    read_at: family?.notifications_read_at ?? 0,
    sms_number: smsNumber,
  } satisfies ParentNotificationsResponse);
}

export interface ParentNotificationEntry {
  key: string;
  kind: "email" | "sms";
  /** Unix ms. */
  at: number;
  /** Audit-row id for the email-content viewer; null = not viewable. */
  email_id: number | null;
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
  /** Family-level read watermark (unix ms; 0 = never marked). */
  read_at: number;
  /** E.164 number the school texts this family from — what they
   *  reply to. "" when unknown (no texts yet and no env fallback). */
  sms_number: string;
}
