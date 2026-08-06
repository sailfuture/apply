"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { apiFetcher, useApplications, useSchoolYears } from "@/hooks/use-api";
import { EnrolledFamilyDashboard } from "@/components/enrolled-family-dashboard";
import { ServiceUnavailable } from "@/components/service-unavailable";
import { LoadingScreen } from "@/components/loading-screen";

// Shared fetcher: throws on !ok (a 401/503 must not masquerade as
// data here — the resolver treats responses as typed rows) and
// retries an expired-session 401 once with a fresh Clerk token.
const fetcher = apiFetcher;

interface YearProgress {
  registration_school_years_id: number;
  isSubmitted?: boolean;
  /** Family-level latch flipped via the admin Family Registration
   *  Confirmation card. Authoritative "this family is enrolled" gate.
   *  When admin unconfirms, this drops to false while `isSubmitted`
   *  and per-student `registrationConfirmed` stay sticky — so we have
   *  to check this here or the parent never regresses out of the
   *  enrolled-dashboard view. */
  isRegistrationConfirmed?: boolean;
}

interface YearPacket {
  registration_school_years_id: number;
  registrationConfirmed?: boolean;
  registration_students_id?: number;
}

interface SchoolYear {
  id: number;
  year_name: string;
}

interface Application {
  registration_school_years_id: number;
  registration_students_id?: number;
  is_residential_addition?: boolean;
}

/** Per-year status for the dashboard year picker.
 *
 * "enrolled" — family completed the registration packets for this
 * year. Standard dashboard cards render (tuition, volunteer hours,
 * family info).
 *
 * "applying" — family has a `family_application_progress` row for
 * this year with `type === "Re-Enrollment"` but registration isn't
 * done yet. Dashboard renders the Re-application Progress card
 * instead of the enrolled-year cards.
 *
 * `null` — neither, this year is excluded from the picker. */
type YearMode = "enrolled" | "applying" | null;

interface ApplyProgressForYear {
  registration_school_years_id: number;
  type?: string;
  family_completed?: boolean;
  students_completed?: boolean;
  financial_aid_completed?: boolean;
  testing_completed?: boolean;
  isSubmitted?: boolean;
  isAccepted?: boolean;
}

/**
 * Enrolled-family home page.
 *
 * Shown only for families who have at least one fully-enrolled academic
 * year — registration submitted AND every student's packet
 * `registrationConfirmed`. The page resolves the most recent enrolled
 * year and hands off to `<EnrolledFamilyDashboard>`. The dashboard
 * itself has a year picker for switching between multi-year enrollments.
 *
 * If the family hasn't reached enrolled status for any year yet, this
 * route bounces back to the application/registration flow at `/`.
 */
