import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  createDocumentFromTemplate,
  deleteDocument,
  getDocumentStatus,
  getTemplateId,
  getTemplateRole,
  getWaiverCcRecipients,
  sendDocument,
  waitForDocumentStatus,
} from "@/lib/pandadoc";

/**
 * Admin-initiated liability waiver send.
 *
 *   POST /api/admin/pandadoc/send-waiver
 *   Body: { studentId: number, yearId: number }
 *
 * The parent-side counterpart (`/api/admin/../../pandadoc/create`)
 * resolves the family from the signed-in parent's Clerk session, so
 * admin can't drive it. This route takes the (student, year) pair
 * instead, resolves the recipient server-side, and — the one real
 * behavioral difference — sends NON-silently, so PandaDoc emails the
 * parent its own signing link.
 *
 * That matters for the case this was built for: a family whose
 * registration was pushed through to enrollment without a signed
 * waiver. They've stopped opening the portal, so the embedded
 * signing session the apply flow relies on will never be reached.
 * A PandaDoc email needs no login.
 *
 * Everything downstream is unchanged. The envelope carries the same
 * `metadata` (family / year / student / doc_type) the parent flow
 * stamps, so `/api/webhooks/pandadoc` maps the completion onto the
 * same packet columns, and every waiver surface — the enrolled
 * detail card, the registration packet section, the parent's own
 * view — renders it exactly as if the family had signed the normal
 * way. There is no admin-specific display path.
 *
 * Re-sending replaces rather than accumulates: an existing unsigned
 * envelope is deleted before the new one is created. Two live links
 * would let the family sign the older one, whose completion webhook
 * the packet's id guard silently drops.
 *
 * Refuses when the waiver is already signed — recreating would throw
 * away the signature record.
 */

// Create → wait-for-draft → send → wait-for-sent is a real chain of
// PandaDoc round trips. Same budget as the parent-side create so a
// slow template can't be killed mid-flight and orphan an envelope.
export const maxDuration = 60;

/**
 * In-flight guard per (student, year). An admin double-click would
 * otherwise mint two envelopes — the second one's create races the
 * first one's id persist, so the delete-the-old step can't see it.
 */
const inFlight = new Map<string, Promise<SendResult>>();

