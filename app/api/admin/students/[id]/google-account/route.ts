import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import {
  createWorkspaceUser,
  ensureOrgUnit,
  getSignInRestriction,
  getOrgUnit,
  getWorkspaceUser,
  isGoogleAdminConfigured,
  isAtOrUnderOu,
  resolveStudentOuPath,
  seniorOuPath,
  studentOuParentForAccount,
  studentOuPath,
  studentOuPathFor,
} from "@/lib/google-admin";
import {
  armSignInRestriction,
  bringLaptopAlong,
  loadHeldLaptopIndex,
  moveAccountIntoOu,
  studentOuDisplayName as displayName,
} from "@/lib/google-student-ou";
import {
  syncStudentPhotoToGoogle,
  type GooglePhotoSync,
} from "@/lib/google-student-photo";

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
  /** True when the account sits in the Seniors tree (directly in the
   *  Seniors OU, or in the student's own OU beneath it). When it does,
   *  `targetOrgUnitPath` is their OU THERE — the card must never offer
   *  a "move to their own org unit" that drags a senior back. */
  inSeniors: boolean;
  /** The Seniors OU itself, named in the move dialog. */
  seniorParentPath: string;
  /** False when the Seniors OU isn't in the Workspace tree — the move
   *  is offered disabled, with the reason, rather than failing late. */
  seniorParentExists: boolean;
  /** The student OU, named in the "move back" dialog. */
  studentParentPath: string;
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
      inSeniors: false,
      seniorParentPath: seniorOuPath(),
      seniorParentExists: false,
      studentParentPath: studentOuPath(),
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
      //
      // WHICH parent comes from where the account is: a senior's own
      // OU is the one under Seniors, so the account is looked up
      // first and the resolve waits for it.
      const [user, studentParent, seniorParent] = await Promise.all([
        getWorkspaceUser(email),
        getOrgUnit(studentOuPath()).catch(() => null),
        getOrgUnit(seniorOuPath()).catch(() => null),
      ]);
      base.seniorParentExists = seniorParent !== null;
      base.inSeniors =
        !!user && isAtOrUnderOu(user.orgUnitPath, seniorOuPath());
      base.targetOrgUnitExists =
        (base.inSeniors ? seniorParent : studentParent) !== null;
      if (student) {
        const parent = studentOuParentForAccount(user?.orgUnitPath);
        base.targetOrgUnitPath = await resolveStudentOuPath(
          displayName(student),
          { parent, prefer: user?.orgUnitPath }
        ).catch(() => studentOuPathFor(displayName(student), parent));
      }
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

    // A headshot uploaded on the Student Photo card BEFORE the account
    // existed had nowhere to go; now it does. Best-effort like the
    // sign-in policy — the account is already created, so the result
    // is reported, never thrown. No photo on file → nothing to push.
    const photo: GooglePhotoSync = student.student_photo
      ? await syncStudentPhotoToGoogle({
          studentId: id,
          email,
          photo: student.student_photo,
          accountExists: true,
        })
      : { status: "skipped", detail: "No student photo on file." };

    return NextResponse.json({
      ok: true,
      email: created.primaryEmail,
      orgUnitPath: created.orgUnitPath,
      signInRestricted: await armSignInRestriction(ou.orgUnitId, email),
      photo,
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
 *
 *   PATCH { target: "seniors" } → move them to the Seniors tree
 *   PATCH { target: "student" } → move them back
 *
 * With a `target` the account changes TREE: into the student's own OU
 * under `/SailFuture Academy/Seniors` (or back under the student OU).
 * That OU is armed with the same sign-in restriction — this student
 * plus the IT allowlist — and a Chromebook they hold follows them
 * into it, so the laptop stays locked to them across the move. With
 * no `target` the account stays in whichever tree it is already in.
 *
 * The OU they leave is kept, policy and all: student OUs are never
 * deleted, and an armed OU with no device in it restricts nothing.
 */
export async function PATCH(
  req: NextRequest,
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

    const body = (await req.json().catch(() => null)) as {
      target?: unknown;
    } | null;
    const target =
      body?.target === "seniors" || body?.target === "student"
        ? body.target
        : null;

    // Verified, never created — same rule as the student OU on create.
    // Conjuring "/SailFuture Academy/Seniors" out of a typo'd env var
    // would be a structural change to someone's directory.
    const parentPath =
      target === "seniors"
        ? seniorOuPath()
        : target === "student"
          ? studentOuPath()
          : studentOuParentForAccount(user.orgUnitPath);
    if (!(await getOrgUnit(parentPath).catch(() => null))) {
      const isSenior = parentPath === seniorOuPath();
      return NextResponse.json(
        {
          error: `The ${isSenior ? "Seniors" : "student"} org unit "${parentPath}" doesn't exist in Workspace. Create it, or set ${
            isSenior ? "GOOGLE_SENIOR_OU" : "GOOGLE_STUDENT_OU"
          } to the right path.`,
        },
        { status: 409 }
      );
    }
    const orgUnitPath = await resolveStudentOuPath(displayName(student), {
      parent: parentPath,
      prefer: user.orgUnitPath,
    });
    // Ensure the OU, arm it, then move the account in — shared with
    // the 12th grade card's bulk move (lib/google-student-ou.ts).
    const moved = await moveAccountIntoOu(email, orgUnitPath);

    return NextResponse.json({
      ok: true,
      email: moved.email,
      orgUnitPath: moved.orgUnitPath,
      signInRestricted: moved.signInRestricted,
      // Only a change of tree moves the laptop: within one tree the
      // device's OU is the same path before and after.
      laptopNote: target
        ? await bringLaptopAlong({
            // Handed over still loading: it is awaited inside, so a
            // roster outage reads as "laptop didn't move", not as a
            // failed account move.
            held: loadHeldLaptopIndex(),
            studentId: id,
            studentName: displayName(student),
            email,
            ouPath: moved.ouPath,
          })
        : "",
    });
  } catch (err) {
    console.error("[/api/admin/students/[id]/google-account] move failed:", err);
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
