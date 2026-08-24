import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  createWorkspaceUser,
  ensureOrgUnit,
  extraAllowlist,
  getSignInRestriction,
  setSignInRestriction,
  getOrgUnit,
  getWorkspaceUser,
  isGoogleAdminConfigured,
  moveWorkspaceUserToOu,
  resolveStudentOuPath,
  studentOuPath,
  studentOuPathFor,
} from "@/lib/google-admin";
import type { XanoStudent } from "@/lib/xano";

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
  /** The student's OWN org unit — where a new account is placed and
   *  where their Chromebook's sign-in restriction lives. Named in the
   *  confirm dialog, because "which OU did this land in?" is the
   *  question nobody thinks to ask until a policy doesn't apply. */
  targetOrgUnitPath: string;
  /** False when the PARENT student OU isn't in the Workspace tree, so
   *  the card can say so before the button is pressed rather than
   *  after. The per-student child is created on demand. */
  targetOrgUnitExists: boolean;
  /** True when an existing account already sits in its own OU. False
   *  means it's parked in the parent (or elsewhere) and has nothing
   *  for a device restriction to attach to. */
  inOwnOrgUnit: boolean;
  /** Whether that OU's sign-in restriction is actually ON
   *  (`deviceAllowNewUsers: RESTRICTED_LIST`). Reported because a
   *  populated allowlist with the mode never switched looks armed in
   *  the console and enforces nothing — which is the state this org's
   *  hand-built OUs were found in. */
  signInRestricted: boolean;
  /** Who that OU currently lets sign in. Empty when unknown. */
  signInAllowlist: string[];
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
      targetOrgUnitPath: student
        ? studentOuPathFor(displayName(student))
        : studentOuPath(),
      targetOrgUnitExists: false,
      inOwnOrgUnit: false,
      signInRestricted: false,
      signInAllowlist: [],
    };
    if (!base.configured || !email) return NextResponse.json(base);

    // Never let a Google failure 500 this — it backs a status line on
    // a card that must still render. Same contract as the laptop
    // sign-in card.
    try {
      // The parent is what has to pre-exist; the per-student child is
      // created when the account is. `targetOrgUnitPath` is resolved
      // rather than assumed — a student whose OU already exists under
      // the other spelling is ALREADY in their own OU, and reporting
      // otherwise would offer a "move" that creates a second one.
      const [user, parentOu, resolved] = await Promise.all([
        getWorkspaceUser(email),
        getOrgUnit(studentOuPath()).catch(() => null),
        student
          ? resolveStudentOuPath(displayName(student)).catch(
              () => base.targetOrgUnitPath
            )
          : Promise.resolve(base.targetOrgUnitPath),
      ]);
      base.targetOrgUnitExists = parentOu !== null;
      base.targetOrgUnitPath = resolved;
      if (user) {
        base.exists = true;
        base.suspended = user.suspended;
        base.orgUnitPath = user.orgUnitPath;
        base.inOwnOrgUnit =
          user.orgUnitPath.trim().toLowerCase() ===
          base.targetOrgUnitPath.trim().toLowerCase();
      }

      // Whether the student's OU actually restricts sign-in. Read
      // separately and tolerantly — a Chrome Policy hiccup shouldn't
      // cost the card its account status, which is the part an admin
      // came for.
      const ownOu = await getOrgUnit(base.targetOrgUnitPath).catch(() => null);
      if (ownOu) {
        const policy = await getSignInRestriction(ownOu.orgUnitId).catch(
          () => null
        );
        if (policy) {
          base.signInRestricted = policy.restricted;
          base.signInAllowlist = policy.allowlist;
        }
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

    // The student gets their OWN org unit under the student OU, and
    // the account is created inside it. Not cosmetic: the Chromebook
    // sign-in restriction is a policy on an org unit, and the laptop
    // route puts BOTH the policy and the device on this same path —
    // so the path has to agree, which is why it comes from the shared
    // resolver. The OU is armed below, so it's already restricted the
    // moment a Chromebook is moved in.
    //
    // The PARENT is verified, never created: adding "/SailFuture
    // Academy/Student" to someone's tree is a structural change and a
    // misconfigured env would do it silently. The per-student child
    // IS created — that's the point of this call.
    const parentPath = studentOuPath();
    if (!(await getOrgUnit(parentPath).catch(() => null))) {
      return NextResponse.json(
        {
          error: `The student org unit "${parentPath}" doesn't exist in Workspace. Create it, or set GOOGLE_STUDENT_OU to the right path.`,
        },
        { status: 409 }
      );
    }
    const orgUnitPath = await resolveStudentOuPath(displayName(student));
    const ou = await ensureOrgUnit(orgUnitPath);

    const created = await createWorkspaceUser({
      email,
      firstName: student.first_name ?? "",
      lastName: student.last_name ?? "",
      password,
      orgUnitPath,
    });

    return NextResponse.json({
      ok: true,
      email: created.primaryEmail,
      orgUnitPath: created.orgUnitPath,
      signInRestricted: await armSignInRestriction(ou.orgUnitId, email),
    });
  } catch (err) {
    // Google's own message is the useful part here (weak password,
    // domain mismatch, missing scope) — pass it through rather than
    // flattening to "couldn't create".
    console.error("[/api/admin/students/[id]/google-account] create failed:", err);
    return NextResponse.json({ error: hint(err) }, { status: 502 });
  }
}

