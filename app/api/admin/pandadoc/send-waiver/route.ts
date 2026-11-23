import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoStudentRegistration } from "@/lib/xano";
import { formatDateUs } from "@/lib/us-date";
import { formatUSPhone } from "@/lib/phone";
import { isSignerComplete, signerFromRow } from "@/lib/residential-signer";
import {
  createDocumentFromTemplate,
  deleteDocument,
  getDocumentStatus,
  getTemplateId,
  getTemplateRole,
  getWaiverCcRecipients,
  pandaDocDate,
  schoolTodayIso,
  sendDocument,
  waitForDocumentStatus,
} from "@/lib/pandadoc";

/**
 * Admin-initiated liability waiver send (and, for residential
 * placements, the student's enrollment agreement).
 *
 *   POST /api/admin/pandadoc/send-waiver
 *   Body: { studentId: number, yearId: number,
 *           docType?: "liability_waiver" | "enrollment_agreement" }
 *
 * Residential students: both documents go to the case worker or legal
 * guardian saved on this year's packet (`lib/residential-signer.ts`),
 * with the caregiver(s) on the family CC'd. The caregiver who holds the
 * portal login can't sign for the student.
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

/** Which document this route sends. */
type SendDocType = "liability_waiver" | "enrollment_agreement";

/**
 * Where each document lives on the packet. A residential student's
 * enrollment agreement is per student (the placement isn't covered by
 * the caregiver's family agreement), so it reuses the per-student
 * slot built for mid-year sibling additions; the webhook, status sync,
 * downloads and the Signed Documents card already read it.
 */
const SLOTS = {
  liability_waiver: {
    idField: "liability_waiver_pandadoc_id",
    statusField: "liability_waiver_status",
    sentField: "liability_waiver_sent_at",
    metaDocType: "liability_waiver",
    templateType: "liability_waiver",
    label: "liability waiver",
  },
  enrollment_agreement: {
    idField: "addition_enrollment_agreement_pandadoc_id",
    statusField: "addition_enrollment_agreement_status",
    sentField: "addition_enrollment_agreement_sent_at",
    metaDocType: "addition_enrollment_agreement",
    templateType: "enrollment_agreement",
    label: "enrollment agreement",
  },
} as const;

