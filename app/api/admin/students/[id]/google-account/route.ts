import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  createWorkspaceUser,
  getWorkspaceUser,
  isGoogleAdminConfigured,
} from "@/lib/google-admin";

/**
 * Create the student's Google Workspace account from the credentials
 * the School Account card already generated.
 *
 *   GET  → does an account exist at the stored address yet?
 *   POST → create it at exactly that address + password.
 *
 * The card generates `first.lastYY@sailfuture.org` and a starter
 * password and stores both on the student row; until now someone had
 * to retype them into the Workspace console, which is where typos
 * turn into a student who can't log in on day one. This creates the
 * account from the stored values, so what admin sees in the app is
 * what works at the login screen.
 *
 * Deliberately reads the STORED `school_email` / `school_password`
 * rather than regenerating: if the generator ever changes, the
 * account must match the credential that was already handed out, not
 * whatever today's rules would produce.
 */

export interface StudentGoogleAccountStatus {
  /** False = env not set; every other field is then moot. */
  configured: boolean;
  /** The address the card generated ("" = nothing saved yet). */
  email: string;
  /** True once a Workspace account exists at that address. */
  exists: boolean;
  suspended: boolean;
  orgUnitPath: string;
  /** Set when configured but Google couldn't be reached — the card
   *  shows this instead of implying the account is missing. */
  error?: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const id = await studentId(params);
    if (!id) {
      return NextResponse.json({ error: "Invalid student id" }, { status: 400 });
    }

    const student = await xano.students.getById(id).catch(() => null);
    const email = (student?.school_email ?? "").trim().toLowerCase();
    const base: StudentGoogleAccountStatus = {
      configured: isGoogleAdminConfigured(),
      email,
      exists: false,
      suspended: false,
      orgUnitPath: "",
    };
    if (!base.configured || !email) return NextResponse.json(base);

    // Never let a Google failure 500 this — it backs a status line on
    // a card that must still render. Same contract as the laptop
    // sign-in card.
    try {
      const user = await getWorkspaceUser(email);
      if (user) {
        base.exists = true;
        base.suspended = user.suspended;
        base.orgUnitPath = user.orgUnitPath;
      }
    } catch (err) {
      console.error(
        `[/api/admin/students/${id}/google-account] lookup failed:`,
        err
      );
      base.error = hint(err);
    }
    return NextResponse.json(base);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const id = await studentId(params);
    if (!id) {
      return NextResponse.json({ error: "Invalid student id" }, { status: 400 });
    }
    if (!isGoogleAdminConfigured()) {
      return NextResponse.json(
        { error: "Google Admin integration is not configured" },
        { status: 503 }
      );
    }

    const student = await xano.students.getById(id).catch(() => null);
    if (!student) {
      return NextResponse.json(
        { error: `Student ${id} not found` },
        { status: 404 }
      );
    }
    const email = (student.school_email ?? "").trim().toLowerCase();
    const password = student.school_password ?? "";
    if (!email || !password) {
      return NextResponse.json(
        {
          error:
            "Generate the school account first — pick the enrollment year on the School Account card.",
        },
        { status: 409 }
      );
    }

    // Pre-flight so the common "already there" case reads as a plain
    // statement rather than Google's 409 entity-exists text.
    const existing = await getWorkspaceUser(email).catch(() => null);
    if (existing) {
      return NextResponse.json(
        {
          error: `A Google account already exists for ${email}.`,
          exists: true,
        },
        { status: 409 }
      );
    }

    const created = await createWorkspaceUser({
      email,
      firstName: student.first_name ?? "",
      lastName: student.last_name ?? "",
      password,
    });

    return NextResponse.json({
      ok: true,
      email: created.primaryEmail,
      orgUnitPath: created.orgUnitPath,
    });
  } catch (err) {
    // Google's own message is the useful part here (weak password,
    // domain mismatch, missing scope) — pass it through rather than
    // flattening to "couldn't create".
    console.error("[/api/admin/students/[id]/google-account] create failed:", err);
    return NextResponse.json({ error: hint(err) }, { status: 502 });
  }
}

/** Name the two failures that actually happen; otherwise pass
 *  Google's sentence through. */
function hint(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/unauthorized_client|invalid_grant/i.test(msg)) {
    return (
      "Google rejected the service account. Authorize its client ID for " +
      "the admin.directory.user scope in the Workspace admin console " +
      "(Security → API controls → Domain-wide delegation), and confirm " +
      "GOOGLE_ADMIN_IMPERSONATE is a super-admin."
    );
  }
  if (/\b40[13]\b|permission|forbidden/i.test(msg)) {
    return `Google denied the request — check the impersonated admin's privileges. (${msg})`;
  }
  return msg;
}

async function studentId(
  params: Promise<{ id: string }>
): Promise<number | null> {
  const { id: idParam } = await params;
  const id = Number(idParam);
  return Number.isFinite(id) && id > 0 ? id : null;
}
