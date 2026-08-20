import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  isToddleConfigured,
  upsertStudent,
  uploadStudentProfileImage,
  syncFamilyMembers,
  syncCrewClass,
  ToddleSyncError,
  type ToddleFamilyMemberInput,
} from "@/lib/toddle";
import type { XanoParent } from "@/lib/xano";

/**
 * Admin-only "Sync to Toddle" — pushes one enrolled student into the
 * school's Toddle org. Updates the existing Toddle student when one
 * matches (stored id → sourceId lookup → name fallback, see
 * `lib/toddle.ts#upsertStudent`), creates one when none does.
 *
 * Beyond the core identity fields, the push includes the school
 * email, enrollment date (start of the first-enrolled school year),
 * home address (primary contact's address on file), the student
 * photo, every family contact (primary + secondary) as both a Toddle
 * parent account and a contact-details card, and crew placement via
 * membership in the org's matching "Crew …" class.
 *
 * Body (optional): `{ gradeLevel?: string }` — the admin-assigned
 * placement grade ("9th") from the student's packet. The client sends
 * it because grade lives on the per-year packet, not the student row;
 * it's required only when the sync has to CREATE the Toddle student
 * (Toddle's create endpoint mandates a year group).
 *
 * After a successful sync the Toddle id + timestamp are persisted
 * back onto the Xano student row (best-effort — the columns may not
 * exist in Xano yet; the sourceId re-match keeps the button
 * idempotent either way, so a persist failure never fails the sync).
 *
 * Response: `{ action: "created"|"updated", toddleId, matchedBy,
 * persisted }`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid student id" }, { status: 400 });
    }
    if (!isToddleConfigured()) {
      return NextResponse.json(
        {
          error:
            "Toddle isn't configured — set TODDLE_API_TOKEN (and TODDLE_REGION or TODDLE_API_BASE_URL) in the environment.",
        },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const gradeLevel =
      typeof body?.gradeLevel === "string" ? body.gradeLevel.trim() : "";

    const student = await xano.students.getById(id);
    const firstName = (student.first_name ?? "").trim();
    const lastName = (student.last_name ?? "").trim();
    if (!firstName || !lastName) {
      return NextResponse.json(
        { error: "Student needs both a first and last name to sync." },
        { status: 400 }
      );
    }

    // Only pass fields that survive Toddle's validations: DOB must be
    // YYYY-MM-DD, gender must map onto M/F, phone must be the
    // canonical 10-digit form. Anything else is simply omitted.
    const dobRaw = (student.date_of_birth ?? "").trim();
    const dob = /^\d{4}-\d{2}-\d{2}/.test(dobRaw)
      ? dobRaw.slice(0, 10)
      : undefined;
    const gender =
      student.gender === "Male"
        ? ("M" as const)
        : student.gender === "Female"
          ? ("F" as const)
          : undefined;
    const phone = (student.student_phone ?? "").trim();
    const phoneNumber = /^\d{10}$/.test(phone) ? phone : undefined;

    // Gather the wider context in parallel: the family's parents
    // (primary = lowest id, matching every other admin surface), the
    // per-year packet (crew + server-side grade fallback), and the
    // school-year list (active year for the packet lookup, plus the
    // student's first-enrolled year for enrollmentDate). Each leg is
    // best-effort — a miss just omits those fields from the push.
    const familyId = Number(student.registration_families_id) || 0;
    const [family, allYears] = await Promise.all([
      familyId
        ? xano.families.getById(familyId).catch(() => null)
        : Promise.resolve(null),
      xano.schoolYears.getAll().catch(() => []),
    ]);
    const activeYear = allYears.find((y) => y.isActive) ?? null;
    const packet = activeYear
      ? ((await xano.studentRegistration
          .getByStudentAndYear(id, activeYear.id)
          .catch(() => null)) ??
        (await xano.studentRegistration.getByStudentId(id).catch(() => null)))
      : await xano.studentRegistration.getByStudentId(id).catch(() => null);

    const parentIds = family ? xano.families.getParentIds(family) : [];
    const familyParents = (
      await Promise.all(
        parentIds.map((pid) =>
          xano.parents.getById(pid).catch(() => null as XanoParent | null)
        )
      )
    )
      .filter((p): p is XanoParent => p !== null)
      .sort((a, b) => a.id - b.id);
    const primaryParent = familyParents[0] ?? null;

    // School email → Toddle login email (only when it looks like one).
    const schoolEmail = (student.school_email ?? "").trim();
    const email = /@/.test(schoolEmail) ? schoolEmail : undefined;

    // Enrollment date = start of the school year the student first
    // enrolled in (the School Account card's year pick).
    const enrollmentYear = allYears.find(
      (y) => y.id === Number(student.enrollment_school_years_id)
    );
    const startRaw = (enrollmentYear?.start_date ?? "").trim();
    const enrollmentDate = /^\d{4}-\d{2}-\d{2}/.test(startRaw)
      ? startRaw.slice(0, 10)
      : undefined;

    // Home address — the primary contact's address on file.
    const addr = (v: string | null | undefined) => {
      const t = (v ?? "").trim();
      return t.length > 0 ? t : undefined;
    };

    const result = await upsertStudent(
      {
        sourceId: `sfa-${id}`,
        firstName,
        lastName,
        dob,
        gender,
        phoneNumber,
        gradeLevel:
          gradeLevel || (packet?.grade_level ?? "").trim() || undefined,
        email,
        enrollmentDate,
        addressLine1: addr(primaryParent?.address_line_1),
        addressLine2: addr(primaryParent?.address_line_2),
        city: addr(primaryParent?.city),
        state: addr(primaryParent?.state),
        zipcode: addr(primaryParent?.zipcode),
      },
      student.toddle_student_id || undefined
    );

    // Push the student's headshot (the admin-uploaded `student_photo`
    // on the Xano row) onto the Toddle profile. Best-effort: a photo
    // failure never fails the sync — the record itself already
    // landed. `photo` in the response tells the client what happened.
    let photo: "synced" | "none" | "failed" = "none";
    const photoUrl = resolvePhotoUrl(student.student_photo);
    if (photoUrl) {
      try {
        const base64Image = await fetchImageAsBase64(photoUrl);
        await uploadStudentProfileImage(result.toddleId, base64Image);
        photo = "synced";
      } catch (err) {
        photo = "failed";
        console.error(
          `[/api/admin/students/${id}/toddle-sync] photo upload failed:`,
          err
        );
      }
    }

    // Family members → Toddle parent accounts + contact-details cards
    // on the student, primary and secondary contacts alike. Per-member
    // outcomes come back for the toast; failures never fail the sync.
    const memberInputs: ToddleFamilyMemberInput[] = familyParents
      .filter((p) => (p.first_name ?? "").trim() && (p.last_name ?? "").trim())
      .map((p) => {
        const digits = (p.phone ?? "").replace(/\D/g, "");
        const memberPhone =
          digits.length === 10
            ? `+1${digits}`
            : digits.length === 11 && digits.startsWith("1")
              ? `+${digits}`
              : digits || undefined;
        const memberEmail = (p.email ?? "").trim();
        return {
          firstName: p.first_name.trim(),
          lastName: p.last_name.trim(),
          email: /@/.test(memberEmail) ? memberEmail : undefined,
          phoneNumber: memberPhone,
          relationship: (p.relationship ?? "").trim() || undefined,
        };
      });
    let familyMembers: Awaited<ReturnType<typeof syncFamilyMembers>> = [];
    try {
      familyMembers = await syncFamilyMembers(result.toddleId, memberInputs);
    } catch (err) {
      console.error(
        `[/api/admin/students/${id}/toddle-sync] family member sync failed:`,
        err
      );
    }

    // Crew → membership in the matching "Crew …" Toddle class (adds
    // to the right one, pulls out of a stale one on crew moves).
    const crewName = (packet?.crew_assignment ?? "").trim();
    const crew = crewName
      ? await syncCrewClass(result.toddleId, crewName)
      : null;

    // Persist the Toddle id back onto the student row so the next
    // sync is a direct update. Routed through the admin API group
    // like the other admin-added columns. Best-effort: if the
    // columns haven't been added in Xano yet the write is a no-op /
    // failure, and the sourceId lookup still keeps syncs idempotent.
    let persisted = false;
    try {
      await xano.students.updateOnAdminGroup(id, {
        toddle_student_id: result.toddleId,
        toddle_synced_at: Date.now(),
      });
      persisted = true;
    } catch (err) {
      console.error(
        `[/api/admin/students/${id}/toddle-sync] couldn't persist toddle_student_id:`,
        err
      );
    }

    return NextResponse.json({
      ...result,
      persisted,
      photo,
      familyMembers,
      crew,
    });
  } catch (err) {
    if (err instanceof ToddleSyncError) {
      // Admin-fixable condition (missing placement, ambiguous match,
      // unmapped year group) — 422 with the message shown verbatim.
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return handleAdminError(err);
  }
}

/** Pick a fetchable URL out of the Xano image-metadata blob on
 *  `student_photo` — `url` when present, else the public Xano base +
 *  `path`. Mirrors the client-side `resolveFileUrl` on the enrolled
 *  detail page. */
function resolvePhotoUrl(photo: object | null | undefined): string | null {
  if (!photo || typeof photo !== "object") return null;
  const url = (photo as { url?: unknown }).url;
  if (typeof url === "string" && url.length > 0) return url;
  const path = (photo as { path?: unknown }).path;
  if (typeof path === "string" && path.length > 0) {
    const base =
      process.env.NEXT_PUBLIC_XANO_BASE ??
      "https://xsc3-mvx7-r86m.n7e.xano.io";
    return `${base}${path}`;
  }
  return null;
}

/** Download an image and return it as a raw base64 string (no
 *  data-URI prefix — Toddle's profileImageUpload takes the bare
 *  encoded bytes). Caps at 8MB so a mis-uploaded original can't
 *  blow up the request. */
async function fetchImageAsBase64(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`photo fetch failed (${res.status})`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType && !contentType.startsWith("image/")) {
    throw new Error(`photo URL returned non-image content (${contentType})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const MAX_BYTES = 8 * 1024 * 1024;
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(
      `photo too large to push (${Math.round(buffer.byteLength / 1024 / 1024)}MB > 8MB)`
    );
  }
  return buffer.toString("base64");
}
