"use client";

import { useMemo } from "react";
import useSWR from "swr";
import {
  familyRequirements,
  studentDetailsRequirements,
  financialAidRequirements,
  type Requirement,
  type SectionCheckResult,
  type SectionKey,
} from "@/lib/application-schemas";
import { useFamily, useStudents, useApplications, useScholarship } from "@/hooks/use-api";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function totalForSection(section: SectionKey): number {
  // Each section's "total" is the number of atomic requirements we can hit.
  // Rough estimates — used only to show "X of Y" progress, not to gate submit.
  switch (section) {
    case "family":
      return 9; // 9 required parent fields
    case "students":
      return 5; // 5 required student-app fields
    case "financial_aid":
      return 6; // 1 SUFS award + 5 OS fields (varies by path)
  }
}

/**
 * Aggregates per-section completion status from the existing SWR caches.
 * Returns per-section missing items + overall readiness for Submit.
 */
export function useSubmitReadiness(yearId: number) {
  const { data: family } = useFamily();
  const { data: students } = useStudents();
  const { data: applications } = useApplications();
  const familyId = (family as { id?: number } | undefined)?.id ?? null;
  const { data: scholarship } = useScholarship(familyId, yearId);
  const scholarshipId = (scholarship as { id?: number } | undefined)?.id ?? null;
  const { data: fullScholarship } = useSWR<Record<string, unknown> | null>(
    scholarshipId ? `/api/scholarship/${scholarshipId}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );

  return useMemo<{ sections: SectionCheckResult[]; ready: boolean; loading: boolean }>(() => {
    const loading = !family || !students || !applications;
    if (loading) {
      return { sections: [], ready: false, loading: true };
    }

    const yearApps = (applications as { registration_school_years_id: number }[]).filter(
      (a) => a.registration_school_years_id === yearId
    );
    const studentList = students as { id: number; first_name?: string; last_name?: string }[];
    const studentLookup = (id: number) => studentList.find((s) => s.id === id);

    const familyMissing: Requirement[] = familyRequirements(
      (family as { parents?: unknown[] }).parents ?? []
    );
    const studentsMissing: Requirement[] = studentDetailsRequirements(
      yearApps as { id?: number; registration_students_id?: number }[],
      studentLookup
    );

    // For Financial Aid, assemble the OS snapshot in the shape the schema expects.
    const opp = (fullScholarship as { opportunity_scholarship?: Record<string, unknown> } | null)?.opportunity_scholarship;
    const osInput = (() => {
      if (!opp) return null;
      if (opp.isNotParticipating) return { path: "none" as const, isNotParticipating: true as const };
      if (opp.isSNAPBenefits) {
        return {
          path: "snap" as const,
          isSNAPBenefits: true as const,
          snap_benefits: Array.isArray(opp.snap_benefits) ? opp.snap_benefits : [],
        };
      }
      if (opp.isOpportunityScholarship) {
        return {
          path: "full" as const,
          isOpportunityScholarship: true as const,
          household_adults: Number(opp.household_adults ?? 0),
          household_children: Number(opp.household_children ?? 0),
          family_contribution_per_month: Number(opp.family_contribution_per_month ?? 0),
          scholarship_advocacy_letter: String(opp.scholarship_advocacy_letter ?? ""),
          signature: (opp.signature && typeof opp.signature === "object" ? opp.signature : {}) as Record<string, unknown>,
        };
      }
      return null;
    })();

    const finAidMissing: Requirement[] = financialAidRequirements({
      applications: yearApps as unknown as {
        id: number;
        registration_students_id: number;
        sufs_award_id?: number;
      }[],
      studentLookup,
      opportunity: osInput ?? { path: "none" }, // force a failing schema if nothing picked
    });

    // If no OS path picked at all, add a top-level requirement
    if (!osInput) {
      finAidMissing.unshift({
        key: "opportunity.path",
        label: "Opportunity Scholarship: choose a path (not participating, SNAP, or full application)",
        jumpTo: "#opportunity-start",
      });
    }

    const sections: SectionCheckResult[] = [
      {
        section: "family",
        complete: familyMissing.length === 0,
        total: totalForSection("family"),
        missing: familyMissing,
      },
      {
        section: "students",
        complete: studentsMissing.length === 0 && yearApps.length > 0,
        total: totalForSection("students"),
        missing: yearApps.length === 0
          ? [{ key: "students.none", label: "Add at least one student" }]
          : studentsMissing,
      },
      {
        section: "financial_aid",
        complete: finAidMissing.length === 0,
        total: totalForSection("financial_aid"),
        missing: finAidMissing,
      },
    ];

    return {
      sections,
      ready: sections.every((s) => s.complete),
      loading: false,
    };
  }, [family, students, applications, fullScholarship, yearId]);
}
