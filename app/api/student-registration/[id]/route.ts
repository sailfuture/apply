import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import {
  SUFS_ADMIN_FIELDS,
  redactAdminSufs,
} from "@/lib/student-registration-redact";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const familyId = user.publicMetadata.registration_families_id as number | undefined;
  if (!familyId) return NextResponse.json({ error: "No family found" }, { status: 400 });

  const { id } = await params;
  const body = await req.json();

  // Admin-owned columns on `registration_student_registration` that a
  // parent must never write. Both parent registration forms — the
  // apply-flow registration step and the residential packet form —
  // build their PATCH by spreading the WHOLE packet they loaded
  // (`payload = { ...reg }`), so every admin-only column on that
  // fetched row rides along in the body. This route forwards the body
  // to Xano unfiltered, so without stripping them a routine parent
  // save would silently overwrite admin state — e.g. a stale
  // `sufs_enrolled: false` resetting the enrolled latch an admin just
  // set on the SUFS page, or a stale `registrationConfirmed`
  // un-confirming a packet. Booleans are the real hazard: Xano applies
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
  ];
  for (const f of ADMIN_ONLY_FIELDS) {
    if (f in body) delete body[f];
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const familyId = user.publicMetadata.registration_families_id as number | undefined;
  if (!familyId) return NextResponse.json({ error: "No family found" }, { status: 400 });

  const { id } = await params;
  await xano.studentRegistration.delete(Number(id));

  return NextResponse.json({ ok: true }, { status: 200 });
}
