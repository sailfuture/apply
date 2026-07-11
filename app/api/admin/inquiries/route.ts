import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Admin list of registration inquiries, annotated with a computed
 * `hasParentAccount` flag: true when the inquiry's email matches a
 * registered parent account (case-insensitive). The UI renders it as
 * an "applied?" hint badge — a suggestion only, not the source of
 * truth, because inquiry emails are unreliable (typos, placeholder
 * addresses, parents who apply under a different email). Admin
 * confirms by explicitly marking the inquiry converted.
 */
export async function GET() {
  try {
    await requireAdmin();
    const [inquiries, parentEmails, inquiryNotes] = await Promise.all([
      xano.inquiries.getAll(),
      // Suggestion-only data — if the parents fetch fails, ship the
      // list without badges rather than failing the whole page.
      xano.parents
        .getAll()
        .then(
          (parents) =>
            new Set(
              parents
                .map((p) => (p.email ?? "").trim().toLowerCase())
                .filter(Boolean)
            )
        )
        .catch(() => new Set<string>()),
      // Last-note previews are a nice-to-have — never fail the list if
      // the notes fetch dies (returns [] internally on error too).
      xano.adminNotes.getAllInquiryNotes().catch(() => []),
    ]);

    // Most-recent note per inquiry, by creation time. Single pass over
    // the flat notes list — the inquiries table renders `last_note` as
    // a truncated one-line preview (see the "Last note" column).
    const latestNote = new Map<number, { body: string; created_at: number }>();
    for (const n of inquiryNotes) {
      const id = n.registration_inquiry_id;
      if (id == null) continue;
      const prev = latestNote.get(id);
      if (!prev || n.created_at > prev.created_at) {
        latestNote.set(id, { body: n.body, created_at: n.created_at });
      }
    }

    const annotated = inquiries.map((i) => {
      const note = latestNote.get(i.id);
      return {
        ...i,
        hasParentAccount: Boolean(
          i.primary_email &&
            parentEmails.has(i.primary_email.trim().toLowerCase())
        ),
        // Body + timestamp of the newest note logged on this inquiry;
        // null when nothing's been logged yet. The client truncates the
        // body and sorts the column on the timestamp.
        last_note: note?.body ?? null,
        last_note_at: note?.created_at ?? null,
      };
    });
    return NextResponse.json(annotated);
  } catch (err) {
    return handleAdminError(err);
  }
}