/**
 * In-flight guard per (student, year, document). An admin double-click
 * would otherwise mint two envelopes — the second one's create races
 * the first one's id persist, so the delete-the-old step can't see it.
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
    const docType: SendDocType =
      body?.docType === "enrollment_agreement"
        ? "enrollment_agreement"
        : "liability_waiver";
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

    const key = `${studentId}:${yearId}:${docType}`;
    let run = inFlight.get(key);
    if (!run) {
      run = doSend(studentId, yearId, docType)
        .catch((err): SendResult => {
          console.error("[/api/admin/pandadoc/send-waiver] failed:", err);
          return {
            status: 500,
            body: {
              error:
                err instanceof Error
                  ? err.message
                  : `Failed to send the ${SLOTS[docType].label}.`,
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
  yearId: number,
  docType: SendDocType
): Promise<SendResult> {
  const slot = SLOTS[docType];
  const [application, student, year, packet] = await Promise.all([
    xano.applications.getByStudentAndYear(studentId, yearId),
    xano.students.getById(studentId),
    xano.schoolYears.getById(yearId),
    xano.studentRegistration.resolve(studentId, yearId),
  ]);
  const packetFields = packet as unknown as Record<string, unknown>;
  const currentId = String(packetFields[slot.idField] ?? "");
  const currentStatus = String(packetFields[slot.statusField] ?? "");

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
  if (currentId && currentStatus === "completed") {
    return {
      status: 409,
      body: {
        error: `This student's ${slot.label} is already signed. Download it from the card instead.`,
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
  const isResidential = family.is_residential === true;

  // Everyone else signs the family's enrollment agreement during
  // registration; only a residential placement gets one per student.
  if (docType === "enrollment_agreement" && !isResidential) {
    return {
      status: 400,
      body: {
        error:
          "Per-student enrollment agreements are only sent for residential placements. This family signs theirs during registration.",
      },
    };
  }

  const parentIds = xano.families.getParentIds(family);
  const parents = (await xano.parents.getAll())
    .filter((p) => parentIds.includes(p.id))
    .sort((a, b) => a.id - b.id);
  const primary = parents[0] ?? null;

  // Recipient. A residential placement's documents are signed by the
  // case worker or legal guardian saved on this year's packet, never
  // the caregiver who holds the portal login (no legal authority to
  // sign). Everyone else: the family's primary parent — lowest id, the
  // same pick every other admin surface makes for invoice routing and
  // page subtitles.
  let recipientEmail: string;
  let recipientFirstName: string;
  let recipientLastName: string;
  let recipientRelationship: string;
  let recipientPhone: string;
  if (isResidential) {
    const signer = signerFromRow(packet);
    if (!isSignerComplete(signer)) {
      return {
        status: 400,
        body: {
          error:
            "Add this student's case worker or legal guardian (name and email) before sending. Residential documents go to them, not the caregiver.",
        },
      };
    }
    recipientEmail = signer.signer_email;
    recipientFirstName = signer.signer_first_name;
    recipientLastName = signer.signer_last_name;
    recipientRelationship = signer.signer_role;
    recipientPhone = formatUSPhone(signer.signer_phone);
  } else {
    recipientEmail = primary?.email?.trim() ?? "";
    if (!recipientEmail) {
      return {
        status: 400,
        body: {
          error:
            "No primary parent email on file — PandaDoc needs an address to send the waiver to.",
        },
      };
    }
    recipientFirstName = primary?.first_name?.trim() ?? "";
    recipientLastName = primary?.last_name?.trim() ?? "";
    recipientRelationship = primary?.relationship?.trim() ?? "";
    recipientPhone = formatUSPhone(primary?.phone);
  }

  // Copies: the admissions inbox always, so the office has the request
  // and the signed result on file. For a residential placement, also the
  // caregiver(s) on the family, so they can see it went out and was
  // signed. CC'd recipients carry no role, which keeps them off the
  // signature block.
  const ccList = [...getWaiverCcRecipients()];
  if (isResidential) {
    for (const p of parents) {
      const email = p.email?.trim();
      if (!email) continue;
      const lower = email.toLowerCase();
      if (lower === recipientEmail.toLowerCase()) continue;
      if (ccList.some((c) => c.email.toLowerCase() === lower)) continue;
      ccList.push({ email });
    }
  }

  // Retire the previous unsigned envelope before minting a new one.
  // Best-effort on the PandaDoc side (a delete failure shouldn't
  // block admin from getting a working link out) but LOUD, because
  // the leftover is a live link whose signature we'd ignore.
  if (currentId) {
    try {
      const existing = await getDocumentStatus(currentId);
      // A completed doc can only show up here if the packet's status
      // column lagged behind PandaDoc. Sync it rather than deleting a
      // real signature.
      if (existing.status === "document.completed") {
        await xano.studentRegistration
          .update(packet.id, {
            [slot.statusField]: "completed",
          } as Partial<XanoStudentRegistration>)
          .catch(() => {});
        return {
          status: 409,
          body: {
            error: `PandaDoc already has this ${slot.label} signed — refreshed the card instead of sending a new one.`,
            documentId: currentId,
          },
        };
      }
      await deleteDocument(currentId);
    } catch (err) {
      console.error(
        `[send-waiver] couldn't retire stale ${docType} envelope ${currentId} for student ${studentId} / year ${yearId} — it stays live, and a signature on it would be dropped by the webhook's id guard:`,
        err
      );
    }
  }

  const studentName = `${student.first_name ?? ""} ${student.last_name ?? ""}`
    .trim();
  const recipientName = `${recipientFirstName} ${recipientLastName}`.trim();
  const yearName = year?.year_name?.trim() ?? "";
  // The enrollment agreement prints the school year inside its text
  // ("School Year" / "Start Year" / "End Year"); a blank is worse than
  // not sending, same rule as the parent-side create.
  const yearParts = /(\d{4})\D+(\d{4})/.exec(yearName);
  const startYear = yearParts?.[1] ?? (year?.start_date ?? "").slice(0, 4);
  const endYear = yearParts?.[2] ?? (year?.end_date ?? "").slice(0, 4);
  if (docType === "enrollment_agreement" && (!yearName || !startYear || !endYear)) {
    return {
      status: 400,
      body: {
        error: "Couldn't determine the school year for this enrollment agreement.",
      },
    };
  }
  const studentDob = formatDateUs(student.date_of_birth);
  const today = schoolTodayIso();

  const doc = await createDocumentFromTemplate({
    templateId: getTemplateId(slot.templateType),
    // Same name shapes the parent-side create uses, so its resume /
    // title-match logic still recognizes an envelope this route made.
    name:
      docType === "liability_waiver"
        ? `Liability Waiver – ${student.first_name} ${student.last_name}`
        : `Enrollment Agreement – ${student.first_name} ${student.last_name}`,
    recipientEmail,
    recipientFirstName,
    recipientLastName,
    role: getTemplateRole(slot.templateType),
    cc: ccList,
    // Echoed on every webhook event — this is what lets the completion
    // land on the packet row with no admin-specific plumbing.
    metadata: {
      family_id: String(familyId),
      year_id: String(yearId),
      student_id: String(studentId),
      doc_type: slot.metaDocType,
    },
    tokens: {
      "family.name": family.family_name,
      "student.first_name": student.first_name ?? "",
      "student.last_name": student.last_name ?? "",
      "student.full_name": studentName,
      // The participation agreement's variable, spelled as in the template.
      "Student Full Name": studentName,
      "parent.first_name": recipientFirstName,
      "parent.last_name": recipientLastName,
      "parent.email": recipientEmail,
      "students.names": studentName,
      // The enrollment agreement's variables, spelled as in the template.
      "School Year": yearName,
      "Start Year": startYear,
      "End Year": endYear,
      "student.date_of_birth": studentDob,
      "parent.phone": recipientPhone,
    },
    fields: {
      parent_first_name: recipientFirstName,
      parent_last_name: recipientLastName,
      parent_full_name: recipientName,
      parent_name: recipientName,
      parent_email: recipientEmail,
      parent_relationship: recipientRelationship,
      parent_phone: recipientPhone,
      // Prefilled with the day it was sent; the signer can change it
      // when they sign on a later day.
      today_date: pandaDocDate(today),
      signature_date: pandaDocDate(today),
      signature_date_text: formatDateUs(today),
      school_year: yearName,
      "parent.first_name": recipientFirstName,
      "parent.last_name": recipientLastName,
      "parent.full_name": recipientName,
      "parent.email": recipientEmail,
      "parent.phone": recipientPhone,
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
      student_names: studentName,
      "students.names": studentName,
    },
  });

  // Persist the id BEFORE the send chain, matching the parent route:
  // if the function times out mid-flight, the envelope has a home and
  // the next send can retire it instead of leaving it live forever.
  await xano.studentRegistration
    .update(packet.id, {
      [slot.idField]: doc.id,
      [slot.statusField]: "draft",
    } as Partial<XanoStudentRegistration>)
    .catch((err) =>
      console.error("[send-waiver] early id persist failed:", err)
    );

  const docTitle =
    docType === "liability_waiver" ? "Liability waiver" : "Enrollment agreement";
  await waitForDocumentStatus(doc.id, "document.draft");
  await sendDocument(doc.id, {
    // The whole reason this route exists — PandaDoc emails the signing
    // link so the signer doesn't need a portal login.
    silent: false,
    subject: yearName
      ? `${docTitle} for ${studentName} — SailFuture Academy (${yearName})`
      : `${docTitle} for ${studentName} — SailFuture Academy`,
    message: isResidential
      ? `Hi ${recipientFirstName || "there"}, as ${studentName}'s ${recipientRelationship.toLowerCase() || "case worker or legal guardian"}, we need your signature on ` +
        `the ${slot.label} for ${studentName}${yearName ? ` for the ${yearName} school year` : ""} at SailFuture Academy. ` +
        `Click through to review and sign. ` +
        `Reply to this email or call the front office if you have any questions.`
      : `Hi ${recipientFirstName || "there"}, we still need a signed ${slot.label} for ` +
        `${studentName}${yearName ? ` for the ${yearName} school year` : ""}. ` +
        `Click through to review and sign — it only takes a minute. ` +
        `Reply to this email or call the front office if you have any questions.`,
  });
  await waitForDocumentStatus(doc.id, "document.sent");

  const sentAt = new Date().toISOString();
  await xano.studentRegistration.update(packet.id, {
    [slot.statusField]: "sent",
    [slot.sentField]: sentAt,
  } as Partial<XanoStudentRegistration>);

  return {
    status: 200,
    body: {
      documentId: doc.id,
      sentTo: recipientEmail,
      // Surfaced so the success toast can name who else got a copy —
      // admin shouldn't have to open PandaDoc to find out.
      cc: ccList.map((c) => c.email),
      sentAt,
      studentName,
    },
  };
}
