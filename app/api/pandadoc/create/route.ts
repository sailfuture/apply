import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import type { User } from "@clerk/nextjs/server";
import { xano } from "@/lib/xano";
import {
  createDocumentFromTemplate,
  sendDocument,
  createSigningSession,
  getDocumentStatus,
  getDocumentDetails,
  getDocumentDownloadUrl,
  getTemplateId,
  getTemplateRole,
  waitForDocumentStatus,
} from "@/lib/pandadoc";

// The create chain does real PandaDoc work (create-from-template →
// wait-for-draft → send → session). Give the function room so a slow
// template can't be killed mid-flight and orphan an envelope.
export const maxDuration = 60;

type DocType = "liability_waiver" | "enrollment_agreement";

interface CreateResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * In-flight guard per (family, type, application). Two tabs open on
 * the auto-initiating waiver/enrollment page, a refresh mid-create, or
 * a retry after a slow response would otherwise each mint a NEW
 * PandaDoc envelope (the doc id is only persisted at the end of the
 * chain). Collapsing concurrent calls onto one promise means at most
 * one envelope is created per burst.
 */
const inFlight = new Map<string, Promise<CreateResult>>();

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const familyId = Number(user.publicMetadata.registration_families_id);
  if (!familyId) {
    return NextResponse.json({ error: "No family found" }, { status: 400 });
  }

  const { type, applicationId, yearId } = await req.json();
  if (!type || !["liability_waiver", "enrollment_agreement"].includes(type)) {
    return NextResponse.json(
      { error: "type must be 'liability_waiver' or 'enrollment_agreement'" },
      { status: 400 }
    );
  }
  if (!applicationId) {
    return NextResponse.json(
      { error: "applicationId is required" },
      { status: 400 }
    );
  }

  const key = `${familyId}:${type}:${applicationId}`;
  let run = inFlight.get(key);
  if (!run) {
    run = doCreate(
      user,
      familyId,
      type as DocType,
      Number(applicationId),
      Number(yearId) || null
    )
      .catch((err): CreateResult => {
        console.error("PandaDoc create error:", err);
        return {
          status: 500,
          body: {
            error:
              err instanceof Error ? err.message : "Failed to create document",
          },
        };
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, run);
  }
  const result = await run;
  return NextResponse.json(result.body, { status: result.status });
}