export default function EnrolledHomePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Optional ?yearId=X — used by the dashboard's year picker to switch
  // between enrolled years. Without it, we resolve the most recent
  // enrolled year automatically.
  const requestedYearId = (() => {
    const raw = searchParams.get("yearId");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  })();
  const { data: appsData, error: appsError } = useApplications();
  const { data: yearsData, error: yearsError } = useSchoolYears();

  // Years the family has any application for — the candidate set for
  // "which years should we look up registration progress on".
  const candidateYearIds: number[] = useMemo(() => {
    if (!appsData) return [];
    const ids = new Set(
      (appsData as Application[]).map((a) => a.registration_school_years_id)
    );
    return Array.from(ids);
  }, [appsData]);

  // Pull registration progress + packets + family-application progress
  // for every candidate year in parallel via SWR. We pass the joined
  // key so SWR caches the whole bundle as one entry; the fetcher inside
  // hits each per-year endpoint and zips the results.
  //
  // Three signals per year:
  //   1. `registration-progress` for the post-acceptance flow
  //      (`isSubmitted` → tuition/enrollment/registration all done).
  //   2. `student-registration` for the per-student packets
  //      (`registrationConfirmed` → admin verified the packet).
  //   3. `family-progress` for the apply-flow row — used to detect a
  //      re-enrollment in progress (`type === "Re-Enrollment"`). This
  //      surfaces re-applying years in the picker before they're
  //      enrolled.
  const swrKey = candidateYearIds.length
    ? `enrolled-resolver:${candidateYearIds.join(",")}`
    : null;
  const {
    data: yearStatusMap,
    error: yearStatusError,
    isLoading: enrolledLoading,
  } = useSWR<Record<number, { mode: YearMode }>>(
    swrKey,
    async () => {
      // Fault tolerance: 3 fetches × N candidate years means one flaky
      // endpoint (or one year whose Xano lookup 500s) shouldn't take
      // down the whole dashboard. Each fetch degrades to null for its
      // year; we only hard-fail (→ SWR retry → ServiceUnavailable)
      // when a failure occurred AND no year resolved to a usable mode
      // — i.e. we genuinely couldn't determine anything, and silently
      // redirecting an enrolled family back to the apply flow would be
      // wrong.
      let anyFetchFailed = false;
      const safe = (url: string) =>
        fetcher(url).catch((err: unknown) => {
          anyFetchFailed = true;
          console.error(`[enrolled-resolver] ${url} failed:`, err);
          return null;
        });
      const entries = await Promise.all(
        candidateYearIds.map(async (yid) => {
          const [progressRes, packetsRes, applyRes] = await Promise.all([
            safe(`/api/student-registration-progress?yearId=${yid}`),
            safe(`/api/student-registration?yearId=${yid}`),
            safe(`/api/family-progress?yearId=${yid}`),
          ]);
          const progress = progressRes as YearProgress | null;
          const packets = (packetsRes as YearPacket[] | null) ?? [];
          const applyProgress = applyRes as ApplyProgressForYear | null;
          const submitted = !!progress?.isSubmitted;
          // Exclude not-yet-confirmed residential / foster mid-year
          // additions from the "everyone confirmed?" rollup so a fresh
          // addition can't drop the family out of "enrolled" mode. The
          // residential marker lives on the application row; match packets
          // back to it by student id.
          const residentialAddStudentIds = new Set(
            ((appsData as Application[] | undefined) ?? [])
              .filter(
                (a) =>
                  a.registration_school_years_id === yid &&
                  a.is_residential_addition === true
              )
              .map((a) => Number(a.registration_students_id))
          );
          const countedPackets = packets.filter(
            (p) =>
              !(
                residentialAddStudentIds.has(
                  Number(p.registration_students_id)
                ) && p.registrationConfirmed !== true
              )
          );
          const allConfirmed =
            countedPackets.length > 0 &&
            countedPackets.every((p) => p.registrationConfirmed === true);
          // Family-level admin latch — see YearProgress comment. Must
          // be checked alongside `submitted` and `allConfirmed` so the
          // year drops out of "enrolled" mode when admin unconfirms
          // (admin unconfirm only clears this single flag).
          const adminConfirmed = !!progress?.isRegistrationConfirmed;
          // Enrolled takes priority — if the family completed
          // registration for this year, it shows as enrolled even if
          // an apply row also exists (a re-enroller mid-cycle whose
          // registration somehow finished early would still belong on
          // the enrolled card).
          let mode: YearMode = null;
          if (adminConfirmed && submitted && allConfirmed) {
            mode = "enrolled";
          } else if (applyProgress?.type === "Re-Enrollment") {
            mode = "applying";
          }
          return [yid, { mode }] as const;
        })
      );
      const map = Object.fromEntries(entries);
      if (
        anyFetchFailed &&
        !entries.some(([, v]) => v.mode !== null)
      ) {
        throw new Error(
          "enrolled-resolver: year lookups failed and no year resolved"
        );
      }
      return map;
    },
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );

  // Pick which year's dashboard to render. Order of preference:
  //   1. ?yearId=X if it's a valid year in the picker (enrolled or
  //      applying — re-enrollers can deep-link to their next-year
  //      progress card)
  //   2. The most recent enrolled year (highest id)
  //   3. The most recent re-applying year (highest id) — only relevant
  //      when the family has no enrolled year yet (shouldn't happen
  //      since the /dashboard route gates on enrollment, but kept as
  //      a fallback to avoid empty-state edge cases)
  // Years with `mode === null` are excluded so a parent can't deep
  // link to a year they have no relationship to.
  const targetYearId: number | null = useMemo(() => {
    if (!yearStatusMap || !yearsData) return null;
    const pickerYearIds = candidateYearIds.filter(
      (yid) => yearStatusMap[yid]?.mode != null
    );
    if (pickerYearIds.length === 0) return null;
    if (requestedYearId !== null && pickerYearIds.includes(requestedYearId)) {
      return requestedYearId;
    }
    const enrolledIds = pickerYearIds.filter(
      (yid) => yearStatusMap[yid]?.mode === "enrolled"
    );
    if (enrolledIds.length > 0) {
      return enrolledIds.reduce((max, yid) => (yid > max ? yid : max));
    }
    return pickerYearIds.reduce((max, yid) => (yid > max ? yid : max));
  }, [yearStatusMap, yearsData, candidateYearIds, requestedYearId]);

  const yearName = useMemo(() => {
    if (!targetYearId || !yearsData) return "current";
    const found = (yearsData as SchoolYear[]).find((y) => y.id === targetYearId);
    return found?.year_name ?? "current";
  }, [targetYearId, yearsData]);

  // The set of years to show in the picker — enrolled + re-applying
  // years for this family. Mode is passed alongside so the dashboard
  // component knows which cards to render for the selected year. We
  // pass this down to `<EnrolledFamilyDashboard>` so it doesn't
  // re-issue the same per-year fetches we already did to build
  // `yearStatusMap`.
  const availableYears = useMemo(() => {
    if (!yearsData || !yearStatusMap) return [];
    return (yearsData as SchoolYear[])
      .map((y) => {
        const mode = yearStatusMap[y.id]?.mode ?? null;
        if (mode === null) return null;
        return { id: y.id, year_name: y.year_name, mode };
      })
      .filter(
        (y): y is { id: number; year_name: string; mode: "enrolled" | "applying" } =>
          y !== null
      )
      .sort((a, b) => b.id - a.id);
  }, [yearsData, yearStatusMap]);

  // Bounce families with no enrolled or re-applying year back to the
  // application/registration flow. The root year-overview page will
  // route them to the right view. Tracked so the loading skeleton
  // stays up through the redirect window — we don't want the brief
  // "no enrolled year for you" empty render showing before the URL
  // change settles.
  const noEnrolledYear =
    !!appsData &&
    !!yearsData &&
    !enrolledLoading &&
    targetYearId === null;
  useEffect(() => {
    if (noEnrolledYear) {
      router.replace("/");
    }
  }, [noEnrolledYear, router]);

  // Once we know which year is being shown, write it to the URL as
  // `?yearId=X`. The dashboard cards (Tuition, Volunteer Hours) read
  // this back when building their hrefs so the parent lands on the
  // right year — without it, sub-pages fall back to "no students found."
  useEffect(() => {
    if (targetYearId === null) return;
    if (requestedYearId === targetYearId) return;
    router.replace(`/dashboard?yearId=${targetYearId}`);
  }, [targetYearId, requestedYearId, router]);

  // Surface a friendly "we're making improvements" card once any of the
  // three fetches has exhausted SWR's retry budget (capped at 3 in
  // `<SWRProvider>`). Without this the page falls back to `loading`
  // forever — `appsData` / `yearsData` stay undefined while `error` is
  // set, so the spinner never resolves.
  const hasError = !!(appsError || yearsError || yearStatusError);
  if (hasError) {
    return <ServiceUnavailable />;
  }

  const loading =
    !appsData || !yearsData || enrolledLoading || targetYearId === null;

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4">
        <LoadingScreen />
      </div>
    );
  }

  return (
    <EnrolledFamilyDashboard
      yearId={targetYearId}
      yearName={yearName}
      submittedDate={null}
      availableYears={availableYears}
    />
  );
}
