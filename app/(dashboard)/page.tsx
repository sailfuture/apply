import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { xano, ensureParentRecord } from "@/lib/xano";
import { getAdminForEmail } from "@/lib/admin-auth";

/**
 * Root landing page. Single decision-and-redirect — collapses what
 * used to be a multi-hop chain (`/` → `/apply/year/X` → `/registration/year/X`
 * → `/dashboard`) into one server-side hop straight to the final
 * destination. The previous chain caused visible white-frame flashes
 * between hops because each hop was a full browser navigation; the
 * destination pages then re-redirected client-side once their data
 * resolved.
 *
 * Resolution order (first match wins):
 *   1. Not signed in            → /sign-in
 *   2. Email matches admin list → /admin
 *   3. No parent record / no family → /welcome
 *   4. No upcoming or active year → / (renders nothing — degenerate state)
 *   5. Family has at least one student `registrationConfirmed` for the
 *      target year AND the registration progress row is `isSubmitted`
 *                              → /dashboard?yearId=X (enrolled)
 *   6. Family is accepted (any app for the year, or family-level
 *      `isAccepted`)            → /registration/year/X
 *   7. Otherwise (still applying / under review)
 *                              → /apply/year/X
 *
 * The destination pages still keep their client-side stage detection
 * as a safety net — if a parent manually types `/apply/year/X` while
 * they're actually accepted, the page will correct them. But for the
 * sign-in landing path, no further redirect should fire because we
 * sent them straight to the right URL.
 */
