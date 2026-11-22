import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import type { User } from "@clerk/nextjs/server";
import {
  xano,
  type XanoStudentRegistration,
  type XanoStudentRegistrationProgress,
} from "@/lib/xano";
import {
  createDocumentFromTemplate,
  deleteDocument,
  sendDocument,
  createSigningSession,
  getDocumentStatus,
  getDocumentDetails,
  getDocumentDownloadUrl,
  getTemplateId,
  getTemplateRole,
  schoolTodayIso,
  waitForDocumentStatus,
} from "@/lib/pandadoc";
import { formatDateUs } from "@/lib/us-date";
import { formatUSPhone } from "@/lib/phone";

// The create chain does real PandaDoc work (create-from-template →
// wait-for-draft → send → session). Give the function room so a slow
// template can't be killed mid-flight and orphan an envelope.
export const maxDuration = 60;

/** `addition_enrollment_agreement` — a mid-year sibling's own enrollment
 *  agreement (see `lib/midyear-additions.ts`). Same PandaDoc template as
 *  the family's, but one envelope per added student, stored on that
 *  student's packet (`addition_enrollment_agreement_*`) instead of the
 *  family progress row the family already signed on. */
type DocType =
  | "liability_waiver"
  | "enrollment_agreement"
  | "addition_enrollment_agreement"
  | "lunch_letter"
  | "withdrawal_form";
const DOC_TYPES: DocType[] = [
  "liability_waiver",
  "enrollment_agreement",
  "addition_enrollment_agreement",
  "lunch_letter",
  "withdrawal_form",
];

/** Documents signed once per family per year. They live on the family's
 *  registration progress row; everything else lives on a student's packet. */
const isFamilyDoc = (type: DocType) =>
  type === "enrollment_agreement" || type === "lunch_letter";

interface CreateResult {
  status: number;
  body: Record<string, unknown>;
}