/**
 * Move an account that already exists into the student's own OU.
 *
 *   PATCH → { ok, email, orgUnitPath }
 *
 * For the students who predate this app placing accounts: they sit
 * directly in the student OU, so their Chromebook's sign-in
 * restriction has no per-student org unit to attach to. Creates the
 * OU if it isn't there and moves only `orgUnitPath` — nothing else on
 * the account is touched.
 */
export async function PATCH(
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
    const email = (student?.school_email ?? "").trim().toLowerCase();
    if (!student || !email) {
      return NextResponse.json(
        { error: "This student has no school email saved yet." },
        { status: 409 }
      );
    }
    const user = await getWorkspaceUser(email);
    if (!user) {
      return NextResponse.json(
        { error: `No Google account exists at ${email} yet.` },
        { status: 409 }
      );
    }

    const parentPath = studentOuPath();
    if (!(await getOrgUnit(parentPath).catch(() => null))) {
      return NextResponse.json(
        {
          error: `The student org unit "${parentPath}" doesn't exist in Workspace. Create it, or set GOOGLE_STUDENT_OU to the right path.`,
        },
        { status: 409 }
      );
    }
    const orgUnitPath = await resolveStudentOuPath(displayName(student));
    const ou = await ensureOrgUnit(orgUnitPath);
    const moved = await moveWorkspaceUserToOu(email, orgUnitPath);

    return NextResponse.json({
      ok: true,
      email: moved.primaryEmail,
      orgUnitPath: moved.orgUnitPath || orgUnitPath,
      // Re-arm on a move too: the allowlist names an address, so a
      // student whose email changed leaves a stale one behind. This is
      // what corrects an OU still allowlisting last year's address.
      signInRestricted: await armSignInRestriction(ou.orgUnitId, email),
    });
  } catch (err) {
    console.error("[/api/admin/students/[id]/google-account] move failed:", err);
    return NextResponse.json({ error: hint(err) }, { status: 502 });
  }
}

/**
 * Arm the student's OU so only they (plus IT) can sign in on a
 * Chromebook placed there.
 *
 * The restriction is a DEVICE policy: it does nothing until a device
 * is moved into the OU, and the Laptops page re-applies it when one
 * is. Setting it here means the OU is already live the moment a
 * Chromebook lands — rather than depending on someone remembering to
 * press Restrict, which is exactly how this org ended up with OUs
 * carrying a correct allowlist and `deviceAllowNewUsers` never
 * switched to RESTRICTED_LIST.
 *
 * Best-effort on purpose. The account is already created by the time
 * this runs; failing the whole request over a policy write would
 * report "couldn't create" for an account that exists. The caller
 * passes the result on so the UI can say what did and didn't land.
 */
async function armSignInRestriction(
  orgUnitId: string,
  email: string
): Promise<boolean> {
  try {
    await setSignInRestriction(orgUnitId, [
      email,
      ...extraAllowlist().filter((e) => e !== email),
    ]);
    return true;
  } catch (err) {
    console.error(
      "[/api/admin/students/[id]/google-account] sign-in policy not applied:",
      err
    );
    return false;
  }
}

/** The name the OU is labelled with — the student's full stored name,
 *  suffix included, matching the OUs already in the tree
 *  ("Craig Mebane Jr."). Unlike the email and the Toddle push, an OU
 *  label is for a human reading the admin console. */
function displayName(student: XanoStudent): string {
  return `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim();
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