interface SendResult {
  status: number;
  body: Record<string, unknown>;
}

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

    const key = `${studentId}:${yearId}`;
    let run = inFlight.get(key);
    if (!run) {
      run = doSend(studentId, yearId)
        .catch((err): SendResult => {
          console.error("[/api/admin/pandadoc/send-waiver] failed:", err);
          return {
            status: 500,
            body: {
              error:
                err instanceof Error
                  ? err.message
                  : "Failed to send the liability waiver.",
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

async function doSend(
  studentId: number,
  yearId: number
): Promise<SendResult> {
  const [application, student, year, packet] = await Promise.all([
    xano.applications.getByStudentAndYear(studentId, yearId),
    xano.students.getById(studentId),
    xano.schoolYears.getById(yearId),
    xano.studentRegistration.resolve(studentId, yearId),
  ]);

  if (!application) {
    return {
      status: 404,
      body: {
        error: `No application for this student in ${year?.year_name ?? `year #${yearId}`}.`,
      },
    };
  }
  if (!student) {
    return { status: 404, body: { error: "Student not found." } };
  }

  // Already signed — never recreate. The existing envelope IS the
  // signature record; a fresh one would orphan it and the card would
  // drop from Signed back to Sent.
  if (
    packet.liability_waiver_pandadoc_id &&
    packet.liability_waiver_status === "completed"
  ) {
    return {
      status: 409,
      body: {
        error:
          "This student's liability waiver is already signed. Download it from the card instead.",
      },
    };
  }

  const familyId = Number(student.registration_families_id);
  const family = familyId ? await xano.families.getById(familyId) : null;
  if (!family) {
    return {
      status: 404,
      body: { error: "Couldn't resolve this student's family." },
    };
  }

  // Recipient: the family's primary parent — lowest id, the same
  // pick every other admin surface makes for invoice routing and
  // page subtitles, so the waiver lands with whoever admin already
  // thinks of as the contact.
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
          "No primary parent email on file — PandaDoc needs an address to send the waiver to.",
      },
    };
  }
  const recipientFirstName = primary?.first_name?.trim() ?? "";
  const recipientLastName = primary?.last_name?.trim() ?? "";

  // Retire the previous unsigned envelope before minting a new one.
  // Best-effort on the PandaDoc side (a delete failure shouldn't
  // block admin from getting a working link out) but LOUD, because
  // the leftover is a live link whose signature we'd ignore.
  const staleDocId = packet.liability_waiver_pandadoc_id ?? "";
  if (staleDocId) {
    try {
      const existing = await getDocumentStatus(staleDocId);
      // A completed doc can only show up here if the packet's status
      // column lagged behind PandaDoc. Sync it rather than deleting a
      // real signature.
      if (existing.status === "document.completed") {
        await xano.studentRegistration
          .update(packet.id, { liability_waiver_status: "completed" })
          .catch(() => {});
        return {
          status: 409,
          body: {
            error:
              "PandaDoc already has this waiver signed — refreshed the card instead of sending a new one.",
            documentId: staleDocId,
          },
        };
      }
      await deleteDocument(staleDocId);
    } catch (err) {
      console.error(
        `[send-waiver] couldn't retire stale envelope ${staleDocId} for student ${studentId} / year ${yearId} — it stays live, and a signature on it would be dropped by the webhook's id guard:`,
        err
      );
    }
  }

  const studentName = `${student.first_name ?? ""} ${student.last_name ?? ""}`
    .trim();
  const parentName = `${recipientFirstName} ${recipientLastName}`.trim();
  const yearName = year?.year_name?.trim() ?? "";

  const doc = await createDocumentFromTemplate({
    templateId: getTemplateId("liability_waiver"),
    // Same name shape the parent-side create uses, so the resume /
    // title-match logic over there still recognizes an envelope this
    // route produced.
    name: `Liability Waiver – ${student.first_name} ${student.last_name}`,
    recipientEmail,
    recipientFirstName,
    recipientLastName,
    role: getTemplateRole("liability_waiver"),
    // Copy the admissions inbox so the office has the outgoing
    // request and the signed result on file without depending on
    // anyone forwarding it. CC'd recipients carry no role, which is
    // what keeps them off the signature block.
    cc: getWaiverCcRecipients(),
    // Echoed on every webhook event — this is what lets the
    // completion land on the packet row with no admin-specific
    // plumbing.
    metadata: {
      family_id: String(familyId),
      year_id: String(yearId),
      student_id: String(studentId),
      doc_type: "liability_waiver",
    },
    tokens: {
      "family.name": family.family_name,
      "student.first_name": student.first_name ?? "",
      "student.last_name": student.last_name ?? "",
      "student.full_name": studentName,
      "parent.first_name": recipientFirstName,
      "parent.last_name": recipientLastName,
      "parent.email": recipientEmail,
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
      student_first_name: student.first_name ?? "",
      student_last_name: student.last_name ?? "",
      student_full_name: studentName,
      student_name: studentName,
      "student.first_name": student.first_name ?? "",
      "student.last_name": student.last_name ?? "",
      "student.full_name": studentName,
      participant_name: studentName,
      participant_first_name: student.first_name ?? "",
      participant_last_name: student.last_name ?? "",
      "Participant Name": studentName,
      family_name: family.family_name,
      "family.name": family.family_name,
    },
  });

  // Persist the id BEFORE the send chain, matching the parent route:
  // if the function times out mid-flight, the envelope has a home and
  // the next send can retire it instead of leaving it live forever.
  await xano.studentRegistration
    .update(packet.id, {
      liability_waiver_pandadoc_id: doc.id,
      liability_waiver_status: "draft",
    })
    .catch((err) =>
      console.error("[send-waiver] early id persist failed:", err)
    );

  await waitForDocumentStatus(doc.id, "document.draft");
  await sendDocument(doc.id, {
    // The whole reason this route exists — PandaDoc emails the
    // signing link so the parent doesn't need a portal login.
    silent: false,
    subject: yearName
      ? `Liability waiver for ${studentName} — SailFuture Academy (${yearName})`
      : `Liability waiver for ${studentName} — SailFuture Academy`,
    message:
      `Hi ${recipientFirstName || "there"}, we still need a signed liability waiver for ` +
      `${studentName}${yearName ? ` for the ${yearName} school year` : ""}. ` +
      `Click through to review and sign — it only takes a minute. ` +
      `Reply to this email or call the front office if you have any questions.`,
  });
  await waitForDocumentStatus(doc.id, "document.sent");

  const sentAt = new Date().toISOString();
  await xano.studentRegistration.update(packet.id, {
    liability_waiver_status: "sent",
    liability_waiver_sent_at: sentAt,
  });

  return {
    status: 200,
    body: {
      documentId: doc.id,
      sentTo: recipientEmail,
      // Surfaced so the success toast can name who else got a copy —
      // admin shouldn't have to open PandaDoc to find out.
      cc: getWaiverCcRecipients().map((c) => c.email),
      sentAt,
      studentName,
    },
  };
}