/** A mid-year sibling with no packet yet — admissions hasn't accepted them. */
class NotAcceptedError extends Error {}

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
  if (!type || !DOC_TYPES.includes(type)) {
    return NextResponse.json(
      { error: `type must be one of: ${DOC_TYPES.join(", ")}` },
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

  // A mid-year sibling's packet IS their acceptance, so for them the
  // packet must already exist — resolving (creating) it here would let
  // a parent skip admissions review by starting a document.
  const isSibling = application.is_midyear_addition === true;
  if (type === "addition_enrollment_agreement" && !isSibling) {
    return {
      status: 400,
      body: { error: "Not a mid-year addition" },
    };
  }
  const packetForType = (): ReturnType<typeof xano.studentRegistration.resolve> =>
    isSibling
      ? xano.studentRegistration
          .getByStudentAndYear(
            application.registration_students_id,
            application.registration_school_years_id
          )
          .then((p) => {
            if (!p) throw new NotAcceptedError();
            return p;
          })
      : xano.studentRegistration.resolve(
          application.registration_students_id,
          application.registration_school_years_id
        );

  // These three lookups only depend on `application`, so run them
  // together instead of the previous four-deep waterfall:
  //   - the target row this doc type lives on (packet for the waiver
  //     and a sibling's agreement, family progress row for the family
  //     agreement and the lunch letter) — resolved-or-created
  //   - the family (for the doc name + tokens)
  //   - the student (for the doc name + fields)
  let targetRow: Awaited<ReturnType<typeof packetForType>> | XanoStudentRegistrationProgress;
  let family: Awaited<ReturnType<typeof xano.families.getById>>;
  let student: Awaited<ReturnType<typeof xano.students.getById>>;
  try {
    [targetRow, family, student] = await Promise.all([
      isFamilyDoc(type)
        ? xano.studentRegistrationProgress.resolve(
            familyId,
            application.registration_school_years_id
          )
        : packetForType(),
      xano.families.getById(familyId),
      xano.students.getById(application.registration_students_id),
    ]);
  } catch (err) {
    if (err instanceof NotAcceptedError) {
      return {
        status: 409,
        body: { error: "This student's registration opens once admissions accepts them." },
      };
    }
    throw err;
  }
  const packetRow = isFamilyDoc(type)
    ? null
    : (targetRow as XanoStudentRegistration);
  const progressRow = isFamilyDoc(type)
    ? (targetRow as XanoStudentRegistrationProgress)
    : null;
  const additionRow = type === "addition_enrollment_agreement" ? packetRow : null;

  const pandadocIdField =
    type === "liability_waiver"
      ? "liability_waiver_pandadoc_id"
      : type === "addition_enrollment_agreement"
        ? "addition_enrollment_agreement_pandadoc_id"
        : type === "lunch_letter"
          ? "lunch_letter_pandadoc_id"
          : type === "withdrawal_form"
            ? "withdrawal_form_pandadoc_id"
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
      : type === "addition_enrollment_agreement"
        ? `Enrollment Agreement – ${student.first_name} ${student.last_name}`
        : type === "lunch_letter"
          ? `Free and Reduced Lunch Letter – ${family.family_name}`
          : type === "withdrawal_form"
            ? `Public School Withdrawal Form – ${student.first_name} ${student.last_name}`
            : `Enrollment Agreement – ${family.family_name}`;

  // Sync a locally-known row to "completed" — used when PandaDoc says
  // the envelope is already signed but our row hasn't caught up. This
  // is the load-bearing fix for the "signed signature silently wiped"
  // bug: the old code treated a completed doc as non-resumable and
  // fell through to wipe + recreate, destroying the signature record.
  const syncCompleted = async (docId: string) => {
    const pdfUrl = getDocumentDownloadUrl(docId);
    if (type === "lunch_letter" && progressRow) {
      await xano.studentRegistrationProgress
        .update(progressRow.id, {
          lunch_letter_status: "completed",
          lunch_letter_pdf_url: pdfUrl,
          isLunchLetter: true,
        })
        .catch(() => {});
    } else if (type === "enrollment_agreement" && progressRow) {
      await xano.studentRegistrationProgress
        .update(progressRow.id, {
          enrollment_agreement_status: "completed",
          enrollment_agreement_pdf_url: pdfUrl,
          is_enrollment_agreement_signed: true,
          isEnrollment: true,
        })
        .catch(() => {});
    } else if (type === "withdrawal_form" && packetRow) {
      await xano.studentRegistration
        .update(packetRow.id, {
          withdrawal_form_status: "completed",
          withdrawal_form_pdf_url: pdfUrl,
        })
        .catch(() => {});
    } else if (type === "liability_waiver" && packetRow) {
      await xano.studentRegistration
        .update(packetRow.id, {
          liability_waiver_status: "completed",
          liability_waiver_pdf_url: pdfUrl,
        })
        .catch(() => {});
    } else if (additionRow) {
      await xano.studentRegistration
        .update(additionRow.id, {
          addition_enrollment_agreement_status: "completed",
          addition_enrollment_agreement_pdf_url: pdfUrl,
        })
        .catch(() => {});
    }
  };

  // Wipe stale metadata so the fresh-create path writes onto a clean
  // row. ONLY called when the envelope is genuinely unusable (deleted,
  // voided, declined) — never for a completed doc.
  const wipeStaleMetadata = async () => {
    if (type === "lunch_letter" && progressRow) {
      // "void" sentinel, same reason as the sibling agreement below:
      // Xano's PATCH drops empty strings. The fresh create overwrites
      // the id.
      await xano.studentRegistrationProgress
        .update(progressRow.id, {
          lunch_letter_status: "void",
          // Keep a completion an admin recorded by verifying.
          isLunchLetter: progressRow.lunch_letter_admin_confirm === true,
        })
        .catch(() => {});
      // Retire the abandoned envelope (for example one admin emailed to
      // a different parent): left live, a signature on it would be
      // dropped by the id guard. 404 counts as success.
      if (existingDocId) {
        await deleteDocument(existingDocId).catch((err) =>
          console.error(
            `[pandadoc/create] couldn't retire lunch letter envelope ${existingDocId}:`,
            err
          )
        );
      }
    } else if (type === "enrollment_agreement" && progressRow) {
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
    } else if (type === "withdrawal_form" && packetRow) {
      // "void" sentinel (Xano's PATCH drops empty strings); the fresh
      // create overwrites the id.
      await xano.studentRegistration
        .update(packetRow.id, { withdrawal_form_status: "void" })
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
    } else if (additionRow) {
      // Non-empty sentinel status: Xano's PATCH drops empty strings, so
      // "" would leave a stale "sent" behind. The fresh create below
      // overwrites the id.
      await xano.studentRegistration
        .update(additionRow.id, {
          addition_enrollment_agreement_status: "void",
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
  const templateType =
    type === "liability_waiver"
      ? "liability_waiver"
      : type === "lunch_letter"
        ? "lunch_letter"
        : type === "withdrawal_form"
          ? "withdrawal_form"
          : "enrollment_agreement";
  const templateId = getTemplateId(templateType);

  // Extra prefills the withdrawal form asks for. Empty strings when the
  // family hasn't given them; the signer fills those in on the form.
  const studentDob = formatDateUs(student.date_of_birth);

  // School year variables for the enrollment agreement: "School Year"
  // is the year's name ("2026-2027"), "Start Year" / "End Year" its two
  // halves ("2026" / "2027"). Taken from the year the APPLICATION is for,
  // so a family signing next year's agreement gets next year's dates.
  // The name is the source; the row's start/end dates only back it up
  // when a name isn't in the usual "YYYY-YYYY" shape.
  const schoolYear = await xano.schoolYears
    .getById(application.registration_school_years_id)
    .catch(() => null);
  const schoolYearName = schoolYear?.year_name?.trim() ?? "";
  const yearParts = /(\d{4})\D+(\d{4})/.exec(schoolYearName);
  const startYear =
    yearParts?.[1] ?? (schoolYear?.start_date ?? "").slice(0, 4);
  const endYear = yearParts?.[2] ?? (schoolYear?.end_date ?? "").slice(0, 4);
  if (type === "enrollment_agreement" || type === "addition_enrollment_agreement") {
    // These print inside the contract's text. Sending the document with
    // a blank where the year belongs is worse than not sending it.
    if (!schoolYearName || !startYear || !endYear) {
      throw new Error(
        "Couldn't determine the school year for this enrollment agreement. Please contact the school."
      );
    }
  }
  // YYYY-MM-DD in the school's timezone ("en-CA" formats that way), so
  // an evening signer doesn't get tomorrow's UTC date.
  const todayIso = schoolTodayIso();
  // The signer's phone and relationship, from their own parent row. Only
  // the withdrawal form (phone) and the participation agreement / waiver
  // (relationship) ask for them, so only those types pay for the lookup;
  // a miss just leaves the field for the parent to type.
  let parentPhone = "";
  let parentRelationship = "";
  if (type === "withdrawal_form" || type === "liability_waiver") {
    const signer = await xano.parents.findByClerkId(user.id).catch(() => null);
    parentPhone = formatUSPhone(signer?.phone);
    parentRelationship = signer?.relationship?.trim() ?? "";
  }

  // The lunch letter is a household form, so it names every student the
  // family has in this year rather than the one application the request
  // came in on. Best-effort: a failed lookup falls back to that student.
  let householdStudents = `${student.first_name} ${student.last_name}`;
  if (type === "lunch_letter") {
    try {
      const [yearApps, familyStudents] = await Promise.all([
        xano.applications.getByFamilyAndYear(
          familyId,
          application.registration_school_years_id
        ),
        xano.students.getByFamilyId(familyId),
      ]);
      const inYear = new Set(
        yearApps.map((a) => Number(a.registration_students_id))
      );
      const names = familyStudents
        .filter((s) => inYear.has(Number(s.id)))
        .map((s) => `${s.first_name} ${s.last_name}`.trim())
        .filter(Boolean);
      if (names.length > 0) householdStudents = names.join(", ");
    } catch (err) {
      console.error("[pandadoc/create] household student lookup failed:", err);
    }
  }
  const doc = await createDocumentFromTemplate({
    templateId,
    name: expectedDocName,
    recipientEmail,
    recipientFirstName,
    recipientLastName,
    role: getTemplateRole(templateType),
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
      // The participation agreement's variable, spelled as in the template.
      "Student Full Name": `${student.first_name} ${student.last_name}`,
      "parent.first_name": recipientFirstName,
      "parent.last_name": recipientLastName,
      "parent.email": recipientEmail,
      "students.names": householdStudents,
      // Names exactly as the variables are spelled in the template.
      "School Year": schoolYearName,
      "Start Year": startYear,
      "End Year": endYear,
      "student.date_of_birth": studentDob,
      "parent.phone": parentPhone,
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
      student_names: householdStudents,
      "students.names": householdStudents,
      // The withdrawal template's date of birth is a TEXT field, so the
      // plain key carries MM/DD/YYYY. A PandaDoc DATE field needs the
      // ISO form the student row stores: use the `_iso` key for one.
      student_date_of_birth: studentDob,
      "student.date_of_birth": studentDob,
      student_date_of_birth_text: studentDob,
      student_date_of_birth_iso: student.date_of_birth ?? "",
      parent_phone: parentPhone,
      // The Field ID the withdrawal template actually uses.
      parent_phone_number: parentPhone,
      parent_relationship: parentRelationship,
      "parent.phone": parentPhone,
      // Today's date (school time) for the date beside the signature.
      // ISO for a PandaDoc DATE field, MM/DD/YYYY for a text field. The
      // signer can change it, which matters when they open the document
      // one day and sign on another.
      // The enrollment agreement's "School Year" field beside the
      // signature ("2026-2027"), same value as the variable in its text.
      school_year: schoolYearName,
      signature_date: todayIso,
      // The participation agreement names its date fields `today_date`.
      today_date: todayIso,
      signature_date_text: formatDateUs(todayIso),
    },
  });

  // Persist the doc id IMMEDIATELY (status "draft"), before the
  // wait/send/session chain. If the function times out or a later step
  // throws, the id is already on the row — the next visit resumes this
  // envelope instead of orphaning it and creating another.
  if (type === "lunch_letter" && progressRow) {
    await xano.studentRegistrationProgress
      .update(progressRow.id, {
        lunch_letter_pandadoc_id: doc.id,
        lunch_letter_status: "draft",
      })
      .catch((err) =>
        console.error("[pandadoc/create] early id persist failed:", err)
      );
  } else if (type === "enrollment_agreement" && progressRow) {
    await xano.studentRegistrationProgress
      .update(progressRow.id, {
        enrollment_agreement_pandadoc_id: doc.id,
        enrollment_agreement_status: "draft",
      })
      .catch((err) =>
        console.error("[pandadoc/create] early id persist failed:", err)
      );
  } else if (type === "withdrawal_form" && packetRow) {
    await xano.studentRegistration
      .update(packetRow.id, {
        withdrawal_form_pandadoc_id: doc.id,
        withdrawal_form_status: "draft",
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
  } else if (additionRow) {
    await xano.studentRegistration
      .update(additionRow.id, {
        addition_enrollment_agreement_pandadoc_id: doc.id,
        addition_enrollment_agreement_status: "draft",
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
  if (type === "lunch_letter" && progressRow) {
    await xano.studentRegistrationProgress.update(progressRow.id, {
      lunch_letter_status: "sent",
      lunch_letter_sent: Date.now(),
    });
  } else if (type === "enrollment_agreement" && progressRow) {
    await xano.studentRegistrationProgress.update(progressRow.id, {
      enrollment_agreement_status: "sent",
      enrollment_agreement_sent: new Date().toISOString(),
    });
  } else if (type === "withdrawal_form" && packetRow) {
    await xano.studentRegistration.update(packetRow.id, {
      withdrawal_form_status: "sent",
      withdrawal_form_sent_at: Date.now(),
    });
  } else if (type === "liability_waiver" && packetRow) {
    await xano.studentRegistration.update(packetRow.id, {
      liability_waiver_status: "sent",
      liability_waiver_sent_at: new Date().toISOString(),
    });
  } else if (additionRow) {
    await xano.studentRegistration.update(additionRow.id, {
      addition_enrollment_agreement_status: "sent",
      addition_enrollment_agreement_sent_at: new Date().toISOString(),
    });
  }

  return { status: 200, body: { documentId: doc.id, sessionId } };
}
