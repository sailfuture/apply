import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  createDocumentFromTemplate,
  deleteDocument,
  getDocumentDownloadUrl,
  getDocumentStatus,
  getTemplateId,
  getTemplateRole,
  getWaiverCcRecipients,
  schoolTodayIso,
  sendDocument,
  waitForDocumentStatus,
} from "@/lib/pandadoc";

/**
 * Admin-initiated free and reduced lunch letter send.
 *
 *   POST /api/admin/pandadoc/send-lunch-letter
 *   Body: { familyId: number, yearId: number }
 *
 * The parent signs the lunch letter as a registration step, which a
 * family that already submitted (or is already enrolled) never returns
 * to. This is the way to reach them: same template and same `metadata`
 * as the parent-side create, but sent NON-silently so PandaDoc emails
 * the primary parent a signing link that needs no portal login.
 *
 * Nothing downstream is admin-specific. The webhook maps the completion
 * onto the family's registration progress row by the envelope id stored
 * here, exactly as it does for one the parent started themselves.
 *
 * Sibling of `send-waiver`; see that route for the reasoning behind the
 * retire-the-old-envelope and persist-the-id-early steps.
 */
export const maxDuration = 60;

interface SendResult {
  status: number;
  body: Record<string, unknown>;
}

/** One send at a time per (family, year): a double-click would otherwise
 *  mint two envelopes, the second racing the first one's id persist. */
