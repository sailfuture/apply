"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { useApplications, useSchoolYears } from "@/hooks/use-api";
import { EnrolledFamilyDashboard } from "@/components/enrolled-family-dashboard";
import { Skeleton } from "@/components/ui/skeleton";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface YearProgress {
  registration_school_years_id: number;
  isSubmitted?: boolean;
}

interface YearPacket {
  registration_school_years_id: number;
  registrationConfirmed?: boolean;
}

interface SchoolYear {
  id: number;
  year_name: string;
}

interface Application {
  registration_school_years_id: number;
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
  const { data: appsData } = useApplications();
  const { data: yearsData } = useSchoolYears();

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
  const { data: yearStatusMap, isLoading: enrolledLoading } = useSWR<
    Record<number, { mode: YearMode }>
  >(
    swrKey,
    async () => {
      const entries = await Promise.all(
        candidateYearIds.map(async (yid) => {
          const [progressRes, packetsRes, applyRes] = await Promise.all([
            fetch(`/api/student-registration-progress?yearId=${yid}`).then(
              (r) => r.json()
            ),
            fetch(`/api/student-registration?yearId=${yid}`).then((r) =>
              r.json()
            ),
            fetch(`/api/family-progress?yearId=${yid}`).then((r) => r.json()),
          ]);
          const progress = progressRes as YearProgress | null;
          const packets = (packetsRes as YearPacket[] | null) ?? [];
          const applyProgress = applyRes as ApplyProgressForYear | null;
          const submitted = !!progress?.isSubmitted;
          const allConfirmed =
            packets.length > 0 &&
            packets.every((p) => p.registrationConfirmed === true);
          // Enrolled takes priority — if the family completed
          // registration for this year, it shows as enrolled even if
          // an apply row also exists (a re-enroller mid-cycle whose
          // registration somehow finished early would still belong on
          // the enrolled card).
          let mode: YearMode = null;
          if (submitted && allConfirmed) {
            mode = "enrolled";
          } else if (applyProgress?.type === "Re-Enrollment") {
            mode = "applying";
          }
          return [yid, { mode }] as const;
        })
      );
      return Object.fromEntries(entries);
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

  const loading =
    !appsData || !yearsData || enrolledLoading || targetYearId === null;

  if (loading) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div className="flex items-center justify-between border-b pb-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-64" />
          </div>
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-6 space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-16 w-full" />
          </div>
        ))}
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