export default async function Page() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  // Step 1 — admin short-circuit. MUST run before `ensureParentRecord`
  // so we never create a junk `registration_parents` row for a staff
  // member signing in for the first time.
  for (const e of user.emailAddresses ?? []) {
    if (!e.emailAddress) continue;
    const matched = await getAdminForEmail(e.emailAddress);
    if (matched) redirect("/admin");
  }

  // Step 2 — make sure the family record is resolved + cached on Clerk
  // metadata. New users hit `/welcome` to create their family.
  let familyId = user.publicMetadata.registration_families_id as
    | number
    | undefined;
  if (!familyId) {
    const parent = await ensureParentRecord(userId, user);
    const family = await xano.families.findByParentId(parent.id);
    if (!family) redirect("/welcome");
    const clerk = await clerkClient();
    await clerk.users.updateUserMetadata(userId, {
      publicMetadata: { registration_families_id: family.id },
    });
    familyId = family.id;
  }

  // Step 3 — pick the target school year. Upcoming year wins (it's the
  // one parents are most likely to be acting on); active year is the
  // fallback for the late-summer transition window.
  let targetYearId: number | null = null;
  try {
    const years = await xano.schoolYears.getAll();
    const upcoming = years.find((y) => y.isNextYear);
    const active = years.find((y) => y.isActive);
    const target = upcoming ?? active;
    if (target) targetYearId = target.id;
  } catch {
    /* leave null; degenerate-state fallback below */
  }
  // No target year resolved — either Xano's school-years lookup failed
  // or no year is flagged upcoming/active. Render an explicit message
  // instead of redirecting: this page used to bounce to /welcome here,
  // but /welcome bounces family-having users straight back to `/`, so a
  // school-years outage produced an infinite `/` ↔ `/welcome` loop that
  // looked like an endless loading screen.
  if (!targetYearId) {
    return (
      <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4">
        <div className="max-w-md text-center space-y-2">
          <h1 className="text-xl font-semibold">
            No enrollment period is currently open
          </h1>
          <p className="text-muted-foreground text-sm">
            We couldn&apos;t load the current school year. Please refresh
            the page in a moment, or contact us at{" "}
            <a
              href="mailto:tward@sailfuture.org"
              className="text-primary underline underline-offset-2"
            >
              tward@sailfuture.org
            </a>{" "}
            if this keeps happening.
          </p>
        </div>
      </div>
    );
  }

  // Step 4 — fan out the lifecycle queries in parallel. We need all
  // four to compute the final destination without bouncing through
  // intermediate URLs.
  const packetsUrl = `${process.env.XANO_API_BASE_URL}/registration_student_registration?registration_school_years_id=${targetYearId}&registration_families_id=${familyId}`;
  // `family` itself no longer carries `isAccepted` / `isSubmitted` —
  // those moved to the per-year `family_application_progress` row,
  // which we already fetch below as `appProgress`. We still pull the
  // family record for non-acceptance reasons (could be needed later);
  // for now, the dropped flags just live elsewhere.
  const [yearApps, appProgress, regProgress, yearPackets] = await Promise.all([
    xano.applications
      .getByFamilyId(familyId)
      .then((apps) =>
        apps.filter(
          (a) => Number(a.registration_school_years_id) === targetYearId
        )
      )
      .catch(() => []),
    xano.familyApplicationProgress
      .getByFamilyAndYear(familyId, targetYearId)
      .catch(() => null),
    xano.studentRegistrationProgress
      .getByFamilyAndYear(familyId, targetYearId)
      .catch(() => null),
    fetch(packetsUrl, { cache: "no-store" })
      .then(async (res) => {
        type Packet = {
          registrationConfirmed?: boolean;
          registration_students_id?: number;
        };
        if (!res.ok) return [] as Packet[];
        const items = await res.json();
        return (Array.isArray(items) ? items : []).filter(
          (p: { registration_families_id?: number }) =>
            Number(p.registration_families_id) === familyId
        ) as Packet[];
      })
      .catch(
        () =>
          [] as {
            registrationConfirmed?: boolean;
            registration_students_id?: number;
          }[]
      ),
  ]);

  // Step 5 — derive lifecycle state and pick the final URL. `isAccepted`
  // now lives on the per-year application-progress row; we fall back to
  // any per-app flag in case the family-level flag hasn't been flipped
  // yet but admin already moved a student forward.
  const isAccepted =
    appProgress?.isAccepted === true ||
    yearApps.some((a) => a.isAccepted === true);

  // `isRegistrationConfirmed` is the family-level latch admin flips
  // via the Family Registration Confirmation card. It's the
  // authoritative gate for "this family is officially enrolled" —
  // without it, the parent stays in the registration flow even if
  // every per-student packet has been admin-verified, because admin
  // unconfirm only clears this single field (`isSubmitted` +
  // per-student `registrationConfirmed` are deliberately sticky on
  // unconfirm — see app/api/admin/registration-progress/route.ts).
  const isRegistrationConfirmed =
    regProgress?.isRegistrationConfirmed === true;
  const isRegistrationSubmitted = regProgress?.isSubmitted === true;
  // Residential / foster mid-year additions get their own application +
  // packet. Until admin confirms that student's packet, exclude it from
  // the family-level "everyone confirmed?" rollup — otherwise a fresh,
  // unconfirmed addition would bounce the already-enrolled family out of
  // their dashboard (this gate requires EVERY packet confirmed). The
  // marker lives on the application row; packets join back via student id.
  const residentialAddStudentIds = new Set(
    yearApps
      .filter((a) => a.is_residential_addition === true)
      .map((a) => Number(a.registration_students_id))
  );
  const countedPackets = yearPackets.filter(
    (p) =>
      !(
        residentialAddStudentIds.has(Number(p.registration_students_id)) &&
        p.registrationConfirmed !== true
      )
  );
  const allPacketsConfirmed =
    countedPackets.length > 0 &&
    countedPackets.every((p) => p.registrationConfirmed === true);
  const isEnrolled =
    isRegistrationConfirmed && isRegistrationSubmitted && allPacketsConfirmed;

  if (isAccepted && isEnrolled) {
    redirect(`/dashboard?yearId=${targetYearId}`);
  }
  if (isAccepted) {
    redirect(`/registration/year/${targetYearId}`);
  }
  redirect(`/apply/year/${targetYearId}`);
}