const inFlight = new Map<string, Promise<SendResult>>();

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const familyId = Number(body?.familyId);
    const yearId = Number(body?.yearId);
    if (!Number.isInteger(familyId) || familyId <= 0) {
      return NextResponse.json(
        { error: "familyId is required" },
        { status: 400 }
      );
    }
    if (!Number.isInteger(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    const key = `${familyId}:${yearId}`;
    let run = inFlight.get(key);
    if (!run) {
      run = doSend(familyId, yearId)
        .catch((err): SendResult => {
          console.error("[/api/admin/pandadoc/send-lunch-letter] failed:", err);
          return {
            status: 500,
            body: {
              error:
                err instanceof Error
                  ? err.message
                  : "Failed to send the lunch letter.",
            },
          };
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, run);
    }
    const result = await run;
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    return handleAdminError(err);
  }
}

async function doSend(familyId: number, yearId: number): Promise<SendResult> {
  const family = await xano.families.getById(familyId).catch(() => null);
  if (!family) {
    return { status: 404, body: { error: "Family not found." } };
  }

  const [progress, year, yearApps, familyStudents] = await Promise.all([
    xano.studentRegistrationProgress.resolve(familyId, yearId),
    xano.schoolYears.getById(yearId),
    xano.applications.getByFamilyAndYear(familyId, yearId),
    xano.students.getByFamilyId(familyId),
  ]);

  // Already signed: the existing envelope IS the record.
  if (progress.isLunchLetter === true && progress.lunch_letter_pandadoc_id) {
    return {
      status: 409,
      body: {
        error:
          "This family's lunch letter is already signed. Download it from the card instead.",
      },
    };
  }

  // Recipient: the family's primary parent (lowest id), the same pick
  // the waiver send and every other admin surface makes.
  const parentIds = xano.families.getParentIds(family);
  const parents = (await xano.parents.getAll())
    .filter((p) => parentIds.includes(p.id))
    .sort((a, b) => a.id - b.id);
  const primary = parents[0] ?? null;
  const recipientEmail = primary?.email?.trim() ?? "";
  if (!recipientEmail) {
    return {
      status: 400,
      body: {
        error:
          "No primary parent email on file. PandaDoc needs an address to send the lunch letter to.",
      },
    };
  }
  const recipientFirstName = primary?.first_name?.trim() ?? "";
  const recipientLastName = primary?.last_name?.trim() ?? "";
  const parentName = `${recipientFirstName} ${recipientLastName}`.trim();

  // Retire the previous unsigned envelope so only one link is live. A
  // signature on a retired-but-still-live envelope would be dropped by
  // the webhook's id guard, hence the loud log when the delete fails.
  const staleDocId = progress.lunch_letter_pandadoc_id ?? "";
  if (staleDocId) {
    try {
      const existing = await getDocumentStatus(staleDocId);
      if (existing.status === "document.completed") {
        // Our row lagged PandaDoc: sync it instead of deleting a real
        // signature.
        await xano.studentRegistrationProgress
          .update(progress.id, {
            lunch_letter_status: "completed",
            lunch_letter_pdf_url: getDocumentDownloadUrl(staleDocId),
            isLunchLetter: true,
          })
          .catch(() => {});
        return {
          status: 409,
          body: {
            error:
              "PandaDoc already has this lunch letter signed. The card has been refreshed instead of sending a new one.",
            documentId: staleDocId,
          },
        };
      }
      await deleteDocument(staleDocId);
    } catch (err) {
      console.error(
        `[send-lunch-letter] couldn't retire stale envelope ${staleDocId} for family ${familyId} / year ${yearId}; it stays live:`,
        err
      );
    }
  }

  // Household form: every student the family has in this year.
  const inYear = new Set(
    yearApps
      .filter((a) => a.isActive !== false)
      .map((a) => Number(a.registration_students_id))
  );
  const studentsInYear = familyStudents.filter((s) => inYear.has(Number(s.id)));
  const studentNames = studentsInYear
    .map((s) => `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim())
    .filter(Boolean)
    .join(", ");
  const firstStudent = studentsInYear[0] ?? null;
  const yearName = year?.year_name?.trim() ?? "";

  const doc = await createDocumentFromTemplate({
    templateId: getTemplateId("lunch_letter"),
    // Same name shape as the parent-side create, so its resume logic
    // recognizes an envelope this route produced.
    name: `Free and Reduced Lunch Letter – ${family.family_name}`,
    recipientEmail,
    recipientFirstName,
    recipientLastName,
    role: getTemplateRole("lunch_letter"),
    cc: getWaiverCcRecipients(),
    metadata: {
      family_id: String(familyId),
      year_id: String(yearId),
      ...(firstStudent ? { student_id: String(firstStudent.id) } : {}),
      doc_type: "lunch_letter",
    },
    tokens: {
      "family.name": family.family_name,
      "parent.first_name": recipientFirstName,
      "parent.last_name": recipientLastName,
      "parent.email": recipientEmail,
      "students.names": studentNames,
    },
    fields: {
      parent_first_name: recipientFirstName,
      parent_last_name: recipientLastName,
      parent_full_name: parentName,
      parent_name: parentName,
      parent_email: recipientEmail,
      "parent.first_name": recipientFirstName,
      "parent.last_name": recipientLastName,
      "parent.full_name": parentName,
      "parent.email": recipientEmail,
      family_name: family.family_name,
      "family.name": family.family_name,
      student_names: studentNames,
      "students.names": studentNames,
      today_date: schoolTodayIso(),
      signature_date: schoolTodayIso(),
    },
  });

  await xano.studentRegistrationProgress
    .update(progress.id, {
      lunch_letter_pandadoc_id: doc.id,
      lunch_letter_status: "draft",
      isLunchLetter: false,
    })
    .catch((err) =>
      console.error("[send-lunch-letter] early id persist failed:", err)
    );

  await waitForDocumentStatus(doc.id, "document.draft");
  await sendDocument(doc.id, {
    silent: false,
    subject: yearName
      ? `Free and reduced lunch letter: SailFuture Academy (${yearName})`
      : "Free and reduced lunch letter: SailFuture Academy",
    message:
      `Hi ${recipientFirstName || "there"}, every SailFuture Academy family completes a ` +
      `free and reduced lunch letter each school year` +
      `${yearName ? `, and we still need yours for ${yearName}` : ""}. ` +
      `Click through to fill it out and sign. It only takes a few minutes. ` +
      `Reply to this email or call the front office if you have any questions.`,
  });
  await waitForDocumentStatus(doc.id, "document.sent");

  const sentAt = Date.now();
  await xano.studentRegistrationProgress.update(progress.id, {
    lunch_letter_status: "sent",
    lunch_letter_sent: sentAt,
  });

  return {
    status: 200,
    body: {
      documentId: doc.id,
      sentTo: recipientEmail,
      cc: getWaiverCcRecipients().map((c) => c.email),
      sentAt,
    },
  };
}
