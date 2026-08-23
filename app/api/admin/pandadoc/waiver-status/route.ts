import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { getDocumentStatus, getDocumentDownloadUrl } from "@/lib/pandadoc";

/**
 * Pull a liability waiver's true state from PandaDoc and sync the
 * packet row.
 *
 *   POST /api/admin/pandadoc/waiver-status
 *   Body: { studentId: number, yearId: number }
 *
 * Exists because the webhook is the ONLY thing that carries a
 * signature back into the portal for an admin-emailed waiver, and a
 * single missed delivery strands it forever.
 *
 * The parent-side flow has a safety net: `/api/pandadoc/status` polls
 * while the signer sits in the embedded session, so a webhook that
 * never fires still gets reconciled on the next page load. That net
 * doesn't exist here. A parent who signs from a PandaDoc email never
 * opens the portal at all — nothing polls, and if the webhook is
 * misconfigured or drops the event, the card reads "Sent" forever
 * while PandaDoc holds a signed PDF.
 *
 * So the admin waiver card calls this itself whenever it renders a
 * pending envelope, plus on demand from its "Check for signature"
 * button. One PandaDoc read on an admin page view is cheap, and it
 * makes the portal's view of the waiver self-healing instead of
 * dependent on a delivery that already happened.
 *
 * Mirrors the write logic in `/api/pandadoc/status` exactly — same
 * id guard, same status normalization, same stale-PDF clearing — so
 * the two paths can't disagree about what a row should look like.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const studentId = Number(body?.studentId);
    const yearId = Number(body?.yearId);
    if (!Number.isFinite(studentId) || studentId <= 0) {
      return NextResponse.json(
        { error: "studentId is required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    // Read-only lookup — never `resolve()`. Checking a status
    // shouldn't mint a packet row for a student who doesn't have one.
    const packet = await xano.studentRegistration.getByStudentAndYear(
      studentId,
      yearId
    );
    const documentId = packet?.liability_waiver_pandadoc_id ?? "";
    if (!packet || !documentId) {
      return NextResponse.json({
        status: packet?.liability_waiver_status ?? "",
        documentId: null,
        changed: false,
      });
    }

    let doc;
    try {
      doc = await getDocumentStatus(documentId);
    } catch (err) {
      // 404 means the envelope is gone from PandaDoc (deleted in
      // their dashboard, or retired by a resend that then failed to
      // persist). Leaving the row on "Sent" points admin at a link
      // nobody can sign; clearing it drops the card back to Not
      // started so the Send button reads honestly.
      if (err instanceof Error && /\(404\)/.test(err.message)) {
        await xano.studentRegistration
          .update(packet.id, {
            liability_waiver_status: "",
            liability_waiver_pdf_url: "",
          })
          .catch(() => {});
        return NextResponse.json({
          status: "missing",
          documentId,
          changed: packet.liability_waiver_status !== "",
        });
      }
      throw err;
    }

    const normalizedStatus =
      doc.status === "document.completed"
        ? "completed"
        : doc.status === "document.viewed"
          ? "viewed"
          : doc.status === "document.sent"
            ? "sent"
            : doc.status === "document.draft"
              ? "draft"
              : doc.status;

    const wantCompleted = normalizedStatus === "completed";
    const statusChanged =
      packet.liability_waiver_status !== normalizedStatus;
    // A stored PDF url on a non-completed row is a stale post-revert
    // state — clear it alongside the status so nothing downstream
    // keeps serving the pre-revert bytes.
    const staleUrl = !wantCompleted && !!packet.liability_waiver_pdf_url;

    if (statusChanged || staleUrl) {
      await xano.studentRegistration.update(packet.id, {
        liability_waiver_status: normalizedStatus,
        liability_waiver_pdf_url: wantCompleted
          ? getDocumentDownloadUrl(documentId)
          : "",
      });
    }

    return NextResponse.json({
      status: normalizedStatus,
      documentId,
      changed: statusChanged || staleUrl,
    });
  } catch (err) {
    return handleAdminError(err);
  }
}
