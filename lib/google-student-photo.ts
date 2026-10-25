import {
  deleteWorkspaceUserPhoto,
  getWorkspaceUser,
  isGoogleAdminConfigured,
  setWorkspaceUserPhoto,
} from "@/lib/google-admin";
import { fetchImageBytes, resolvePhotoUrl } from "@/lib/student-photo";

/**
 * Mirror the admin-uploaded student headshot (`student_photo` on the
 * student row) onto the student's Google Workspace account, so the
 * same picture shows in Gmail, Meet, Classroom and on the Chromebook
 * sign-in screen.
 *
 * Called from two places:
 *   - the admin student PATCH, whenever `student_photo` is written
 *     (upload / replace → set, remove → delete), and
 *   - School Account creation, so a photo uploaded BEFORE the account
 *     existed lands the moment it does.
 *
 * Always best-effort: the Xano write has already happened by the time
 * this runs, so nothing here throws — every outcome comes back as a
 * status the caller can show. "skipped" covers the states that aren't
 * errors (Google not configured, no school email, no account yet);
 * "failed" is a real attempt that Google or the photo fetch refused.
 */

export type GooglePhotoSyncStatus = "synced" | "removed" | "skipped" | "failed";

export interface GooglePhotoSync {
  status: GooglePhotoSyncStatus;
  /** One human sentence for a toast / log line. */
  detail: string;
  /** Set on "skipped" so the UI can decide which skips are worth a
   *  word — a missing account is actionable, a missing env var isn't. */
  reason?: "unconfigured" | "no_email" | "no_account";
}

export async function syncStudentPhotoToGoogle(input: {
  studentId: number;
  /** The student's `school_email` — the Workspace account address. */
  email: string | null | undefined;
  /** The `student_photo` value being saved: Xano image metadata to
   *  set the photo, or null/undefined to remove it. */
  photo: object | null | undefined;
  /** Skip the account lookup because the caller just created it. */
  accountExists?: boolean;
}): Promise<GooglePhotoSync> {
  const tag = `[google-student-photo] student ${input.studentId}:`;

  if (!isGoogleAdminConfigured()) {
    return {
      status: "skipped",
      reason: "unconfigured",
      detail: "Google Admin isn't configured.",
    };
  }
  const email = (input.email ?? "").trim().toLowerCase();
  if (!email) {
    return {
      status: "skipped",
      reason: "no_email",
      detail: "No school email on file yet, so there's no Google account to update.",
    };
  }

  try {
    if (!input.accountExists) {
      const user = await getWorkspaceUser(email);
      if (!user) {
        return {
          status: "skipped",
          reason: "no_account",
          detail: `No Google account exists at ${email} yet — the photo will be set when it's created.`,
        };
      }
    }

    if (input.photo == null) {
      await deleteWorkspaceUserPhoto(email);
      console.log(`${tag} removed Google profile photo for ${email}`);
      return {
        status: "removed",
        detail: `Removed the Google profile photo for ${email}.`,
      };
    }

    // A metadata blob with no fetchable URL is a broken save, not a
    // removal — leave whatever Google has rather than wiping it.
    const url = resolvePhotoUrl(input.photo);
    if (!url) {
      return {
        status: "failed",
        detail: "The saved photo has no URL to fetch, so it wasn't sent to Google.",
      };
    }
    const { buffer } = await fetchImageBytes(url);
    await setWorkspaceUserPhoto(email, buffer);
    console.log(`${tag} set Google profile photo for ${email}`);
    return {
      status: "synced",
      detail: `Set as the Google profile photo for ${email}.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${tag} Google photo sync failed:`, err);
    return { status: "failed", detail: message };
  }
}
