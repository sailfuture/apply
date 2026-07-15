import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import { getDocumentStatus, getDocumentDownloadUrl } from "@/lib/pandadoc";

export async function GET(req: NextRequest) {
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

  const documentId = req.nextUrl.searchParams.get("documentId");
  const applicationId = req.nextUrl.searchParams.get("applicationId");
  const type = req.nextUrl.searchParams.get("type") as
    | "liability_waiver"
    | "enrollment_agreement"
    | null;
  // Optional — when present, the ownership lookup below uses the
  // server-side-filtered by-family query instead of a full-table scan.
  const yearId = Number(req.nextUrl.searchParams.get("yearId")) || null;

  if (!documentId) {
    return NextResponse.json(
      { error: "documentId is required" },
      { status: 400 }
    );
  }

  let doc;
  try {
    doc = await getDocumentStatus(documentId);
  } catch (err) {
    // PandaDoc-side errors come through as `PandaDoc status failed
    // (<code>): <body>`. The 404 case is structurally different from
    // every other failure: it means the envelope was deleted in the
    // PandaDoc dashboard, the doc id is permanently gone, and the
    // polling client should stop retrying. Surfacing it as 200 with
    // a `status: "missing"` sentinel lets the client distinguish
    // "doc is gone — stop polling" from "transient server error —
    // back off and retry," which the legacy 500 didn't allow. Any
    // other error still falls through to the 500 path below.
    if (err instanceof Error && /\(404\)/.test(err.message)) {
      return NextResponse.json({
        documentId,
        status: "missing",
        name: null,
      });
    }
    console.error("PandaDoc status error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to get status" },
      { status: 500 }
    );
  }

  try {
    const pandaStatus = doc.status;
    const normalizedStatus =
      pandaStatus === "document.completed"
        ? "completed"
        : pandaStatus === "document.viewed"
          ? "viewed"
          : pandaStatus === "document.sent"
            ? "sent"
            : pandaStatus === "document.draft"
              ? "draft"
              : pandaStatus;

    if (
      applicationId &&
      type &&
      (normalizedStatus === "completed" || normalizedStatus === "viewed")
    ) {
      const appId = Number(applicationId);
      // Ownership check — same pattern as the other PandaDoc routes.
      // Prefers the server-side-filtered by-family query when a
      // `yearId` is supplied, falling back to the full family list.
      const application = await xano.applications.findOwnedApp(
        familyId,
        appId,
        yearId
      );

      if (application) {
        if (type === "liability_waiver") {
          // Per-student — write to the packet
          // (`registration_student_registration`). Resolved-or-created
          // so a status callback for a doc the parent kicked off
          // before completing the rest of their packet still has a
          // row to land on.
          const packetRow = await xano.studentRegistration.resolve(
            application.registration_students_id,
            application.registration_school_years_id
          );
          // INTEGRITY GUARD: only sync when the polled `documentId` is
          // EXACTLY the envelope stored on this slot. The create route
          // persists the id before the client ever polls, so a
          // legitimate poll always matches; requiring an exact match
          // (rather than "matches OR slot is empty") also stops a
          // parent from marking a slot "completed" by polling with an
          // unrelated completed doc's id against a not-yet-started
          // slot.
          if (packetRow.liability_waiver_pandadoc_id !== documentId) {
            return NextResponse.json({
              documentId,
              status: normalizedStatus,
              name: doc.name,
            });
          }
          const wantCompleted = normalizedStatus === "completed";
          const hasUrl = !!packetRow.liability_waiver_pdf_url;
          const statusChanged =
            packetRow.liability_waiver_status !== normalizedStatus;
          // If status is not "completed" but a pdf_url is still
          // stored, the row is in a stale post-revert state — clear
          // the url alongside the status so downstream readers don't
          // keep serving the pre-revert bytes.
          if (statusChanged || (!wantCompleted && hasUrl)) {
            const updateData: Partial<
              import("@/lib/xano").XanoStudentRegistration
            > = {
              liability_waiver_status: normalizedStatus,
              liability_waiver_pdf_url: wantCompleted
                ? getDocumentDownloadUrl(documentId)
                : "",
            };
            await xano.studentRegistration.update(packetRow.id, updateData);
          }
        } else {
          // Enrollment agreement is family-level — write to the
          // registration progress row. Also latches `isEnrollment` when
          // the document is completed so the sidenav and enrolled
          // dashboard reflect it without a second PATCH.
          //
          // Downgrade handling (load-bearing): when PandaDoc reports
          // a non-completed status (e.g. admin voided/reopened the
          // envelope in the PandaDoc dashboard, sending it back to
          // `viewed`), clear the latches too. `isEnrollment` and
          // `is_enrollment_agreement_signed` are one-way booleans
          // that the signing page reads to decide whether to render
          // the signed PDF iframe — leaving them set after a revert
          // means the parent sees the (now-unsigned) PDF loaded as
          // if it were signed. The conditional also fires on
          // latch-drift (status already "viewed" in the DB but the
          // latch is still true from a prior completed state), so
          // a single status check repairs stale rows even when the
          // status field itself didn't change.
          const progressRow = await xano.studentRegistrationProgress.resolve(
            familyId,
            application.registration_school_years_id
          );
          // INTEGRITY GUARD (see the waiver branch): only sync when the
          // polled documentId is EXACTLY the envelope stored on this slot.
          if (progressRow.enrollment_agreement_pandadoc_id !== documentId) {
            return NextResponse.json({
              documentId,
              status: normalizedStatus,
              name: doc.name,
            });
          }
          const wantCompleted = normalizedStatus === "completed";
          const isLatched =
            progressRow.is_enrollment_agreement_signed === true ||
            progressRow.isEnrollment === true ||
            !!progressRow.enrollment_agreement_pdf_url;
          const statusChanged =
            progressRow.enrollment_agreement_status !== normalizedStatus;
          const latchMismatch = wantCompleted !== isLatched;
          if (statusChanged || latchMismatch) {
            const updateData: Partial<
              import("@/lib/xano").XanoStudentRegistrationProgress
            > = {
              enrollment_agreement_status: normalizedStatus,
              enrollment_agreement_pdf_url: wantCompleted
                ? getDocumentDownloadUrl(documentId)
                : "",
              is_enrollment_agreement_signed: wantCompleted,
              isEnrollment: wantCompleted,
            };
            await xano.studentRegistrationProgress.update(
              progressRow.id,
              updateData
            );
          }
        }
      }
    }

    return NextResponse.json({
      documentId,
      status: normalizedStatus,
      name: doc.name,
    });
  } catch (err) {
    console.error("PandaDoc status error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to get status" },
      { status: 500 }
    );
  }
}
