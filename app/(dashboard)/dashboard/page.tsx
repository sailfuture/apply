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

  // Pull progress + packets for every candidate year in parallel via SWR.
  // We pass the joined key so SWR caches the whole bundle as one entry;
  // the fetcher inside hits each per-year endpoint and zips the results.
  const swrKey = candidateYearIds.length
    ? `enrolled-resolver:${candidateYearIds.join(",")}`
    : null;
  const { data: enrolledMap, isLoading: enrolledLoading } = useSWR<
    Record<number, { submitted: boolean; allConfirmed: boolean }>
  >(
    swrKey,
    async () => {
      const entries = await Promise.all(
        candidateYearIds.map(async (yid) => {
          const [progressRes, packetsRes] = await Promise.all([
            fetch(`/api/student-registration-progress?yearId=${yid}`).then((r) => r.json()),
            fetch(`/api/student-registration?yearId=${yid}`).then((r) => r.json()),
          ]);
          const progress = progressRes as YearProgress | null;
          const packets = (packetsRes as YearPacket[] | null) ?? [];
          const submitted = !!progress?.isSubmitted;
          const allConfirmed =
            packets.length > 0 && packets.every((p) => p.registrationConfirmed === true);
          return [yid, { submitted, allConfirmed }] as const;
        })
      );
      return Object.fromEntries(entries);
    },
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );

  // Pick which year's dashboard to render. Order of preference:
  //   1. ?yearId=X if it's a valid enrolled year
  //   2. The most recent enrolled year (highest id)
  // Years that aren't enrolled are filtered out so a parent can't deep
  // link to a year they haven't reached enrollment for yet.
  const targetYearId: number | null = useMemo(() => {
    if (!enrolledMap || !yearsData) return null;
    const enrolledYearIds = candidateYearIds.filter(
      (yid) => enrolledMap[yid]?.submitted && enrolledMap[yid]?.allConfirmed
    );
    if (enrolledYearIds.length === 0) return null;
    if (requestedYearId !== null && enrolledYearIds.includes(requestedYearId)) {
      return requestedYearId;
    }
    return enrolledYearIds.reduce((max, yid) => (yid > max ? yid : max));
  }, [enrolledMap, yearsData, candidateYearIds, requestedYearId]);

  const yearName = useMemo(() => {
    if (!targetYearId || !yearsData) return "current";
    const found = (yearsData as SchoolYear[]).find((y) => y.id === targetYearId);
    return found?.year_name ?? "current";
  }, [targetYearId, yearsData]);

  // The set of enrolled years, in picker order (most recent first). We
  // pass this down to <EnrolledFamilyDashboard> so it doesn't re-issue
  // the same per-year /api/student-registration calls we already did to
  // build `enrolledMap`.
  const availableYears = useMemo(() => {
    if (!yearsData || !enrolledMap) return [];
    return (yearsData as SchoolYear[])
      .filter((y) => enrolledMap[y.id]?.submitted && enrolledMap[y.id]?.allConfirmed)
      .sort((a, b) => b.id - a.id);
  }, [yearsData, enrolledMap]);

  // Bounce families with no enrolled year back to the application/registration
  // flow. The root year-overview page will route them to the right view.
  useEffect(() => {
    if (!appsData || !yearsData) return;
    if (enrolledLoading) return;
    if (targetYearId === null) {
      router.replace("/");
    }
  }, [appsData, yearsData, enrolledLoading, targetYearId, router]);

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