async function doCreate(
  user: User,
  familyId: number,
  type: DocType,
  applicationId: number,
  yearId: number | null
): Promise<CreateResult> {
  // Ownership check. When the client passes the year (it always has
  // `app.registration_school_years_id`), this resolves via the
  // server-side-filtered by-family query instead of downloading the
  // whole applications table; falls back to the unfiltered list on a
  // miss so a legacy row can't lock the parent out.
  const application = await xano.applications.findOwnedApp(
    familyId,
    applicationId,
    yearId
  );
  if (!application) {
    return {
      status: 404,
      body: { error: "Application not found for this family" },
    };
  }

  // These three lookups only depend on `application`, so run them
  // together instead of the previous four-deep waterfall:
  //   - the target row this doc type lives on (packet for the waiver,
  //     family progress row for the agreement) — resolved-or-created
  //   - the family (for the doc name + tokens)
  //   - the student (for the doc name + fields)
  const [targetRow, family, student] = await Promise.all([
    type === "liability_waiver"
      ? xano.studentRegistration.resolve(
          application.registration_students_id,
          application.registration_school_years_id
        )
      : xano.studentRegistrationProgress.resolve(
          familyId,
          application.registration_school_years_id
        ),
    xano.families.getById(familyId),
    xano.students.getById(application.registration_students_id),
  ]);
  const packetRow = type === "liability_waiver" ? targetRow : null;
  const progressRow = type === "enrollment_agreement" ? targetRow : null;

  const pandadocIdField =
    type === "liability_waiver"
      ? "liability_waiver_pandadoc_id"
      : "enrollment_agreement_pandadoc_id";
  const existingDocId = (targetRow as unknown as Record<string, unknown>)[
    pandadocIdField
  ] as string | null;

  const recipientEmail = user.emailAddresses[0]?.emailAddress ?? "";
  const recipientFirstName = user.firstName ?? "";
  const recipientLastName = user.lastName ?? "";

  const expectedDocName =
    type === "liability_waiver"
      ? `Liability Waiver – ${student.first_name} ${student.last_name}`
      : `Enrollment Agreement – ${family.family_name}`;

  // Sync a locally-known row to "completed" — used when PandaDoc says
  // the envelope is already signed but our row hasn't caught up. This
  // is the load-bearing fix for the "signed signature silently wiped"
  // bug: the old code treated a completed doc as non-resumable and
  // fell through to wipe + recreate, destroying the signature record.
  const syncCompleted = async (docId: string) => {
    const pdfUrl = getDocumentDownloadUrl(docId);
    if (type === "enrollment_agreement" && progressRow) {
      await xano.studentRegistrationProgress
        .update(progressRow.id, {
          enrollment_agreement_status: "completed",
          enrollment_agreement_pdf_url: pdfUrl,
          is_enrollment_agreement_signed: true,
          isEnrollment: true,
        })
        .catch(() => {});
    } else if (type === "liability_waiver" && packetRow) {
      await xano.studentRegistration
        .update(packetRow.id, {
          liability_waiver_status: "completed",
          liability_waiver_pdf_url: pdfUrl,
        })
        .catch(() => {});
    }
  };

  // Wipe stale metadata so the fresh-create path writes onto a clean
  // row. ONLY called when the envelope is genuinely unusable (deleted,
  // voided, declined) — never for a completed doc.
  const wipeStaleMetadata = async () => {
    if (type === "enrollment_agreement" && progressRow) {
      await xano.studentRegistrationProgress
        .update(progressRow.id, {
          enrollment_agreement_pandadoc_id: "",
          enrollment_agreement_status: "",
          enrollment_agreement_sent: null,
          enrollment_agreement_pdf_url: "",
          is_enrollment_agreement_signed: false,
          isEnrollment: false,
        })
        .catch(() => {});
    } else if (type === "liability_waiver" && packetRow) {
      await xano.studentRegistration
        .update(packetRow.id, {
          liability_waiver_pandadoc_id: "",
          liability_waiver_status: "",
          liability_waiver_sent_at: null,
          liability_waiver_pdf_url: "",
        })
        .catch(() => {});
    }
  };

  if (existingDocId) {
    const RESUMABLE_STATUSES = new Set([
      "document.draft",
      "document.sent",
      "document.viewed",
      "document.waiting_approval",
    ]);
    try {
      const existing = await getDocumentStatus(existingDocId);

      // SIGNED-BUT-UNSYNCED: the parent completed the doc but a poll
      // tick never landed to sync our row (they closed the tab). Never
      // recreate — sync the completion and tell the client it's done.
      if (existing.status === "document.completed") {
        await syncCompleted(existingDocId);
        return {
          status: 200,
          body: { documentId: existingDocId, completed: true },
        };
      }

      if (RESUMABLE_STATUSES.has(existing.status)) {
        const normalize = (s: string | undefined) =>
          (s ?? "").trim().toLowerCase();
        const titleMatches =
          normalize(existing.name) === normalize(expectedDocName);
        let canResume = titleMatches;
        if (titleMatches) {
          try {
            const details = await getDocumentDetails(existingDocId);
            const recipient = details.recipients?.[0];
            const nameMatches =
              normalize(recipient?.first_name) ===
                normalize(recipientFirstName) &&
              normalize(recipient?.last_name) === normalize(recipientLastName);
            const signerEmail = normalize(recipientEmail);
            const recipientEmailNorm = normalize(recipient?.email);
            const emailMatches =
              !signerEmail ||
              !recipientEmailNorm ||
              recipientEmailNorm === signerEmail;
            canResume = nameMatches && emailMatches;
          } catch {
            // Can't verify → prefer a fresh envelope over a stale one.
            canResume = false;
          }
        }
        if (canResume) {
          try {
            const sessionId = await createSigningSession(
              existingDocId,
              recipientEmail
            );
            return {
              status: 200,
              body: { documentId: existingDocId, sessionId, resumed: true },
            };
          } catch {
            // Resume failed despite a resumable status — treat as gone.
            await wipeStaleMetadata();
          }
        } else {
          await wipeStaleMetadata();
        }
      } else {
        // Declined / voided / expired — unusable, recreate.
        await wipeStaleMetadata();
      }
    } catch {
      // 404 / network — the envelope is gone. Wipe + recreate.
      await wipeStaleMetadata();
    }
  }

  // ── Fresh create ──────────────────────────────────────────────────
  const templateId = getTemplateId(type);
  const doc = await createDocumentFromTemplate({
    templateId,
    name: expectedDocName,
    recipientEmail,
    recipientFirstName,
    recipientLastName,
    role: getTemplateRole(type),
    // Echoed on every webhook event — lets /api/webhooks/pandadoc map
    // a completion straight to the owning Xano row.
    metadata: {
      family_id: String(familyId),
      year_id: String(application.registration_school_years_id),
      student_id: String(application.registration_students_id),
      doc_type: type,
    },
    tokens: {
      "family.name": family.family_name,
      "student.first_name": student.first_name,
      "student.last_name": student.last_name,
      "student.full_name": `${student.first_name} ${student.last_name}`,
      "parent.first_name": recipientFirstName,
      "parent.last_name": recipientLastName,
      "parent.email": recipientEmail,
    },
    fields: {
      parent_first_name: recipientFirstName,
      parent_last_name: recipientLastName,
      parent_full_name: `${recipientFirstName} ${recipientLastName}`.trim(),
      parent_name: `${recipientFirstName} ${recipientLastName}`.trim(),
      parent_email: recipientEmail,
      "parent.first_name": recipientFirstName,
      "parent.last_name": recipientLastName,
      "parent.full_name": `${recipientFirstName} ${recipientLastName}`.trim(),
      "parent.email": recipientEmail,
      student_first_name: student.first_name,
      student_last_name: student.last_name,
      student_full_name: `${student.first_name} ${student.last_name}`,
      student_name: `${student.first_name} ${student.last_name}`,
      "student.first_name": student.first_name,
      "student.last_name": student.last_name,
      "student.full_name": `${student.first_name} ${student.last_name}`,
      participant_name: `${student.first_name} ${student.last_name}`,
      participant_first_name: student.first_name,
      participant_last_name: student.last_name,
      "Participant Name": `${student.first_name} ${student.last_name}`,
      family_name: family.family_name,
      "family.name": family.family_name,
    },
  });

  // Persist the doc id IMMEDIATELY (status "draft"), before the
  // wait/send/session chain. If the function times out or a later step
  // throws, the id is already on the row — the next visit resumes this
  // envelope instead of orphaning it and creating another.
  if (type === "enrollment_agreement" && progressRow) {
    await xano.studentRegistrationProgress
      .update(progressRow.id, {
        enrollment_agreement_pandadoc_id: doc.id,
        enrollment_agreement_status: "draft",
      })
      .catch((err) =>
        console.error("[pandadoc/create] early id persist failed:", err)
      );
  } else if (type === "liability_waiver" && packetRow) {
    await xano.studentRegistration
      .update(packetRow.id, {
        liability_waiver_pandadoc_id: doc.id,
        liability_waiver_status: "draft",
      })
      .catch((err) =>
        console.error("[pandadoc/create] early id persist failed:", err)
      );
  }

  await waitForDocumentStatus(doc.id, "document.draft");
  await sendDocument(doc.id);
  await waitForDocumentStatus(doc.id, "document.sent");
  const sessionId = await createSigningSession(doc.id, recipientEmail);

  // Bump status → "sent" now that the envelope is actually out.
  if (type === "enrollment_agreement" && progressRow) {
    await xano.studentRegistrationProgress.update(progressRow.id, {
      enrollment_agreement_status: "sent",
      enrollment_agreement_sent: new Date().toISOString(),
    });
  } else if (type === "liability_waiver" && packetRow) {
    await xano.studentRegistration.update(packetRow.id, {
      liability_waiver_status: "sent",
      liability_waiver_sent_at: new Date().toISOString(),
    });
  }

  return { status: 200, body: { documentId: doc.id, sessionId } };
}
