import { getFamilyAuth } from "@/lib/family-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import { denyPacketAccess, stripReadonlyFields } from "@/lib/family-access";
import { SIGNER_FIELDS, cleanSignerPatch } from "@/lib/residential-signer";
import {
  SUFS_ADMIN_FIELDS,
  redactAdminSufs,
} from "@/lib/student-registration-redact";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getFamilyAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { familyId } = session;
  if (!familyId) return NextResponse.json({ error: "No family found" }, { status: 400 });

  const { id } = await params;

  // The packet id comes from the URL — make sure it belongs to a
  // student in the caller's own family before anything is written. See
  // lib/family-access.ts.
  const denied = await denyPacketAccess(id);
  if (denied) return denied;

  // The primary key and the student link are never a parent's to write
  // (the forms spread the whole packet, so both ride along).
  const body = stripReadonlyFields(await req.json(), [
    "registration_students_id",
  ]);

  // Admin-owned columns on `registration_student_registration` that a
  // parent must never write. Both parent registration forms — the
  // apply-flow registration step and the residential packet form —
  // build their PATCH by spreading the WHOLE packet they loaded
  // (`payload = { ...reg }`), so every admin-only column on that
  // fetched row rides along in the body. This route forwards the body
  // to Xano unfiltered, so without stripping them a routine parent
  // save would silently overwrite admin state — e.g. a stale
  // `sufs_enrollment_request_sent: false` resetting a request an
  // admin just sent on the SUFS page, or a stale
  // `registrationConfirmed` un-confirming a packet. Booleans are the real hazard: Xano applies
  // them (only empty strings / null are dropped). The admin routes
  // (`/api/admin/student-registration/[id]`, `/admin/sufs`) are the
  // sole legitimate writers of these — strip them here at the choke
  // point so no current or future parent form can clobber them. (The
  // residential form already strips `registrationConfirmed` itself;
  // this makes that defense route-wide instead of per-form.)
  const ADMIN_ONLY_FIELDS = [
    ...SUFS_ADMIN_FIELDS,
    "registrationConfirmed",
    "registration_confirmed_admin_time",
    "is_registration_admin_confirm_admin",
    "crew_assignment",
    "previous_crew_assignment",
    "crew_assignment_change",
    // Billing owns this: a stale copy riding along in a spread-packet
    // save would point the packet back at a removed Stripe item.
    "stripe_subscription_item_id",
  ];
  // Mid-year sibling registration state (see `lib/midyear-additions.ts`)
  // is written only by `/api/student-additions/[applicationId]` and the
  // PandaDoc routes. The same spread-the-packet saves would otherwise
  // carry a stale copy back — e.g. an agreement status of "sent" loaded
  // before the parent signed, overwriting "completed".
  const ADDITION_FIELDS = [
    "addition_tuition_signature",
    "addition_tuition_signed_name",
    "addition_tuition_signed_at",
    "addition_enrollment_agreement_pandadoc_id",
    "addition_enrollment_agreement_status",
    "addition_enrollment_agreement_sent_at",
    "addition_enrollment_agreement_pdf_url",
    "addition_registration_submitted_at",
  ];
  // Public school withdrawal form state: same hazard, same rule. The
  // parent's own answer (`transferring_from_pinellas_public`) is theirs
  // to write and is NOT in this list.
  const WITHDRAWAL_FORM_FIELDS = [
    "withdrawal_form_pandadoc_id",
    "withdrawal_form_status",
    "withdrawal_form_sent_at",
    "withdrawal_form_pdf_url",
  ];
  for (const f of [
    ...ADMIN_ONLY_FIELDS,
    ...ADDITION_FIELDS,
    ...WITHDRAWAL_FORM_FIELDS,
  ]) {
    if (f in body) delete body[f];
  }

  // Residential document signer (case worker / legal guardian): staff
  // send PandaDoc links to this address, so it's validated here too.
  if (SIGNER_FIELDS.some((k) => k in body)) {
    const cleaned = cleanSignerPatch(body);
    if ("error" in cleaned) {
      return NextResponse.json({ error: cleaned.error }, { status: 400 });
    }
    for (const k of SIGNER_FIELDS) delete body[k];
    Object.assign(body, cleaned.patch);
  }

  // Xano types medicaid_number as a number; coerce empty strings to 0 before
  // forwarding, otherwise Xano rejects the whole PATCH.
  if ("medicaid_number" in body) {
    const n = Number(body.medicaid_number);
    body.medicaid_number = Number.isFinite(n) ? n : 0;
  }

  // `last_edited_time` is auto-stamped by `xano.studentRegistration.update`
  // — every caller (parent, admin, PandaDoc) gets it for free, so we
  // don't add it to the body here.
  const updated = await xano.studentRegistration.update(Number(id), body);

  // Xano's update echoes the FULL row — including admin-only SUFS
  // columns the parent never wrote — so redact the response the same
  // way the parent GET does. Stripping the request body alone isn't
  // enough: without this, any routine parent save would hand the
  // admin's SUFS state (notes included) back in the network payload.
  return NextResponse.json(redactAdminSufs(updated), { status: 200 });
}

/**
 * A parent removing one of their own students from this year's
 * registration (the trash button on the registration step). Any parent
 * on the family may do it; nobody may do it to another family's packet
 * — until 2026-11-22 the id in the URL was not checked at all.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getFamilyAuth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { familyId } = session;
  if (!familyId) return NextResponse.json({ error: "No family found" }, { status: 400 });

  const { id } = await params;

  const denied = await denyPacketAccess(id);
  if (denied) return denied;

  await xano.studentRegistration.delete(Number(id));

  return NextResponse.json({ ok: true }, { status: 200 });
}
