"use client";

import Link from "next/link";
import useSWR from "swr";
import {
  ChevronDown,
  ClipboardList,
  FileText,
  GraduationCap,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import type { AdminFamilyOverviewResponse } from "@/app/api/admin/family-overview/[id]/route";

/**
 * Cross-surface stage navigation — one consistent, self-contained
 * control for moving between a family's three admissions surfaces:
 *
 *   Application  → /admin/families/[familyId]
 *   Registration → /admin/registrations/[familyId]
 *   Enrollment   → /admin/enrolled/[studentId]  (per student)
 *
 * Renders as a segmented group so it reads as "where am I in the
 * funnel", visually distinct from the page's one-off actions. All
 * three stages always render; the one you're on is highlighted and
 * inert rather than hidden, so the control never changes shape as
 * you move between surfaces.
 *
 * Stages gate on the funnel: Registration needs an application for
 * the year, Enrollment needs a registration. A stage the family
 * hasn't reached renders disabled with a reason on hover instead of
 * linking somewhere empty.
 *
 * Availability is resolved here rather than passed in — the three
 * host pages hold different slices of the family's data, and asking
 * each to derive the same two booleans produced inconsistent gating.
 * The overview payload is shared by key, so SWR serves it from cache
 * on surfaces that already load it.
 *
 * Enrollment is per-student: one student links directly, multiple
 * render a dropdown. Enrollment links carry `from=<current stage>`
 * so the student page's back button returns HERE.
 */
export type AdmissionStage = "application" | "registration" | "enrollment";

export function StageNav({
  current,
  familyId,
  yearId,
  students = [],
}: {
  current: AdmissionStage;
  familyId: number;
  /** Selected school year — propagated on every link. */
  yearId: number | string | null | undefined;
  /** The year's students, for the per-student Enrollment jump. */
  students?: Array<{ id: number; name: string }>;
}) {
  const { data } = useSWR<AdminFamilyOverviewResponse>(
    familyId ? `/api/admin/family-overview/${familyId}` : null,
    adminFetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 }
  );

  if (!familyId) return null;
  const year = yearId ? `?yearId=${yearId}` : "";
  const yearNum = Number(yearId) || 0;

  // Until the payload lands we can't tell reached-from-unreached, so
  // stages stay enabled — a button that starts disabled and flips
  // live reads as broken.
  const inYear = (rowYearId: unknown) =>
    !yearNum || Number(rowYearId) === yearNum;
  const hasApplication = data
    ? data.applications.some((a) => inYear(a.registration_school_years_id))
    : true;
  const hasRegistration = data
    ? data.registration_progress.some((p) =>
        inYear(p.registration_school_years_id)
      )
    : true;

  const enrollmentReady = hasRegistration && students.length > 0;
  const enrollmentReason = !hasRegistration
    ? "No registration for this year yet"
    : students.length === 0
      ? "No students on this family for this year"
      : "";

  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5">
      <StageButton
        icon={<FileText className="size-3.5 mr-1.5" />}
        label="Application"
        active={current === "application"}
        href={`/admin/families/${familyId}${year}`}
      />
      <StageButton
        icon={<ClipboardList className="size-3.5 mr-1.5" />}
        label="Registration"
        active={current === "registration"}
        href={`/admin/registrations/${familyId}${year}`}
        disabled={!hasApplication}
        reason="No application for this year yet"
      />
      {current === "enrollment" ? (
        <StageButton
          icon={<GraduationCap className="size-3.5 mr-1.5" />}
          label="Enrollment"
          active
          href=""
        />
      ) : !enrollmentReady ? (
        <StageButton
          icon={<GraduationCap className="size-3.5 mr-1.5" />}
          label="Enrollment"
          active={false}
          href=""
          disabled
          reason={enrollmentReason}
        />
      ) : students.length === 1 ? (
        <StageButton
          icon={<GraduationCap className="size-3.5 mr-1.5" />}
          label="Enrollment"
          active={false}
          href={`/admin/enrolled/${students[0].id}${year}${
            year ? "&" : "?"
          }from=${current}`}
        />
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 bg-transparent">
              <GraduationCap className="size-3.5 mr-1.5" />
              Enrollment
              <ChevronDown className="size-3.5 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {students.map((s) => (
              <DropdownMenuItem key={s.id} asChild>
                <Link
                  href={`/admin/enrolled/${s.id}${year}${
                    year ? "&" : "?"
                  }from=${current}`}
                >
                  {s.name}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/**
 * Family-scoped sibling navigation — a second segmented group for the
 * per-student surfaces: the family overview first, then one segment
 * per student in the family, with the student being viewed rendered
 * as the current (filled, inert) segment. Lets admin hop between
 * siblings without routing back through a list page.
 *
 * Reads the same `/api/admin/family-overview` payload as `StageNav`
 * (same SWR key — pages showing both pay for one fetch). All of the
 * family's students render, including archived/unenrolled ones: their
 * detail pages are still valid destinations, and a sibling silently
 * missing from the group reads as a bug.
 */
export function FamilyStudentsNav({
  familyId,
  yearId,
  currentStudentId,
}: {
  familyId: number;
  /** Selected school year — propagated on every link. */
  yearId: number | string | null | undefined;
  /** The student whose page we're on — rendered as the active segment. */
  currentStudentId: number;
}) {
  const { data } = useSWR<AdminFamilyOverviewResponse>(
    familyId ? `/api/admin/family-overview/${familyId}` : null,
    adminFetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 }
  );

  if (!familyId) return null;
  const year = yearId ? `?yearId=${yearId}` : "";
  const students = data?.students ?? [];

  return (
    <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5">
      <StageButton
        icon={<Users className="size-3.5 mr-1.5" />}
        label="Family"
        active={false}
        href={`/admin/families/${familyId}/overview${year}`}
      />
      {students.map((s) => {
        const name =
          `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() ||
          `Student #${s.id}`;
        return (
          <StageButton
            key={s.id}
            icon={null}
            label={name}
            active={s.id === currentStudentId}
            href={`/admin/enrolled/${s.id}${year}`}
          />
        );
      })}
    </div>
  );
}

/**
 * One segment. Three states: current (filled, inert, `aria-current`),
 * available (ghost link), unreachable (disabled with a `title`
 * explaining what's missing — a dead-looking button with no reason is
 * worse than no button).
 */
function StageButton({
  icon,
  label,
  active,
  href,
  disabled = false,
  reason = "",
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  href: string;
  disabled?: boolean;
  reason?: string;
}) {
  if (active) {
    return (
      <span
        aria-current="page"
        className={cn(
          "inline-flex h-8 items-center rounded-md bg-background px-3",
          "text-sm font-semibold shadow-sm ring-1 ring-border"
        )}
      >
        {icon}
        {label}
      </span>
    );
  }
  if (disabled) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled
        title={reason}
        className="h-8 bg-transparent"
      >
        {icon}
        {label}
      </Button>
    );
  }
  return (
    <Button asChild variant="ghost" size="sm" className="h-8 bg-transparent">
      <Link href={href}>
        {icon}
        {label}
      </Link>
    </Button>
  );
}
