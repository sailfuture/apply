import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type { XanoStudent } from "@/lib/xano";

/**
 * Per-file admin confirmation for required student documents.
 *
 *   PATCH /api/admin/students/:id/document-file
 *   Body: {
 *     fieldKey: "birth_certificate" | "school_health_form" |
 *               "transcripts" | "immunization_forms",
 *     fileIndex: number,
 *     confirmed: boolean,
 *   }
 *
 * Each file metadata blob inside the field's array carries its own
 * `confirmed` + `confirmed_at` + `confirmed_admin` audit triplet,
 * separate from the slot-level `*_admin_confirm` bool on the student
 * row. This route flips the per-file confirm AND recomputes the
 * slot-level bool so downstream gates (Students section verify) keep
 * working without a separate update path.
 *
 * Recompute rule for the slot bool: `true` when every file in the
 * array has `confirmed === true` AND the array has at least one file.
 * Empty arrays leave the slot bool `false`.
 *
 * Audit stamps land on the FILE blob (inline) and on the slot's
 * audit columns. The slot audit reflects the most recent per-file
 * action — admin can still see who/when in the file row itself for
 * granular history.
 */

const FIELD_TO_CONFIRM_KEY: Record<
  string,
  {
    confirmKey: keyof XanoStudent;
    timeKey: keyof XanoStudent;
    adminKey: keyof XanoStudent;
  }
> = {
  birth_certificate: {
    confirmKey: "birth_certificate_admin_confirm",
    timeKey: "birth_certificate_admin_confirm_time",
    adminKey: "birth_certificate_admin_confirm_admin",
  },
  school_health_form: {
    confirmKey: "school_health_form_admin_confirm",
    timeKey: "school_health_form_admin_confirm_time",
    adminKey: "school_health_form_admin_confirm_admin",
  },
  transcripts: {
    confirmKey: "transcripts_admin_confirm",
    timeKey: "transcripts_admin_confirm_time",
    adminKey: "transcripts_admin_confirm_admin",
  },
  immunization_forms: {
    confirmKey: "immunization_admin_confirm",
    timeKey: "immunization_admin_confirm_time",
    adminKey: "immunization_admin_confirm_admin",
  },
};

const VALID_FIELDS = new Set(Object.keys(FIELD_TO_CONFIRM_KEY));

