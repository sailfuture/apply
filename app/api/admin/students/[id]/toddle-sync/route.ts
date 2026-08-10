import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  isToddleConfigured,
  upsertStudent,
  uploadStudentProfileImage,
  ToddleSyncError,
} from "@/lib/toddle";

/**
 * Admin-only "Sync to Toddle" — pushes one enrolled student into the
 * school's Toddle org. Updates the existing Toddle student when one
 * matches (stored id → sourceId lookup → name fallback, see
 * `lib/toddle.ts#upsertStudent`), creates one when none does.
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

    const result = await upsertStudent(
      {
        sourceId: `sfa-${id}`,
        firstName,
        lastName,
        dob,
        gender,
        phoneNumber,
        gradeLevel: gradeLevel || undefined,
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

    return NextResponse.json({ ...result, persisted, photo });
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