interface FileMetadata extends Record<string, unknown> {
  confirmed?: boolean;
  confirmed_at?: number | null;
  confirmed_admin?: string;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin } = await requireAdmin();
    const { id: idParam } = await params;
    const studentId = Number(idParam);
    if (!Number.isFinite(studentId) || studentId <= 0) {
      return NextResponse.json(
        { error: "Invalid student id" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const fieldKey = body?.fieldKey;
    const fileIndex = Number(body?.fileIndex);
    const confirmed = body?.confirmed === true;

    if (typeof fieldKey !== "string" || !VALID_FIELDS.has(fieldKey)) {
      return NextResponse.json(
        {
          error: `fieldKey must be one of: ${Array.from(VALID_FIELDS).join(", ")}`,
        },
        { status: 400 }
      );
    }
    if (!Number.isInteger(fileIndex) || fileIndex < 0) {
      return NextResponse.json(
        { error: "fileIndex must be a non-negative integer" },
        { status: 400 }
      );
    }

    // Fetch current state so we can read-modify-write the file array.
    // The student row carries each file column as a JSON array of
    // metadata blobs — we mutate one entry and PATCH the whole array
    // back. Same pattern admin uploads use.
    const student = await xano.students.getById(studentId);
    const rawFiles = (student as unknown as Record<string, unknown>)[fieldKey];
    const files: FileMetadata[] = Array.isArray(rawFiles)
      ? (rawFiles.slice() as FileMetadata[])
      : [];
    if (fileIndex >= files.length) {
      return NextResponse.json(
        {
          error: `fileIndex ${fileIndex} is out of range (have ${files.length} file${files.length === 1 ? "" : "s"})`,
        },
        { status: 400 }
      );
    }

    const now = Date.now();
    const adminName = admin?.name ?? "";
    const prev = files[fileIndex] ?? {};
    files[fileIndex] = {
      ...prev,
      confirmed,
      confirmed_at: confirmed ? now : null,
      confirmed_admin: confirmed ? adminName : "",
    };

    // Recompute the slot-level bool — `true` when at least one file
    // exists AND every file is confirmed. Drives the downstream
    // Students section-verify gate, so it stays in sync without the
    // gate code needing to learn about per-file state.
    const slotConfirmed =
      files.length > 0 &&
      files.every((f) => (f as FileMetadata).confirmed === true);

    const { confirmKey, timeKey, adminKey } = FIELD_TO_CONFIRM_KEY[fieldKey];
    const patch: Record<string, unknown> = {
      [fieldKey]: files,
      [confirmKey]: slotConfirmed,
      [timeKey]: slotConfirmed ? now : null,
      [adminKey]: slotConfirmed ? adminName : "",
      last_edited_time: now,
    };

    const updated = await xano.students.updateOnAdminGroup(studentId, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * Remove a single file from a required-document slot.
 *
 *   DELETE /api/admin/students/:id/document-file?fieldKey=...&fileIndex=N
 *
 * Drops the file at `fileIndex` from the field's array and recomputes
 * the slot-level `*_admin_confirm` bool with the SAME rule the PATCH
 * uses (true only when ≥1 file remains AND all are confirmed). Routing
 * removal through here — instead of a plain array PATCH on
 * `/api/admin/students/[id]` — is what keeps an emptied slot from
 * leaving the Students section-verify gate stuck green with no files
 * on file. Optional documents (iep / ssn_card / passport /
 * student_state_id) have no slot bool, so those remove via the plain
 * student PATCH instead.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin } = await requireAdmin();
    const { id: idParam } = await params;
    const studentId = Number(idParam);
    if (!Number.isFinite(studentId) || studentId <= 0) {
      return NextResponse.json(
        { error: "Invalid student id" },
        { status: 400 }
      );
    }

    const fieldKey = req.nextUrl.searchParams.get("fieldKey");
    const fileIndex = Number(req.nextUrl.searchParams.get("fileIndex"));

    if (typeof fieldKey !== "string" || !VALID_FIELDS.has(fieldKey)) {
      return NextResponse.json(
        {
          error: `fieldKey must be one of: ${Array.from(VALID_FIELDS).join(", ")}`,
        },
        { status: 400 }
      );
    }
    if (!Number.isInteger(fileIndex) || fileIndex < 0) {
      return NextResponse.json(
        { error: "fileIndex must be a non-negative integer" },
        { status: 400 }
      );
    }

    // Read-modify-write the file array — same pattern as the PATCH.
    const student = await xano.students.getById(studentId);
    const rawFiles = (student as unknown as Record<string, unknown>)[fieldKey];
    const files: FileMetadata[] = Array.isArray(rawFiles)
      ? (rawFiles.slice() as FileMetadata[])
      : [];
    if (fileIndex >= files.length) {
      return NextResponse.json(
        {
          error: `fileIndex ${fileIndex} is out of range (have ${files.length} file${files.length === 1 ? "" : "s"})`,
        },
        { status: 400 }
      );
    }

    files.splice(fileIndex, 1);

    // Recompute the slot bool exactly as the PATCH does so the verify
    // gate stays in sync. An emptied slot drops to false.
    const now = Date.now();
    const adminName = admin?.name ?? "";
    const slotConfirmed =
      files.length > 0 &&
      files.every((f) => (f as FileMetadata).confirmed === true);

    const { confirmKey, timeKey, adminKey } = FIELD_TO_CONFIRM_KEY[fieldKey];
    const patch: Record<string, unknown> = {
      [fieldKey]: files,
      [confirmKey]: slotConfirmed,
      [timeKey]: slotConfirmed ? now : null,
      [adminKey]: slotConfirmed ? adminName : "",
      last_edited_time: now,
    };

    const updated = await xano.students.updateOnAdminGroup(studentId, patch);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}
