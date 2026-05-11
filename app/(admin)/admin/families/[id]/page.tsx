"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  SquarePen,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
// `StatusBadge` still mounts inside `StudentBio` for the small
// "Accepted" pill — keep the import even though
// `StudentApplicationBlock` no longer uses it.
import { StatusBadge } from "@/components/admin/status-badge";
import { FamilyNotesSheet } from "@/components/admin/family-notes-sheet";
import { DocumentsToReviewBlock } from "@/components/admin/documents-to-review-block";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import { formatNoteTimestamp } from "@/lib/format-note-time";
import type {
  XanoApplication,
  XanoAdminFamilyDetail,
  XanoScholarship,
  XanoScholarshipBenefit,
  XanoScholarshipContributingMember,
  XanoScholarshipHome,
  XanoScholarshipVehicle,
  XanoSchoolYear,
} from "@/lib/xano";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Parent {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  relationship: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  zipcode: string;
}

interface Student {
  id: number;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  ethnicity: string;
  isAccepted: boolean;
  /** Admin-only NWEA initial-screening scores + dates. Live on the
   *  student row so re-enrolling kids keep their score history.
   *  Optional because legacy rows pre-date the columns. Inputs in
   *  the Initial Testing card on this page write through
   *  `/api/admin/students/[id]`. */
  initial_screening_nwea_math?: number | null;
  initial_screening_nwea_reading?: number | null;
  initial_screening_nwea_math_date?: string | null;
  initial_screening_nwea_reading_date?: string | null;
}

interface FamilyResponse {
  id: number;
  family_name: string;
  registration_parents_id: Parent[];
  registration_students_id: Student[];
  registration_emergency_contacts_id: number[];
  // `isSubmitted` and `isAccepted` used to live on this row but moved
  // to the per-year `family_application_progress` row. Header badges
  // now read from there (via `detail.scholarship` / etc.); the flags
  // are intentionally absent from this interface.
}

const xanoBase =
  process.env.NEXT_PUBLIC_XANO_BASE ?? "https://xsc3-mvx7-r86m.n7e.xano.io";

function formatCurrency(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * "Are every confirmable doc on this scholarship marked confirmed?"
 * Mirrors the gating check `<DocumentsToReviewBlock>` exposes — both
 * surfaces (the docs table itself and the per-row Confirm
 * Scholarship Award Amount button) need the same answer, so we
 * compute it once from the same data.
 *
 * Confirmable buckets:
 *   - Contributing-member income docs (W-2, pay stubs) via
 *     `*_confirm` columns.
 *   - Government benefits via `benefit_is_confirmed`.
 *   - SNAP path: `is_snap_confirmed` on the scholarship row,
 *     gated only when at least one SNAP file is uploaded (we
 *     don't block on an empty doc — admin can still approve
 *     before the parent uploads, just shouldn't confirm what
 *     doesn't exist).
 *   - No-contributing-member path: `is_unemployment_confirm` on
 *     the scholarship row, gated only when at least one
 *     unemployment file is uploaded.
 *
 * Edge cases:
 *   - `no_contributing_member=true` → contributing-member slots
 *     drop out of the gate so SNAP-only / unemployment-only paths
 *     can still confirm.
 *   - Member with no uploaded files → that member contributes
 *     nothing to the gate (we can't gate on docs that don't exist).
 *   - Benefits not loaded yet → benefit branch passes through;
 *     the gate is conservative on the way in, not the way out.
 *   - No members loaded yet → contributing-member branch passes
 *     through. The button stays disabled by other criteria
 *     (sufs_type missing) during the initial SWR window.
 */
function computeAllDocsConfirmed(
  scholarship: XanoScholarship | null,
  members: XanoScholarshipContributingMember[],
  benefits: XanoScholarshipBenefit[] = []
): boolean {
  if (!scholarship) return true;

  // Contributing-member slots — only gate when the family has
  // contributing members (else this branch is N/A).
  if (!scholarship.no_contributing_member && members.length > 0) {
    const SLOTS = [
      { filesKey: "w2", confirmKey: "w2_confirm" },
      { filesKey: "paystub_1", confirmKey: "paystub_1_confirm" },
      { filesKey: "paystub_2", confirmKey: "paystub_2_confirm" },
      { filesKey: "paystub_3", confirmKey: "paystub_3_confirm" },
      { filesKey: "paystub_4", confirmKey: "paystub_4_confirm" },
    ] as const;

    for (const m of members) {
      for (const s of SLOTS) {
        const mr = m as unknown as Record<string, unknown>;
        const files = mr[s.filesKey];
        const hasFiles = Array.isArray(files)
          ? files.length > 0
          : !!files && typeof files === "object";
        if (!hasFiles) continue;
        const confirmed = mr[s.confirmKey] === true;
        if (!confirmed) return false;
      }
    }
  }

  // Government benefits — every declared benefit needs its own
  // `benefit_is_confirmed` flag flipped.
  if (scholarship.government_benefits && benefits.length > 0) {
    for (const b of benefits) {
      if (b.benefit_is_confirmed !== true) return false;
    }
  }

  // SNAP path — require `is_snap_confirmed` when SNAP path AND at
  // least one award letter is uploaded.
  if (scholarship.isSNAPBenefits) {
    const snapFiles = Array.isArray(scholarship.snap_benefits)
      ? scholarship.snap_benefits.length
      : 0;
    if (snapFiles > 0 && scholarship.is_snap_confirmed !== true) {
      return false;
    }
  }

  // No-contributing-member path — require
  // `is_unemployment_confirm` when AT LEAST one unemployment letter
  // is uploaded. Same "don't gate on empty docs" treatment as SNAP.
  if (scholarship.no_contributing_member) {
    const unemploymentFiles = Array.isArray(scholarship.unemployment_letter)
      ? scholarship.unemployment_letter.length
      : 0;
    if (
      unemploymentFiles > 0 &&
      scholarship.is_unemployment_confirm !== true
    ) {
      return false;
    }
  }

  return true;
}

export default function FamilyDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const familyId = params.id;

  // Family + parents + students — pulled from the existing endpoint
  // because it expands those relations to full objects (parent contact
  // info, student names + DOB). The new admin_family_application
  // endpoint returns family parents/students as IDs only.
  const { data: family, isLoading, mutate: refreshFamily } =
    useSWR<FamilyResponse>(
      familyId ? `/api/admin/families/${familyId}` : null,
      fetcher
    );

  // Per-year applications + scholarship — single fetch via the new
  // `admin_family_application` Xano query. Only fires when we have both
  // a family and a year in the URL.
  const detailKey =
    familyId && yearId
      ? `/api/admin/family-applications?familyId=${familyId}&yearId=${yearId}`
      : null;
  const { data: detail, isLoading: detailLoading, mutate: refreshDetail } =
    useSWR<XanoAdminFamilyDetail>(detailKey, adminFetcher);

  // Per-year progress row — owns the family-level `isAccepted` flag
  // that the Decision card flips, plus the four per-section completion
  // booleans the sidebar uses to render its check / pencil icons.
  // Also surfaces the section-confirm columns (bool + time + admin
  // name) so the section footers can render their Confirmed/Undo
  // state without a second round trip.
  const { data: progress, mutate: refreshProgress } = useSWR<{
    id: number;
    isAccepted: boolean;
    isSubmitted: boolean;
    submitted_at: number | null;
    family_completed?: boolean;
    students_completed?: boolean;
    financial_aid_completed?: boolean;
    testing_completed?: boolean;
    family_admin_confirm?: boolean;
    family_admin_confirm_time?: number | null;
    family_admin_confirm_admin?: string;
    students_admin_confirm?: boolean;
    students_admin_confirm_time?: number | null;
    students_admin_confirm_admin?: string;
    testing_admin_confirm?: boolean;
    testing_admin_confirm_time?: number | null;
    /** Financial Aid verify — same `*_admin_confirm` /
     *  `*_admin_confirm_time` / `*_admin_confirm_admin` pattern as
     *  Family / Students / Testing above. */
    financial_aid_admin_confirm?: boolean;
    financial_aid_admin_confirm_time?: number | null;
    financial_aid_admin_confirm_admin?: string;
    /** Scholarship Determination verify triplet. Bool is
     *  `scholarship_admin_complete` but the timestamp lives on
     *  `scholarship_complete_admin_time` (word order flipped vs
     *  the bool — see `XanoFamilyApplicationProgress`). */
    scholarship_admin_complete?: boolean;
    scholarship_complete_admin_time?: number | null;
    scholarship_admin_complete_admin?: string;
  } | null>(
    familyId && yearId
      ? `/api/admin/family-progress?familyId=${familyId}&yearId=${yearId}`
      : null,
    adminFetcher
  );

  // Per-section confirm action — wraps the admin family-progress
  // PATCH so each section's footer can toggle its bool with one
  // call. Tracks the in-flight section locally so the spinner is
  // scoped to whichever section admin clicked. The audit name comes
  // from the `*_admin_confirm_admin` string column the route
  // auto-stamps; no client-side teacher-id lookup needed anymore.
  const [savingSection, setSavingSection] = useState<
    | "family"
    | "students"
    | "financial_aid"
    | "scholarship"
    | "testing"
    | null
  >(null);
  async function toggleSectionConfirmed(
    section:
      | "family"
      | "students"
      | "financial_aid"
      | "scholarship"
      | "testing",
    next: boolean
  ) {
    if (!familyId || !yearId) return;
    setSavingSection(section);
    try {
      // Most sections follow the `*_admin_confirm` column-naming
      // convention (Family / Students / Testing / Financial Aid).
      // Scholarship Determination uses `scholarship_admin_complete`
      // — admin-owned section's bool was renamed when the section
      // was added. Branch here so the right column gets the PATCH.
      const field =
        section === "scholarship"
          ? "scholarship_admin_complete"
          : `${section}_admin_confirm`;
      const res = await fetch(`/api/admin/family-progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyId: Number(familyId),
          yearId: Number(yearId),
          [field]: next,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Update failed (${res.status})`);
      }
      toast.success(next ? "Section verified." : "Verification cleared.");
      refreshProgress();
    } catch (err) {
      console.error(`[toggleSectionConfirmed.${section}] failed:`, err);
      toast.error(err instanceof Error ? err.message : "Couldn't update.");
    } finally {
      setSavingSection(null);
    }
  }

  const backHref = yearId
    ? `/admin/applications?yearId=${yearId}`
    : "/admin/applications";

  const sectionHref = (slug: string) =>
    `/admin/families/${familyId}/${slug}${yearId ? `?yearId=${yearId}` : ""}`;

  // Scroll to the section named in the URL hash once content has
  // mounted. Triggered by deep links from the Applications list view
  // — clicking a row's "Family" / "Students" / etc. pill pushes
  // `…#section-students` and we need to scroll to it after the page
  // hydrates (Next's router push doesn't fire native hash scrolling
  // when the page is client-cached). Single-shot via the ref so SWR
  // revalidations don't bounce the page back to the top later.
  const didHashScrollRef = useRef(false);
  useEffect(() => {
    if (didHashScrollRef.current) return;
    if (typeof window === "undefined") return;
    if (isLoading) return;
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;
    // Wait one frame so the section <section id="…"> has rendered.
    const handle = requestAnimationFrame(() => {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        didHashScrollRef.current = true;
      }
    });
    return () => cancelAnimationFrame(handle);
  }, [isLoading, detailLoading]);

  // Composite scholarship payload — fetched at the page level so
  // the Financial Aid SectionShell can gate its Verify button on
  // docs being confirmed (admin shouldn't be able to sign off on
  // the section while income paperwork is still unreviewed). SWR
  // dedupes by URL, so `ScholarshipBlock` subscribing to the same
  // key inside the SectionShell body costs nothing — the page and
  // the block share the response.
  //
  // CRITICAL: this hook lives BEFORE the `isLoading || !family`
  // early return below. React's Rules of Hooks require every hook
  // to be called in the same order on every render — putting this
  // after the early return would skip the hook on the first render
  // and call it on subsequent renders, which throws a hook-order
  // mismatch in dev. The key reads `detail?.scholarship?.[0]?.id`
  // directly so it works before `scholarship` is destructured
  // post-return; SWR treats `null` as "disabled" until the id
  // resolves.
  const scholarshipIdForDetails: number | null =
    typeof detail?.scholarship?.[0]?.id === "number"
      ? (detail.scholarship[0].id as number)
      : null;
  const { data: scholarshipDetails } = useSWR<{
    scholarship: XanoScholarship;
    homes: unknown[];
    vehicles: unknown[];
    contributing_members: XanoScholarshipContributingMember[];
    benefits: XanoScholarshipBenefit[];
  }>(
    scholarshipIdForDetails != null
      ? `/api/admin/scholarship-details?id=${scholarshipIdForDetails}`
      : null,
    adminFetcher
  );

  if (isLoading || !family) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  // Filter out bare-id entries Xano sometimes mixes into the
  // expanded relation arrays — same fix as the per-section editors.
  const parents: Parent[] = (family.registration_parents_id ?? []).filter(
    (p): p is Parent =>
      !!p && typeof p === "object" && typeof (p as { id?: unknown }).id === "number"
  );
  const allStudents: Student[] = (family.registration_students_id ?? []).filter(
    (s): s is Student =>
      !!s && typeof s === "object" && typeof (s as { id?: unknown }).id === "number"
  );
  // The admin family-applications endpoint already filters
  // `isActive=false` rows out — `familyApps` here is the active set.
  const familyApps: XanoApplication[] = detail?.application ?? [];
  const scholarship: XanoScholarship | null = detail?.scholarship?.[0] ?? null;
  const yearMeta = detail?.school_year ?? null;

  // `allDocsConfirmed` derives from the composite payload fetched
  // above (the useSWR call lives pre-early-return so the hook
  // order stays stable across renders).
  const allDocsConfirmed = scholarship
    ? computeAllDocsConfirmed(
        scholarship,
        scholarshipDetails?.contributing_members ?? [],
        scholarshipDetails?.benefits ?? []
      )
    : false;

  // When a year is selected, narrow the visible students to ones with
  // an active application for that year. Without a year we can't make
  // an "is this student active for X" decision, so we show the full
  // list as a family-level overview.
  const students: Student[] = yearId
    ? allStudents.filter((s) =>
        familyApps.some((a) => Number(a.registration_students_id) === s.id)
      )
    : allStudents;

  return (
    <>
    <div className="flex gap-6 p-6">
      {/* The `<aside>` is a width-reserving placeholder in the flex
          layout — it keeps the main content from sliding left into
          the side nav's 220px column. The actual nav content below
          uses `position: fixed` (NOT `sticky`) for the same reason
          the parent-side ApplicationSideNav does:
          when Radix opens a Select / Dialog it engages
          `react-remove-scroll`, which sets inline `overflow: hidden
          !important` on `<html>`. Sticky descendants lose their
          scroll context and snap to the top of the containing
          block — the visible "left nav jumps up" bug. Fixed
          positioning sidesteps the scroll-lock entirely.

          The `left` calc anchors to the `max-w-7xl` admin layout's
          inner padding edge: `(viewport - 1280px) / 2 + 24px`
          simplifies to `50vw - 616px`. The `max(1.5rem, …)` guard
          catches narrower viewports — though xl: (≥1280px) is wide
          enough that the calc branch is always selected. */}
      <aside className="hidden xl:block w-[220px] shrink-0">
        <div
          className="fixed top-20 w-[220px]"
          style={{ left: "max(1.5rem, calc(50vw - 616px))" }}
        >
          <FamilyDetailNav
            backHref={backHref}
            yearId={yearId}
            progress={progress ?? null}
            hasScholarship={!!scholarship}
          />
        </div>
      </aside>

      <main className="flex-1 min-w-0 space-y-6">
        {/* Page header — family name + year on a single line, with the
            primary admin actions (Return Application / Approve) on
            the right. Action buttons live up here so admins don't
            have to scroll to act. */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold truncate">
              {family.family_name || `Family #${family.id}`}
              {yearMeta ? (
                <span className="ml-2 text-base font-normal text-muted-foreground">
                  · {yearMeta.year_name}
                </span>
              ) : null}
            </h1>
          </div>
          {/* Header action row — left-to-right order is deliberate:
              destructive Delete on the far left so admin reaches
              for it intentionally (not as muscle memory), Decision
              actions in the middle (the daily work), Export PDF
              just left of Notes (frequent enough to be page-level
              but not the primary action), Notes on the far right
              as the most-clicked utility. All four only render
              when a year is selected — they're year-scoped. */}
          <div className="flex items-center gap-2 shrink-0">
            {yearId ? (
              <DeleteApplicationButton
                familyId={Number(familyId)}
                yearId={Number(yearId)}
                familyName={family.family_name}
              />
            ) : null}
            {yearId ? (
              <FamilyDecisionActions
                familyId={Number(familyId)}
                yearId={Number(yearId)}
                familyName={family.family_name}
                progress={progress ?? null}
                apps={familyApps}
                onChanged={() => {
                  refreshDetail();
                  refreshProgress();
                }}
              />
            ) : null}
            {/* Export PDF — moved up from the Scholarship
                Determination card header so admin doesn't have to
                scroll down to grab the family-acceptance summary.
                Renders only when a year is selected since the PDF
                is per-(family, year). */}
            {yearId ? (
              <ExportPdfButton
                familyId={Number(familyId)}
                yearId={Number(yearId)}
              />
            ) : null}
            {/* Page-header notes drawer is phase-scoped to
                "application" so registration-phase comms (written
                from /admin/registrations/[id]) don't leak into the
                apply-flow timeline. Section-scoped drawers below
                inherit the same scope. */}
            <FamilyNotesSheet
              familyId={family.id}
              defaultYearId={yearId ? Number(yearId) : null}
              phase="application"
            />
          </div>
        </div>

        {/* Decision — primary admin action surface, pinned to the top
            so submitted apps land here without scrolling. Per-student
            SUFS + Opportunity Scholarship awards live inside, plus the
            Accept Family button. */}
        {yearId ? (
          <section id="section-decision" className="scroll-mt-20">
            <DecisionCard
              familyId={Number(familyId)}
              yearId={Number(yearId)}
              familyName={family.family_name}
              students={students}
              apps={familyApps}
              schoolYear={yearMeta}
              scholarship={scholarship}
              progress={progress ?? null}
              loading={detailLoading && !detail}
              onChanged={() => {
                refreshDetail();
                refreshProgress();
              }}
            />
          </section>
        ) : null}

        {/* Notes live in a fixed bottom-right sheet trigger now —
            admins open the comms log without scrolling and the
            composer stays pinned to the bottom of the drawer. The
            section anchor is gone too; nav doesn't link to it. */}

        {/* Parents / Guardians */}
        <section id="section-family" className="scroll-mt-20">
          <SectionShell
            title="Parents / Guardians"
            editHref={sectionHref("family")}
            notes={{
              familyId: family.id,
              section: "section-family",
              title: "Notes — Parents / Guardians",
            }}
            status={deriveSectionStatus(
              progress?.family_completed,
              parents.length > 0
            )}
            confirm={{
              sectionLabel: "Family",
              confirmed: progress?.family_admin_confirm === true,
              parentCompleted: progress?.family_completed === true,
              confirmTime: progress?.family_admin_confirm_time ?? null,
              confirmedByName: progress?.family_admin_confirm_admin?.trim() || null,
              saving: savingSection === "family",
              onToggle: (next) => toggleSectionConfirmed("family", next),
            }}
          >
            {parents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No parents on file.
              </p>
            ) : (
              <div className="space-y-4">
                {parents.map((parent) => (
                  <ParentBlock key={parent.id} parent={parent} />
                ))}
              </div>
            )}
          </SectionShell>
        </section>

        {/* Students — bio + per-app fields per student. The
            section-level Edit affordance moved off this shell —
            each `StudentApplicationBlock` below now ships its own
            sub-header Edit button anchored to the student name, so
            the cross-page editor link at the section level was
            redundant. */}
        <section id="section-students" className="scroll-mt-20">
          <SectionShell
            title={`Students${yearMeta ? ` · ${yearMeta.year_name}` : ""}`}
            notes={{
              familyId: family.id,
              section: "section-students",
              title: "Notes — Students",
            }}
            status={deriveSectionStatus(
              progress?.students_completed,
              students.length > 0
            )}
            confirm={{
              sectionLabel: "Students",
              confirmed: progress?.students_admin_confirm === true,
              parentCompleted: progress?.students_completed === true,
              confirmTime: progress?.students_admin_confirm_time ?? null,
              confirmedByName:
                progress?.students_admin_confirm_admin?.trim() || null,
              saving: savingSection === "students",
              onToggle: (next) => toggleSectionConfirmed("students", next),
            }}
          >
            {students.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No students on file.
              </p>
            ) : !yearId ? (
              <div className="space-y-4">
                {students.map((s) => (
                  <StudentBio
                    key={s.id}
                    student={s}
                    onChanged={() => {
                      refreshFamily();
                      refreshDetail();
                    }}
                  />
                ))}
                <p className="text-xs italic text-muted-foreground">
                  Pick a school year above to load each student&rsquo;s
                  application details.
                </p>
              </div>
            ) : detailLoading && !detail ? (
              <div className="space-y-3">
                <Skeleton className="h-48 w-full rounded-md" />
                <Skeleton className="h-48 w-full rounded-md" />
              </div>
            ) : (
              <div className="space-y-4">
                {students.map((student) => {
                  const app = familyApps.find(
                    (a) => Number(a.registration_students_id) === student.id
                  );
                  return (
                    <StudentApplicationBlock
                      key={student.id}
                      student={student}
                      app={app}
                      onChanged={() => {
                        refreshFamily();
                        refreshDetail();
                      }}
                    />
                  );
                })}
                {familyApps.length === 0 ? (
                  <p className="text-xs italic text-muted-foreground">
                    No application rows for the selected year.
                  </p>
                ) : null}
              </div>
            )}
          </SectionShell>
        </section>

        {/* Financial Aid — only renders when the family actually has a
            scholarship row for this year. */}
        {yearId ? (
          <section id="section-financial-aid" className="scroll-mt-20">
            <SectionShell
              title={`Financial Aid${
                scholarship?.isOpportunityScholarship
                  ? " · Full application"
                  : scholarship?.isSNAPBenefits
                    ? " · SNAP benefits"
                    : scholarship?.isNotParticipating
                      ? " · Opted out"
                      : ""
              }`}
              editHref={sectionHref("financial-aid")}
              notes={{
                familyId: family.id,
                section: "section-financial-aid",
                title: "Notes — Financial Aid Application",
              }}
              status={deriveSectionStatus(
                progress?.financial_aid_completed,
                !!scholarship
              )}
              confirm={{
                sectionLabel: "Financial Aid",
                confirmed:
                  progress?.financial_aid_admin_confirm === true,
                // No separate parent-completion bool for this
                // section — parent saves as they fill it out, so
                // admin verify is the only "this is good" signal.
                parentCompleted:
                  progress?.financial_aid_admin_confirm === true,
                confirmTime:
                  progress?.financial_aid_admin_confirm_time ?? null,
                confirmedByName:
                  progress?.financial_aid_admin_confirm_admin?.trim() ||
                  null,
                saving: savingSection === "financial_aid",
                onToggle: (next) =>
                  toggleSectionConfirmed("financial_aid", next),
                // Section-level gate — Financial Aid surfaces a
                // warning whenever Documents to Review still has
                // unconfirmed items, but does NOT hard-block admin
                // from verifying. `bypassable: true` keeps the
                // Verify button enabled and routes the click
                // through a confirm modal so admin has to
                // acknowledge the override before the PATCH fires.
                // Other sections (e.g. Scholarship) leave
                // `bypassable` unset and the gate hard-disables
                // verify — the docs gate is the only one we
                // intentionally let admin punch through.
                // Only applies in the pre-verify state; once the
                // section is already verified, this gate doesn't
                // re-block undoing.
                disabled:
                  progress?.financial_aid_admin_confirm !== true &&
                  !allDocsConfirmed,
                // disabledReason intentionally omitted — admin
                // sees the Documents to Review counter ("0/2
                // confirmed") right above the footer, so the
                // additional caption was redundant noise. The
                // bypass modal still spells out the gate when
                // admin clicks Verify with docs outstanding.
                bypassable: true,
              }}
            >
              {detailLoading && !detail ? (
                <Skeleton className="h-48 w-full rounded-md" />
              ) : scholarship ? (
                <ScholarshipBlock
                  scholarship={scholarship}
                  familyId={family.id}
                  onScholarshipChanged={refreshDetail}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No scholarship row for this family / year. The parent
                  hasn&rsquo;t opened the Financial Aid section yet.
                </p>
              )}
            </SectionShell>
          </section>
        ) : null}

        {/* Testing */}
        {yearId ? (
          <section id="section-testing" className="scroll-mt-20">
            <SectionShell
              title="Initial Testing (NWEA)"
              editHref={sectionHref("testing")}
              notes={{
                familyId: family.id,
                section: "section-testing",
                title: "Notes — Initial Testing",
              }}
              status={deriveSectionStatus(
                progress?.testing_completed,
                familyApps.some(
                  (a) =>
                    a.nwea_testing_scheduled === true ||
                    a.nwea_testing_complete === true
                )
              )}
              confirm={{
                sectionLabel: "Testing",
                confirmed: progress?.testing_admin_confirm === true,
                parentCompleted: progress?.testing_completed === true,
                confirmTime: progress?.testing_admin_confirm_time ?? null,
                // Testing has no `testing_admin_confirm_admin`
                // column on Xano, so the audit name is always null
                // for this section. Caption renders "Confirmed · 2
                // hr ago" without a name.
                confirmedByName: null,
                saving: savingSection === "testing",
                onToggle: (next) => toggleSectionConfirmed("testing", next),
              }}
            >
              {detailLoading && !detail ? (
                <Skeleton className="h-32 w-full rounded-md" />
              ) : students.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No students on file.
                </p>
              ) : (
                <div className="space-y-4">
                  {students.map((student) => {
                    const app = familyApps.find(
                      (a) =>
                        Number(a.registration_students_id) === student.id
                    );
                    return (
                      <TestingBlock
                        key={student.id}
                        student={student}
                        app={app}
                        onSaved={refreshDetail}
                      />
                    );
                  })}
                </div>
              )}
            </SectionShell>
          </section>
        ) : null}

      </main>
    </div>
    {/* Notes trigger now lives in the page header (rendered above
        next to the Decision actions). The sheet drawer it opens
        renders inside that component too. */}
    </>
  );
}

/* ─────────────────────── Sticky section nav ─────────────────────── */

/**
 * Family-detail sidebar nav. Mirrors the visual treatment of the
 * parent-side `ApplicationSideNav`:
 *   - Outer card with rounded corners + subtle border + shadow
 *   - Inner section list with dividers
 *   - Top row is the back button to /admin/applications
 *   - Each section row has a colored circle icon (green check on
 *     completion, orange edit pencil otherwise) + label
 *
 * Status comes from the per-year `family_application_progress` row.
 * The `hasScholarship` flag toggles the Financial Aid item — even
 * with a year selected, no scholarship means no row to show.
 */
function FamilyDetailNav({
  backHref,
  yearId,
  progress,
  hasScholarship,
}: {
  backHref: string;
  yearId: string | null;
  progress: {
    isAccepted?: boolean;
    family_completed?: boolean;
    students_completed?: boolean;
    financial_aid_completed?: boolean;
    testing_completed?: boolean;
    family_admin_confirm?: boolean;
    students_admin_confirm?: boolean;
    financial_aid_admin_confirm?: boolean;
    testing_admin_confirm?: boolean;
    /** Scholarship Determination verify bool — flips the
     *  Scholarship admin row's icon from gray pending to green
     *  check, and unblocks the Acceptance gate alongside the four
     *  parent-facing section verifies. */
    scholarship_admin_complete?: boolean;
  } | null;
  hasScholarship: boolean;
}) {
  // Nav main icon tracks PARENT completion (green check / amber edit
  // pen), mirroring the parent-side app nav so admin's read of "is
  // the family done with this section?" stays in lockstep with what
  // the parent sees. Admin verification surfaces as a small trailing
  // checkmark on the right side of the row — green when admin has
  // verified, gray when still pending. The two indicators answer
  // two different questions:
  //
  //   - Main circle  → has the FAMILY finished this section?
  //   - End check    → has ADMIN reviewed and verified it?
  //
  // Notes intentionally absent — comms log is now a fixed bottom-right
  // sheet trigger handled outside this nav.
  //
  // Rows split into two groups (admin-owned vs family-facing) so the
  // render below can drop a bolder separator between them. The admin
  // group at the top doesn't have a parent-completion signal — the
  // main icon reads `isAccepted` so it flips green once the family
  // is approved; no trailing verify check on these rows since admin
  // verification is the action itself.
  const adminItems: Array<NavItem> = [
    {
      // Acceptance sits first so admin lands on the resolution
      // surface — that's the action they're heading toward when
      // they open this page. Scholarship follows as the supporting
      // detail rather than the headline row.
      key: "acceptance",
      label: "Acceptance",
      href: "#section-acceptance",
      completed: progress?.isAccepted === true,
      verified: null,
      show: !!yearId,
      isAdmin: true,
    },
    {
      // Scholarship row's main icon tracks the section's verify
      // bool (`scholarship_admin_complete`). Flips to the green
      // check once admin verifies the Scholarship Determination
      // card, satisfying its slot in the Acceptance gate. No
      // trailing verify check since this row IS the verify
      // surface.
      key: "scholarship",
      label: "Scholarship",
      href: "#section-scholarship-determination",
      completed: progress?.scholarship_admin_complete === true,
      verified: null,
      show: !!yearId,
      isAdmin: true,
    },
  ];
  const familyItems: Array<NavItem> = [
    {
      key: "family",
      label: "Family",
      href: "#section-family",
      completed: progress?.family_completed === true,
      verified: progress?.family_admin_confirm === true,
      show: true,
    },
    {
      key: "students",
      label: "Students",
      href: "#section-students",
      completed: progress?.students_completed === true,
      verified: progress?.students_admin_confirm === true,
      show: true,
    },
    {
      key: "financial-aid",
      label: "Financial Aid",
      href: "#section-financial-aid",
      completed: progress?.financial_aid_completed === true,
      verified: progress?.financial_aid_admin_confirm === true,
      show: !!yearId && hasScholarship,
    },
    {
      key: "testing",
      label: "Testing",
      href: "#section-testing",
      completed: progress?.testing_completed === true,
      verified: progress?.testing_admin_confirm === true,
      show: !!yearId,
    },
  ];

  // Smooth-scroll to the targeted section instead of the default
  // browser jump. `scroll-mt-20` on each section already accounts
  // for the admin top nav so the heading isn't slid under it.
  function handleNavClick(
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string
  ) {
    if (!href.startsWith("#")) return;
    const id = href.slice(1);
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    // Update the URL without triggering a jump so the section is
    // shareable / reload-stable.
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", href);
    }
  }

  return (
    <div className="rounded-xl bg-background p-1.5 shadow-sm border">
      <div className="overflow-hidden rounded-lg border">
        <div className="divide-y">
          {/* Back-to-Applications row, styled like the parent app's
              "Dashboard" back button — circular icon + muted label. */}
          <Link
            href={backHref}
            className="flex w-full items-center gap-3 px-3 py-3 text-left text-sm transition-colors hover:bg-muted/30"
          >
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/30 text-muted-foreground">
              <ArrowLeft className="size-3" />
            </div>
            <span className="truncate font-medium text-muted-foreground">
              Applications
            </span>
          </Link>

          {/* Admin section block — Scholarship + Acceptance. No
              trailing verify check since admin actions ARE the
              verify on these rows. */}
          {adminItems
            .filter((i) => i.show)
            .map((item) => (
              <NavRow
                key={item.key}
                item={item}
                onClick={handleNavClick}
              />
            ))}
          {/* No explicit separator between the admin and family-
              facing blocks — the wrapping `divide-y` already draws
              a hairline between every adjacent row, including the
              boundary between the two groups, so any extra
              `border-t` here would render a doubled line that
              reads heavier than the rest of the nav. */}
          {/* Family-facing block — Family / Students / Financial
              Aid / Testing. Each row carries a trailing verify
              check (green when admin verified, gray when pending). */}
          {familyItems
            .filter((i) => i.show)
            .map((item) => (
              <NavRow
                key={item.key}
                item={item}
                onClick={handleNavClick}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

interface NavItem {
  key: string;
  label: string;
  href: string;
  /** Parent-completion bool. Drives the main left-side circle —
   *  green check when the family has marked the section complete,
   *  amber square-pen when they're still editing. For the admin
   *  Scholarship + Acceptance rows this maps to `isAccepted` since
   *  those sections don't have a parent-completion signal. */
  completed: boolean;
  /** Admin-verification bool. Drives the small trailing checkmark
   *  on the right side of the row — green when admin has clicked
   *  Verify on the section, gray when still pending review. `null`
   *  for rows without a separate verify step (Scholarship +
   *  Acceptance); those rows skip the trailing indicator. */
  verified: boolean | null;
  show: boolean;
  /** Admin-only sections (Scholarship, Acceptance) use a softer
   *  not-yet-confirmed state — a gray checkmark — instead of the
   *  amber square-pen the parent-facing rows use. The pen icon
   *  implies "the family is editing this section," which doesn't
   *  apply to admin-owned rows. Gray check reads as "pending
   *  admin's resolution" and flips to green when `completed` is
   *  true (i.e., the family is accepted). */
  isAdmin?: boolean;
}

/**
 * One row in the side nav. Splits the left main icon (parent state)
 * from the right trailing indicator (admin verify state) so admin
 * can scan two independent signals at a glance — "is the family
 * done?" on the left, "have I reviewed it?" on the right.
 */
function NavRow({
  item,
  onClick,
}: {
  item: NavItem;
  onClick: (
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string
  ) => void;
}) {
  return (
    <a
      href={item.href}
      onClick={(e) => onClick(e, item.href)}
      className="flex w-full items-center gap-3 px-3 py-3 text-left text-sm transition-colors hover:bg-muted/30"
    >
      <NavCircle complete={item.completed} isAdmin={item.isAdmin} />
      <span
        className={cn(
          "flex-1 truncate",
          item.completed
            ? "font-semibold text-foreground"
            : "font-medium text-muted-foreground"
        )}
      >
        {item.label}
      </span>
      {/* Trailing admin-verify check — only rendered for rows that
          have a separate verify step (family-facing sections).
          Admin-only rows (Scholarship, Acceptance) pass `null`
          and the indicator drops out so the row stays clean. */}
      {item.verified !== null ? (
        <CheckCircle2
          className={cn(
            "size-4 shrink-0",
            item.verified
              ? "text-emerald-600"
              : "text-muted-foreground/30"
          )}
          aria-label={
            item.verified ? "Admin verified" : "Awaiting admin verification"
          }
        />
      ) : null}
    </a>
  );
}

/**
 * Status circle for a sidebar nav row. Two visual families:
 *
 *   - Parent-facing rows (Family / Students / Financial Aid /
 *     Testing): mirror the parent-side app nav — green check when
 *     the family has marked the section complete, amber square-pen
 *     when they're still editing. Same visual vocabulary admin and
 *     parent see for "is this section done from the family's
 *     side?"
 *
 *   - Admin-owned rows (Scholarship, Acceptance) via `isAdmin`: use
 *     a softer not-yet-resolved state — a gray-on-white check. The
 *     square-pen reads as "edit in progress," which doesn't apply
 *     to admin-owned rows where the parent isn't editing anything.
 *     Flips to the same green check when `complete` is true
 *     (family is accepted) so the two row families share the
 *     resolved state's visual.
 *
 * Admin's separate review state on parent-facing rows surfaces as
 * a small trailing `CheckCircle2` at the right of the row, rendered
 * by `NavRow`.
 */
function NavCircle({
  complete,
  isAdmin,
}: {
  complete: boolean;
  isAdmin?: boolean;
}) {
  if (complete) {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-500 text-white">
        <Check className="size-4" />
      </div>
    );
  }
  if (isAdmin) {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground/60 border border-muted-foreground/20">
        <Check className="size-4" />
      </div>
    );
  }
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
      <SquarePen className="size-4" />
    </div>
  );
}

/* ─────────────────────── Layout shells ─────────────────────── */

type SectionStatus = "complete" | "in_progress" | "not_started";

const STATUS_DOT_CLASS: Record<SectionStatus, string> = {
  complete: "bg-green-500",
  in_progress: "bg-yellow-500",
  not_started: "bg-red-500",
};

const STATUS_LABEL: Record<SectionStatus, string> = {
  complete: "Submitted",
  in_progress: "In progress",
  not_started: "Not started",
};

/**
 * Map (completion bool, has-any-data bool) → tri-state status. The
 * completion bool comes from the per-year `family_application_progress`
 * row; data presence is heuristic (any related row exists / any
 * required field has a value).
 */
function deriveSectionStatus(
  complete: boolean | undefined,
  hasData: boolean
): SectionStatus {
  if (complete) return "complete";
  if (hasData) return "in_progress";
  return "not_started";
}

/**
 * One titled section with an "Open editor" affordance in the top-right.
 * Wraps every card on this page so the visual rhythm matches the
 * application form (card → header with action → content with disabled
 * inputs). When `status` is set, a small colored circle (green /
 * yellow / red) appears next to the title to mirror the parent app's
 * tri-state progress vocabulary.
 */
function SectionShell({
  title,
  editHref,
  status,
  notes,
  confirm,
  children,
}: {
  title: string;
  editHref?: string;
  status?: SectionStatus;
  /**
   * Optional per-section Notes drawer. Section-scoped notes share
   * the same `registration_admin_notes` table the family-wide
   * drawer reads from — they're tagged with a `section` key so the
   * family-wide drawer can group them as "Application Edits" while
   * the per-section drawer filters to just this surface's thread.
   */
  notes?: {
    familyId: number;
    section: string;
    title: string;
  };
  /**
   * Optional admin section-confirm footer. When present, the card
   * renders a divider + footer with `Confirm Section` / `Undo`
   * action and an "audit caption" ("Confirmed by Hunter Thompson ·
   * 2 hr ago") on the left when confirmed. Card body greys to a
   * muted background while confirmed so admin can scan which
   * sections still need review by skimming for the white cards.
   *
   * Approach B (auto-unconfirm): the parent's family-progress
   * cascade clears the confirm flag whenever a section's
   * `*_completed` is flipped, so the only way to keep this confirm
   * sticky is to leave it admin-only.
   */
  confirm?: SectionConfirmConfig;
  children: React.ReactNode;
}) {
  const confirmed = !!confirm?.confirmed;
  const parentCompleted = !!confirm?.parentCompleted;
  // Whole-card mute kicks in only when admin has *verified* the
  // section. The parent marking it complete (`*_completed`) on its
  // own isn't enough — that's still pending review on our side, and
  // a premature gray-out reads as "this is settled" before admin has
  // actually looked. Drops opacity on the entire `<Card>` so the
  // title, status badge, and Edit button read as one settled unit.
  // Footer buttons stay clickable — opacity dims their look but
  // doesn't disable them. `parentCompleted` is still surfaced via
  // the status dot (yellow → in progress, green → done) so admin
  // can scan progress without relying on the mute alone.
  const fullyDone = confirmed;
  // Silence the unused-var warning — `parentCompleted` used to
  // drive `fullyDone` and is kept on the props for future surfaces
  // that may want to reintroduce the parent-completion mute.
  void parentCompleted;
  return (
    <Card
      className={cn(
        "overflow-hidden gap-0 py-0 bg-white transition-opacity",
        fullyDone && "opacity-60"
      )}
    >
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {status ? (
              <span
                className={cn(
                  "inline-block size-2.5 rounded-full shrink-0",
                  STATUS_DOT_CLASS[status]
                )}
                aria-label={STATUS_LABEL[status]}
                title={STATUS_LABEL[status]}
              />
            ) : null}
            <CardTitle className="text-base truncate">{title}</CardTitle>
            {/* Title status badge — three-state pill that mirrors the
                section's verify state at a glance:
                  - verified → green "Verified"
                  - section uses the verify pattern but isn't
                    verified yet → amber "Needs Verification"
                  - section doesn't take a verify config → no badge
                Admin can scan the page top-to-bottom and see which
                sections still need their attention. */}
            {confirm ? (
              confirmed ? (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800">
                  <CheckCircle2 className="size-2.5" />
                  Verified
                </span>
              ) : (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-800">
                  Needs Verification
                </span>
              )
            ) : null}
          </div>
          {/* Notes + Edit pair, docked at the right of the section
              header. Notes opens a section-filtered drawer (its own
              SWR cache key, its own POST scope) scoped to the
              application phase so registration-phase comms don't
              leak in; Edit jumps to the per-section editor route. */}
          <div className="flex items-center gap-2 shrink-0">
            {notes ? (
              <FamilyNotesSheet
                familyId={notes.familyId}
                section={notes.section}
                title={notes.title}
                phase="application"
              />
            ) : null}
            {editHref ? (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="bg-white"
              >
                <Link href={editHref}>
                  <Pencil className="size-4 mr-1" />
                  Edit
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      {/* Body keeps a constant background — the whole-card opacity
          handles the muted look when `fullyDone`. Stacking
          `bg-muted/30` on top of an opacity-reduced parent doubled
          the dimming and made the text harder to read. */}
      <CardContent className="space-y-6 py-5 bg-white">
        {children}
      </CardContent>
      {/* Section-confirm footer — divider + caption on left, action
          on right. Renders only when a `confirm` config is passed;
          otherwise the card ends at its content as before. */}
      {confirm ? <SectionConfirmFooter confirm={confirm} /> : null}
    </Card>
  );
}

/**
 * Config shape for the optional section-confirm footer on
 * `SectionShell`. `confirmed` drives the visual state; `confirmTime`
 * + `confirmedByName` populate the audit caption when confirmed;
 * `onToggle` is the click handler the footer button calls
 * (typically a wrapper around the admin family-progress PATCH).
 */
interface SectionConfirmConfig {
  /** Short name for the section, used in the action button label
   *  ("Confirm Family", "Confirm Students", "Confirm Testing").
   *  Distinct from the card's full title because the title may carry
   *  qualifiers (e.g. "Students · 2026-2027") while the button label
   *  needs to stay stable + scannable. */
  sectionLabel: string;
  confirmed: boolean;
  /** Whether the parent has marked this section complete on their
   *  side (`*_completed` on the family-progress row). Drives the
   *  card-body gray-out: we only mute the section when BOTH the
   *  parent has completed it AND admin has verified — otherwise the
   *  gray reads as a premature lock-in. */
  parentCompleted: boolean;
  confirmTime: number | null;
  confirmedByName: string | null;
  /** Mid-PATCH spinner gate. */
  saving: boolean;
  /** Called with the next desired bool (true → confirm, false → undo). */
  onToggle: (next: boolean) => void;
  /** Section-level gate. When set, the section has unmet prerequisites
   *  (e.g. unconfirmed docs). The reason rides on the button's
   *  `title` tooltip and also renders as a small caption next to
   *  the audit slot so admin sees what's holding things up without
   *  hovering. By default this hard-disables the Verify button.
   *  When `bypassable` is also `true`, the button stays clickable
   *  but a confirm modal interposes — admin can knowingly override
   *  the gate. */
  disabled?: boolean;
  disabledReason?: string;
  /** When `true` and `disabled === true`, the Verify button is
   *  kept enabled but clicking it opens a warning AlertDialog
   *  asking admin to confirm the override. Used by Financial Aid
   *  where admin sometimes needs to verify before every per-doc
   *  Confirm has been clicked (e.g. doc reviewed in person, or
   *  legacy data). Sections that don't want this (Scholarship,
   *  Accept) leave it unset and the gate hard-blocks. */
  bypassable?: boolean;
}

/**
 * Footer for `SectionShell` rendering the confirm/undo action +
 * audit caption. Lives on its own component so the conditional
 * render at the bottom of `SectionShell` stays clean.
 */
function SectionConfirmFooter({ confirm }: { confirm: SectionConfirmConfig }) {
  const {
    sectionLabel,
    confirmed,
    confirmTime,
    confirmedByName,
    saving,
    onToggle,
    disabled,
    disabledReason,
    bypassable,
  } = confirm;
  const [undoOpen, setUndoOpen] = useState(false);
  // Separate state for the bypass-confirm modal so it doesn't
  // collide with the Undo modal — admin could in theory open both
  // workflows in a session, and the two modals carry different
  // copy + actions.
  const [bypassOpen, setBypassOpen] = useState(false);
  // Hard-disable applies only when the section is gated AND the
  // caller hasn't opted into bypass. When `bypassable` is set,
  // the click is still allowed but routes through the warning
  // modal below instead of going straight to `onToggle(true)`.
  const hardDisabled = !!disabled && !bypassable;

  return (
    <div className="border-t bg-white px-5 py-3 flex items-center justify-between gap-3">
      {/* Audit caption slot — four states:
          - saving: skeleton bar so the audit "by X · 2 hr ago"
            slides in smoothly instead of popping in/out as the
            PATCH round-trips
          - verified: actual caption with admin name + time
          - blocked (verify disabled by section-level gate, e.g.
            Financial Aid waiting on doc confirms): the gate reason
            renders here so admin sees what's holding them up
            without hovering the disabled button
          - unverified, no gate: empty (nothing to say yet) */}
      {saving ? (
        <Skeleton className="h-3 w-48" />
      ) : (
        <span className="text-xs text-muted-foreground truncate">
          {confirmed ? (
            <>
              {confirmedByName ? (
                <>
                  Verified by{" "}
                  <span className="font-medium text-foreground">
                    {confirmedByName}
                  </span>
                </>
              ) : (
                "Verified"
              )}
              {confirmTime ? (
                <span> · {formatNoteTimestamp(confirmTime)}</span>
              ) : null}
            </>
          ) : disabled && disabledReason ? (
            <span>{disabledReason}</span>
          ) : null}
        </span>
      )}

      {/* Two visual states:
          - unverified → single primary "Verify <Section>" button
          - verified → muted "Verified" pill + an Undo button next
            to it that opens a warning modal before clearing the
            audit. Two buttons (rather than one toggle) makes the
            "this is locked, but you can unlock it" intent explicit
            and prevents an accidental click from wiping the audit
            stamp. */}
      {confirmed ? (
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            className="bg-muted text-muted-foreground cursor-default disabled:opacity-100"
          >
            <CheckCircle2 className="size-3.5 mr-1.5" />
            {sectionLabel} Section Verified
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setUndoOpen(true)}
            disabled={saving}
            className="bg-white"
          >
            {saving ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : (
              <Undo2 className="size-3.5 mr-1.5" />
            )}
            Undo {sectionLabel}
          </Button>
          <AlertDialog open={undoOpen} onOpenChange={setUndoOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Undo {sectionLabel} verification?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This clears the admin verification on the{" "}
                  {sectionLabel} section. The audit stamp (who and
                  when) will be removed and the section drops back
                  to pending review. You can re-verify at any time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={saving}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={saving}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                  onClick={(e) => {
                    e.preventDefault();
                    onToggle(false);
                    setUndoOpen(false);
                  }}
                >
                  {saving ? (
                    <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  ) : null}
                  Yes, undo
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : (
        <>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => {
              // When the section is gated AND the caller has
              // opted into bypass, intercept the click with a
              // confirm modal rather than firing the PATCH right
              // away. Falls straight through to `onToggle(true)`
              // for ungated sections (the common case).
              if (disabled && bypassable) {
                setBypassOpen(true);
                return;
              }
              onToggle(true);
            }}
            disabled={saving || hardDisabled}
            title={disabled && disabledReason ? disabledReason : undefined}
          >
            {saving ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5 mr-1.5" />
            )}
            Verify {sectionLabel}
          </Button>
          {/* Bypass-confirm dialog — only rendered when the
              section opts in via `bypassable`. Mirrors the Undo
              modal's structure (cancel + amber primary) so admin
              instantly recognizes "you're about to bend a rule"
              rather than "you're filing a routine update." */}
          {bypassable ? (
            <AlertDialog open={bypassOpen} onOpenChange={setBypassOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Verify {sectionLabel} anyway?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {disabledReason ??
                      "Not every prerequisite for this section is complete."}{" "}
                    Verifying now will lock in admin approval without
                    waiting on those items. You can undo this at any
                    time, but the audit stamp will record that you
                    bypassed the gate.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={saving}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={saving}
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={(e) => {
                      e.preventDefault();
                      onToggle(true);
                      setBypassOpen(false);
                    }}
                  >
                    {saving ? (
                      <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                    ) : null}
                    Yes, verify anyway
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </>
      )}
    </div>
  );
}

function SectionGroup({
  title,
  trailing,
  children,
}: {
  title: string;
  /** Optional right-aligned slot rendered inline with the section
   *  title — used today by `EditableStudentDemographics` to anchor
   *  its Edit / Save / Cancel buttons next to the section header
   *  rather than below the body grid. */
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
      {children}
    </section>
  );
}

/* ─────────────────────── Parent block ─────────────────────── */

function ParentBlock({ parent }: { parent: Parent }) {
  return (
    <div className="rounded-md border bg-muted/10 p-4 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">
          {parent.first_name || parent.last_name
            ? `${parent.first_name} ${parent.last_name}`.trim()
            : `Parent #${parent.id}`}
        </p>
      </div>
      {/* `required` flag mirrors what the parent-side family form
          validates as required — name, all contact fields, and a
          street + city + state + zip. Apt/Suite is optional. */}
      <SectionGroup title="Name">
        <div className="grid gap-4 grid-cols-2">
          <DisabledField label="First name" value={parent.first_name} required />
          <DisabledField label="Last name" value={parent.last_name} required />
        </div>
      </SectionGroup>
      <SectionGroup title="Contact">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
          <DisabledField
            label="Email"
            value={parent.email}
            type="email"
            required
          />
          <DisabledField label="Phone" value={parent.phone} required />
          <DisabledField
            label="Relationship"
            value={parent.relationship}
            placeholder="—"
            required
          />
        </div>
      </SectionGroup>
      <SectionGroup title="Address">
        <div className="grid gap-4 grid-cols-1">
          <DisabledField
            label="Street address"
            value={parent.address_line_1}
            required
          />
          <DisabledField label="Apt / suite" value={parent.address_line_2} />
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <DisabledField label="City" value={parent.city} required />
            <DisabledField label="State" value={parent.state} required />
            <DisabledField label="Zip" value={parent.zipcode} required />
          </div>
        </div>
      </SectionGroup>
    </div>
  );
}

/* ─────────────────────── Student blocks ─────────────────────── */

/**
 * Editable date-of-birth input. Read-only in shape (no pencil
 * toggle) — admin can click directly into the `<input type="date">`
 * and the PATCH fires on blur when the value actually changed.
 * Keeps the affordance lightweight: no edit/save buttons, no
 * dirty state, no validation popovers. Same pattern the rest of
 * the inline-saving inputs on the family detail page use.
 */
function EditableStudentDob({
  studentId,
  value,
  onChanged,
}: {
  studentId: number;
  /** YYYY-MM-DD format from Xano. Empty when unset. */
  value: string;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  async function handleBlur() {
    const next = draft.trim();
    if (next === (value ?? "")) return;
    // Empty is allowed — admin may want to clear a wrong DOB while
    // they look up the right one. Persist whatever's in the input.
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/students/${studentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date_of_birth: next }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${res.status})`);
      }
      toast.success("Date of birth saved.");
      onChanged();
    } catch (err) {
      console.error("[EditableStudentDob.handleBlur]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
      // Revert local draft to the last-known persisted value so the
      // input doesn't show stale unsaved typing.
      setDraft(value ?? "");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Field>
      <FieldLabel>
        Date of birth <span className="text-red-500">*</span>
      </FieldLabel>
      <Input
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        disabled={saving}
        className={cn(!draft && "border-red-500")}
      />
    </Field>
  );
}

/** Valid choices for the Gender select in the Student edit mode.
 *  Mirrors the same options the parent-side students form offers
 *  so admin can't pick a value the parent never sees. */
const GENDER_OPTIONS = [
  "Male",
  "Female",
  "Non-binary",
  "Prefer not to say",
] as const;

/** Valid choices for the Ethnicity select — matches the parent
 *  flow. NCES-aligned categories with a "Prefer not to say"
 *  escape hatch. */
const ETHNICITY_OPTIONS = [
  "American Indian or Alaska Native",
  "Asian",
  "Black or African American",
  "Hispanic or Latino",
  "Native Hawaiian or Pacific Islander",
  "White",
  "Two or More Races",
  "Prefer not to say",
] as const;

function StudentBio({
  student,
  onChanged,
}: {
  student: Student;
  onChanged: () => void;
}) {
  return (
    <div className="rounded-md border bg-muted/10 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">
          {student.first_name} {student.last_name}
        </p>
        {student.isAccepted ? <StatusBadge status="accepted" /> : null}
      </div>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <EditableStudentDob
          studentId={student.id}
          value={student.date_of_birth ?? ""}
          onChanged={onChanged}
        />
        <DisabledField label="Gender" value={student.gender} required />
        <DisabledField label="Ethnicity" value={student.ethnicity} required />
      </div>
    </div>
  );
}

function StudentApplicationBlock({
  student,
  app,
  onChanged,
}: {
  student: Student;
  app: XanoApplication | undefined;
  onChanged: () => void;
}) {
  // Edit state lives on the block itself so the sub-header (name)
  // and body (demographics) can swap into edit mode together —
  // first/last name inputs replace the header text in place,
  // keeping the layout from jumping when Edit is clicked.
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    first_name: student.first_name ?? "",
    last_name: student.last_name ?? "",
    date_of_birth: student.date_of_birth ?? "",
    gender: student.gender ?? "",
    ethnicity: student.ethnicity ?? "",
  });

  function enterEdit() {
    setDraft({
      first_name: student.first_name ?? "",
      last_name: student.last_name ?? "",
      date_of_birth: student.date_of_birth ?? "",
      gender: student.gender ?? "",
      ethnicity: student.ethnicity ?? "",
    });
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  async function runSave() {
    // Only send fields that actually changed — keeps the patch
    // lean and avoids overwriting columns the form didn't touch.
    const patch: Record<string, string> = {};
    if (draft.first_name !== (student.first_name ?? ""))
      patch.first_name = draft.first_name.trim();
    if (draft.last_name !== (student.last_name ?? ""))
      patch.last_name = draft.last_name.trim();
    if (draft.date_of_birth !== (student.date_of_birth ?? ""))
      patch.date_of_birth = draft.date_of_birth.trim();
    if (draft.gender !== (student.gender ?? ""))
      patch.gender = draft.gender;
    if (draft.ethnicity !== (student.ethnicity ?? ""))
      patch.ethnicity = draft.ethnicity;
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/students/${student.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${res.status})`);
      }
      toast.success("Student details saved.");
      setEditing(false);
      onChanged();
    } catch (err) {
      console.error("[StudentApplicationBlock.runSave]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden gap-0 py-0 bg-muted/10">
      {/* Sub-header — student name on the left + Edit (or Save/
          Cancel) on the right. In edit mode the name swaps to
          first/last name inputs sharing the same row, so the
          layout doesn't jump when admin toggles into edit mode. */}
      <CardHeader className="py-3 !pb-3 border-b bg-white">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="grid gap-2 grid-cols-2 max-w-md">
                <Field>
                  <FieldLabel className="text-[10px]">First name</FieldLabel>
                  <Input
                    value={draft.first_name}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, first_name: e.target.value }))
                    }
                    disabled={saving}
                    className="h-8"
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-[10px]">Last name</FieldLabel>
                  <Input
                    value={draft.last_name}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, last_name: e.target.value }))
                    }
                    disabled={saving}
                    className="h-8"
                  />
                </Field>
              </div>
            ) : (
              <CardTitle className="text-base truncate">
                {student.first_name} {student.last_name}
              </CardTitle>
            )}
            {!app && !editing ? (
              <p className="mt-1 text-xs italic text-muted-foreground">
                No application row for this year.
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {editing ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="bg-white"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void runSave()}
                  disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {saving ? (
                    <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5 mr-1.5" />
                  )}
                  Save
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={enterEdit}
                className="bg-white"
              >
                <Pencil className="size-3.5 mr-1.5" />
                Edit
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 py-5 bg-muted/10">
      {/* Demographics — DOB / Gender / Ethnicity. In edit mode the
          three fields become editable inputs; first/last name
          (above in the sub-header) are part of the same atomic
          PATCH so admin sees one unified edit experience. */}
      <SectionGroup title="Student">
        {editing ? (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <Field>
              <FieldLabel>Date of birth</FieldLabel>
              <Input
                type="date"
                value={draft.date_of_birth}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    date_of_birth: e.target.value,
                  }))
                }
                disabled={saving}
              />
            </Field>
            <Field>
              <FieldLabel>Gender</FieldLabel>
              <Select
                value={draft.gender}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, gender: v }))
                }
                disabled={saving}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  {GENDER_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Ethnicity</FieldLabel>
              <Select
                value={draft.ethnicity}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, ethnicity: v }))
                }
                disabled={saving}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select ethnicity" />
                </SelectTrigger>
                <SelectContent>
                  {ETHNICITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <DisabledField
              label="Date of birth"
              value={
                student.date_of_birth
                  ? new Date(`${student.date_of_birth}T00:00:00`).toLocaleDateString()
                  : ""
              }
              required
            />
            <DisabledField label="Gender" value={student.gender} required />
            <DisabledField label="Ethnicity" value={student.ethnicity} required />
          </div>
        )}
      </SectionGroup>

      {app ? (
        <>
          <SectionGroup title="Academic">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
              <DisabledField
                label="Current grade"
                value={app.last_grade_completed}
                required
              />
              <DisabledField
                label="Incoming grade"
                value={app.current_grade}
                required
              />
              <DisabledField
                label="Previous school"
                value={app.current_previous_school}
                required
              />
            </div>
          </SectionGroup>

          <SectionGroup title="About the student">
            <div className="space-y-4">
              <DisabledTextarea
                label="Strengths"
                value={app.describe_student_strengths}
                required
              />
              <DisabledTextarea
                label="Opportunities for growth"
                value={app.describe_student_opportunities_for_growth}
                required
              />
            </div>
          </SectionGroup>

          {/* SUFS / Scholarship awards intentionally omitted here —
              the Decision card at the top of the page is the single
              source of truth for these fields, with always-editable
              inputs. Showing them again as disabled inputs in this
              card just made admins read the same values twice. */}

          <SectionGroup title="NWEA testing">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <DisabledField
                label="Status"
                value={
                  app.nwea_testing_complete
                    ? "Complete"
                    : app.nwea_testing_scheduled
                      ? "Scheduled"
                      : "Not scheduled"
                }
              />
            </div>
          </SectionGroup>

          <SectionGroup title="Transportation">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <DisabledField
                label="Bus transportation"
                value={app.is_bus_transportation ? "Yes" : "No"}
              />
              {app.is_bus_transportation ? (
                <DisabledField
                  label="Bus stop"
                  value={app.bus_stop}
                  placeholder="—"
                />
              ) : null}
            </div>
          </SectionGroup>
        </>
      ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Coerce a stored NWEA RIT score into the string the draft input
 * renders. The Xano schema columns default to `0` (not `null`) on
 * insert, so a student who's never had a score entered still comes
 * back with `0` from the API. NWEA RIT scores are realistically in
 * the 100–300 range — a stored `0` is invariably the unset state,
 * not a real score. Normalize both `null` and `0` to an empty
 * string so the input renders the dash placeholder, keeping the
 * Math and Reading rows visually consistent regardless of which
 * default the underlying column happens to have.
 */
function nweaScoreToDraft(value: number | null | undefined): string {
  if (value == null || value === 0) return "";
  return String(value);
}

function TestingBlock({
  student,
  app,
  onSaved,
}: {
  student: Student;
  app: XanoApplication | undefined;
  /** Called after a successful PATCH so the parent page can refresh
   *  its detail SWR cache (and the section-confirm cascade can pick
   *  up the new data). */
  onSaved?: () => void;
}) {
  // Local mirror of the four admin-editable NWEA fields. Inputs
  // commit on blur — comparing against the persisted `student`
  // value and PATCHing only the diff so concurrent edits to other
  // fields don't get clobbered. Mirrors the pattern used by
  // `<DecisionStudentRow>` for SUFS edits.
  //
  // Note: NWEA scores live on the STUDENT row now, not the per-year
  // application row. Re-enrolling students keep their score history
  // since the data isn't year-scoped. PATCH targets
  // `/api/admin/students/[id]` accordingly.
  const [draft, setDraft] = useState({
    math: nweaScoreToDraft(student.initial_screening_nwea_math),
    reading: nweaScoreToDraft(student.initial_screening_nwea_reading),
    mathDate: student.initial_screening_nwea_math_date ?? "",
    readingDate: student.initial_screening_nwea_reading_date ?? "",
  });
  const [savingField, setSavingField] = useState<string | null>(null);

  // Re-hydrate the draft when the underlying student row changes
  // (e.g. SWR revalidation after admin edits something on a sibling
  // student). Without this, an external refresh would render stale
  // values on top of the new ones.
  useEffect(() => {
    setDraft({
      math: nweaScoreToDraft(student.initial_screening_nwea_math),
      reading: nweaScoreToDraft(student.initial_screening_nwea_reading),
      mathDate: student.initial_screening_nwea_math_date ?? "",
      readingDate: student.initial_screening_nwea_reading_date ?? "",
    });
  }, [student]);

  async function patchField(
    field:
      | "initial_screening_nwea_math"
      | "initial_screening_nwea_reading"
      | "initial_screening_nwea_math_date"
      | "initial_screening_nwea_reading_date",
    value: number | string | null
  ) {
    setSavingField(field);
    try {
      const res = await fetch(`/api/admin/students/${student.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${res.status})`);
      }
      onSaved?.();
    } catch (err) {
      console.error(`[TestingBlock.patchField.${field}]`, err);
      toast.error(err instanceof Error ? err.message : "Couldn't save score.");
    } finally {
      setSavingField(null);
    }
  }

  return (
    <div className="rounded-md border bg-muted/10 p-4 space-y-4">
      <p className="text-sm font-semibold">
        {student.first_name} {student.last_name}
      </p>
      {app ? (
        <>
          {/* Parent-set scheduling state — read-only on this surface
              since it's flipped by the parent flow's NWEA page. */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <DisabledField
              label="NWEA scheduled"
              value={app.nwea_testing_scheduled ? "Yes" : "No"}
            />
            <DisabledField
              label="NWEA complete"
              value={app.nwea_testing_complete ? "Yes" : "No"}
            />
          </div>

          {/* Admin-only initial-screening RIT scores + dates. Recorded
              after the student completes initial testing at the
              academy. Parents never see these — the parent allowlist
              excludes them and the apply-flow NWEA page doesn't
              render them. */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Initial screening (admin-entered)
            </p>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <Field>
                <FieldLabel className="text-xs">Math RIT score</FieldLabel>
                <Input
                  value={draft.math}
                  type="number"
                  inputMode="numeric"
                  placeholder="—"
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, math: e.target.value }))
                  }
                  onBlur={() => {
                    const trimmed = draft.math.trim();
                    if (trimmed === "") {
                      // Treat stored 0 the same as null — both render
                      // as "no score entered" and we don't want a tab-
                      // out to spuriously PATCH null over a 0 default.
                      if (
                        student.initial_screening_nwea_math == null ||
                        student.initial_screening_nwea_math === 0
                      )
                        return;
                      patchField("initial_screening_nwea_math", null);
                      return;
                    }
                    const next = Number(trimmed);
                    if (!Number.isFinite(next)) return;
                    if (next === student.initial_screening_nwea_math) return;
                    patchField("initial_screening_nwea_math", next);
                  }}
                  disabled={savingField === "initial_screening_nwea_math"}
                  className="border-input"
                />
              </Field>
              <Field>
                <FieldLabel className="text-xs">Math test date</FieldLabel>
                <Input
                  value={draft.mathDate}
                  type="date"
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, mathDate: e.target.value }))
                  }
                  onBlur={() => {
                    const next = draft.mathDate || null;
                    if (next === (student.initial_screening_nwea_math_date ?? null))
                      return;
                    patchField("initial_screening_nwea_math_date", next);
                  }}
                  disabled={savingField === "initial_screening_nwea_math_date"}
                  className="border-input"
                />
              </Field>
              <Field>
                <FieldLabel className="text-xs">Reading RIT score</FieldLabel>
                <Input
                  value={draft.reading}
                  type="number"
                  inputMode="numeric"
                  placeholder="—"
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, reading: e.target.value }))
                  }
                  onBlur={() => {
                    const trimmed = draft.reading.trim();
                    if (trimmed === "") {
                      // Treat stored 0 the same as null — see the
                      // matching note on the Math handler above.
                      if (
                        student.initial_screening_nwea_reading == null ||
                        student.initial_screening_nwea_reading === 0
                      )
                        return;
                      patchField("initial_screening_nwea_reading", null);
                      return;
                    }
                    const next = Number(trimmed);
                    if (!Number.isFinite(next)) return;
                    if (next === student.initial_screening_nwea_reading) return;
                    patchField("initial_screening_nwea_reading", next);
                  }}
                  disabled={savingField === "initial_screening_nwea_reading"}
                  className="border-input"
                />
              </Field>
              <Field>
                <FieldLabel className="text-xs">Reading test date</FieldLabel>
                <Input
                  value={draft.readingDate}
                  type="date"
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, readingDate: e.target.value }))
                  }
                  onBlur={() => {
                    const next = draft.readingDate || null;
                    if (
                      next === (student.initial_screening_nwea_reading_date ?? null)
                    )
                      return;
                    patchField("initial_screening_nwea_reading_date", next);
                  }}
                  disabled={
                    savingField === "initial_screening_nwea_reading_date"
                  }
                  className="border-input"
                />
              </Field>
            </div>
          </div>
        </>
      ) : (
        <p className="text-xs italic text-muted-foreground">
          No application row for this year.
        </p>
      )}
    </div>
  );
}

/* ─────────────────────── Scholarship block ─────────────────────── */

function ScholarshipBlock({
  scholarship,
  familyId,
  onScholarshipChanged,
}: {
  scholarship: XanoScholarship;
  /** Family id is forwarded to `DocumentsToReviewBlock` so future
   *  surfaces (e.g. a section-scoped notes drawer on a specific
   *  contributing-member row) can scope back to the family record
   *  without a second prop. */
  familyId: number;
  /** Re-fetches the surrounding family-detail payload after a doc
   *  verify lands, so the Approve gate (which reads the same
   *  `*_confirm` columns) updates without manual reload. */
  onScholarshipChanged?: () => void;
}) {
  // Single composite fetch — Xano's `/registration_opportunity_scholarship/{id}`
  // endpoint returns the scholarship row + every child table
  // (homes, vehicles, contributing members, benefits) pre-joined
  // and pre-filtered by FK. Doing one request instead of four
  // separate filtered fetches removes a whole class of "did we
  // remember to filter?" bugs (Xano's child-list endpoints
  // silently ignore arbitrary FK predicates).
  type ScholarshipDetails = {
    scholarship: XanoScholarship;
    homes: XanoScholarshipHome[];
    vehicles: XanoScholarshipVehicle[];
    contributing_members: XanoScholarshipContributingMember[];
    benefits: XanoScholarshipBenefit[];
  };
  const { data: details, isLoading: detailsLoading, mutate: mutateDetails } =
    useSWR<ScholarshipDetails>(
      `/api/admin/scholarship-details?id=${scholarship.id}`,
      adminFetcher
    );
  const homes = details?.homes ?? [];
  const vehicles = details?.vehicles ?? [];
  const members = details?.contributing_members ?? [];
  const benefits = details?.benefits ?? [];
  // Children loading state — separate from "we have the
  // scholarship row" since the parent already handed that in.
  const homesLoading = detailsLoading && !details;
  const vehiclesLoading = detailsLoading && !details;
  // Path-aware notices replace the prior short-circuit returns. The
  // opt-out / SNAP paths used to early-return with just a one-liner,
  // which hid contributing members + homes + vehicles even when the
  // parent had entered them under a previous path before switching.
  // We now surface a banner up top so admin sees which path the
  // family is on, then ALWAYS render the houses / vehicles /
  // contributing-members docs underneath so nothing on file slips
  // out of view. The household / income / asset / debt form fields
  // stay path-gated since they're truly empty on non-Opportunity-
  // Scholarship rows and rendering a wall of $0s would be misleading.
  const onFullForm =
    !scholarship.isNotParticipating && !scholarship.isSNAPBenefits;

  return (
    <div className="space-y-6">
      {/* Path Selector — admin can flip the family between the three
          scholarship lifecycle states on behalf of the parent. Mainly
          for paper applications transcribed by staff, or mid-cycle
          corrections when a family changes their qualification. The
          scholarships PATCH route cascades the mutually-exclusive
          flags (flipping one to true clears the other two). */}
      <ScholarshipPathSelector
        scholarship={scholarship}
        onChanged={onScholarshipChanged}
      />
      {scholarship.isNotParticipating ? (
        <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <span>
            The family opted out of the SailFuture Opportunity Scholarship
            for this year. Any data shown below was entered before they
            switched paths.
          </span>
        </div>
      ) : null}
      {scholarship.isSNAPBenefits ? (
        <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <span>
            The family pre-qualifies via SNAP benefits. Confirm the SNAP
            award letter in the Documents to Review table below.
          </span>
        </div>
      ) : null}
      {onFullForm ? (
        <SectionGroup title="Household">
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
          <DisabledField
            label="Adults"
            value={String(scholarship.household_adults ?? 0)}
          />
          <DisabledField
            label="Children"
            value={String(scholarship.household_children ?? 0)}
          />
          <DisabledField
            label="No contributing members"
            value={scholarship.no_contributing_member ? "Yes" : "No"}
          />
          <DisabledField
            label="Government benefits"
            value={scholarship.government_benefits ? "Yes" : "No"}
          />
        </div>
      </SectionGroup>
      ) : null}

      {onFullForm ? (
      <SectionGroup title="Income (monthly)">
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3">
          <DisabledField
            label="Business"
            value={formatCurrency(scholarship.business_income_monthly)}
          />
          <DisabledField
            label="Capital gains"
            value={formatCurrency(scholarship.capital_gains_monthly)}
          />
          <DisabledField
            label="Child support"
            value={formatCurrency(scholarship.child_support_monthly)}
          />
          <DisabledField
            label="Alimony"
            value={formatCurrency(scholarship.alimony_monthly)}
          />
          <DisabledField
            label="Trusts"
            value={formatCurrency(scholarship.trusts_monthly)}
          />
          <DisabledField
            label="Other"
            value={formatCurrency(scholarship.other_income_monthly)}
          />
        </div>
      </SectionGroup>
      ) : null}

      {onFullForm ? (
      <SectionGroup title="Assets">
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3">
          <DisabledField
            label="Checking"
            value={formatCurrency(scholarship.assets_checking)}
          />
          <DisabledField
            label="Savings"
            value={formatCurrency(scholarship.assets_savings)}
          />
          <DisabledField
            label="Retirement"
            value={formatCurrency(scholarship.assets_retirement_savings)}
          />
          <DisabledField
            label="Securities"
            value={formatCurrency(scholarship.assets_stocks_bonds_securities)}
          />
          <DisabledField
            label="Trusts / inheritance"
            value={formatCurrency(scholarship.assets_trusts_inheritance)}
          />
          <DisabledField
            label="Business"
            value={formatCurrency(scholarship.assets_business)}
          />
        </div>
      </SectionGroup>
      ) : null}

      {/* Contributing Members — one card per declared member with
          their bio + the documentation method they chose (W-2 vs
          pay stubs). The Documents to Review table at the bottom
          handles the per-file verification workflow; this section
          shows admin WHO the member is and what they declared
          before getting into the per-file review below. Always
          renders (regardless of path) so members entered before
          the family switched paths still surface. */}
      <SectionGroup title="Contributing Members">
        {detailsLoading && !details ? (
          <Skeleton className="h-12 w-full rounded-md" />
        ) : members.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            No contributing members declared.
          </p>
        ) : (
          <div className="space-y-3">
            {members.map((member, idx) => {
              const fullName =
                `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim() ||
                `Contributing member ${idx + 1}`;
              // `isW2` + `isPayStubs` are the parent-side toggles on
              // the contributing-member form — admin sees which
              // method the family declared so the per-file Documents
              // to Review table reads in context.
              const method = member.isW2
                ? "W-2"
                : member.isPayStubs
                  ? "Pay stubs"
                  : "—";
              return (
                <div
                  key={member.id}
                  className="rounded-md border bg-muted/10 p-3 space-y-3"
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {fullName}
                  </p>
                  <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                    <DisabledField
                      label="Address"
                      value={formatStreetAddress(member)}
                    />
                    <DisabledField
                      label="City / State / Zip"
                      value={[member.city, member.state, member.zipcode]
                        .filter(Boolean)
                        .join(", ")}
                    />
                    <DisabledField
                      label="Estimated annual income"
                      value={formatCurrency(
                        member.estimated_annual_income ?? 0
                      )}
                    />
                    <DisabledField
                      label="Documentation method"
                      value={method}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionGroup>

      {/* Documents to Review — W-2 / pay-stub uploads per contributing
          member, plus government-benefit award letters when the
          family declared them. Sits directly under Contributing
          Members so admin reads "who's contributing" then "what
          they uploaded" in a single visual flow before moving on
          to assets / houses / vehicles. Verifying every row here
          is also the gate on the Financial Aid section's Verify
          button — admin can't sign off on the section until the
          income docs check out. */}
      <DocumentsToReviewBlock
        scholarship={scholarship}
        familyId={familyId}
        // Pass the pre-fetched arrays from the composite endpoint
        // so the table skips its own SWR fetches against
        // `/api/admin/contributing-members?scholarshipId=…` and
        // `/api/admin/scholarship-benefits?scholarshipId=…` — both
        // of which previously fell into the same Xano filter trap
        // and shipped unrelated families' rows through until we
        // added defensive client-side filters. Single fetch = single
        // source of truth, no filter drift.
        membersOverride={members}
        benefitsOverride={benefits}
        // When admin verifies a doc inside the table, refetch the
        // composite endpoint so this block re-renders with the
        // updated audit columns (the table calls SWR's mutate on
        // its own keys; we also need our composite cache to
        // refresh).
        onChildrenChanged={() => void mutateDetails()}
        onScholarshipChanged={onScholarshipChanged}
      />

      {/* Purchased Houses — empty array still renders a notice row so
          admin sees that the section was reviewed and the family
          declared no homes (rather than a missing section). One row
          per home: type, full address, total value, outstanding
          debt. */}
      <SectionGroup title="Purchased Houses">
        {homesLoading ? (
          <Skeleton className="h-12 w-full rounded-md" />
        ) : homes.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            No purchased houses declared.
          </p>
        ) : (
          <div className="space-y-3">
            {homes.map((home, idx) => (
              <div
                key={home.id}
                className="rounded-md border bg-muted/10 p-3 space-y-3"
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Home {idx + 1}
                </p>
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                  <DisabledField label="Type" value={home.type ?? ""} />
                  <DisabledField
                    label="Address"
                    value={formatStreetAddress(home)}
                  />
                  <DisabledField
                    label="City / State / Zip"
                    value={[home.city, home.state, home.zipcode]
                      .filter(Boolean)
                      .join(", ")}
                  />
                  <DisabledField
                    label="Total value"
                    value={formatCurrency(home.total_value)}
                  />
                  <DisabledField
                    label="Outstanding debt"
                    value={formatCurrency(home.outstanding_debt)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionGroup>

      {/* Purchased Vehicles — same shape as houses but the per-row
          fields are vehicle metadata (make / model / year). Empty
          state mirrors the houses block so the section reads as
          "reviewed and declared none" rather than a gap. */}
      <SectionGroup title="Purchased Vehicles">
        {vehiclesLoading ? (
          <Skeleton className="h-12 w-full rounded-md" />
        ) : vehicles.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            No purchased vehicles declared.
          </p>
        ) : (
          <div className="space-y-3">
            {vehicles.map((vehicle, idx) => (
              <div
                key={vehicle.id}
                className="rounded-md border bg-muted/10 p-3 space-y-3"
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Vehicle {idx + 1}
                </p>
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                  <DisabledField label="Type" value={vehicle.type ?? ""} />
                  <DisabledField
                    label="Make"
                    value={vehicle.car_make ?? ""}
                  />
                  <DisabledField
                    label="Model"
                    value={vehicle.car_model ?? ""}
                  />
                  <DisabledField
                    label="Year"
                    value={vehicle.car_year ?? ""}
                  />
                  <DisabledField
                    label="Total value"
                    value={formatCurrency(vehicle.total_value)}
                  />
                  <DisabledField
                    label="Remaining debt"
                    value={formatCurrency(vehicle.remaining_debt)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionGroup>

      {onFullForm ? (
        <>
          <SectionGroup title="Debts">
            <div className="grid gap-4 grid-cols-3">
              <DisabledField
                label="Credit cards"
                value={formatCurrency(scholarship.debts_credit_cards)}
              />
              <DisabledField
                label="Student loans"
                value={formatCurrency(scholarship.debts_student_loans)}
              />
              <DisabledField
                label="Personal loans"
                value={formatCurrency(scholarship.debts_personal_loans)}
              />
            </div>
          </SectionGroup>

          <SectionGroup title="Family contribution">
            <DisabledField
              label="Per month"
              value={formatCurrency(scholarship.family_contribution_per_month)}
            />
          </SectionGroup>

          {scholarship.scholarship_advocacy_letter ? (
            <SectionGroup title="Advocacy letter">
              <DisabledTextarea
                label=""
                value={scholarship.scholarship_advocacy_letter}
              />
            </SectionGroup>
          ) : null}

          <SignaturePreview signature={scholarship.signature} />
        </>
      ) : null}
    </div>
  );
}

/**
 * Render a Xano address pair as a single street line. The home and
 * vehicle Xano rows surface address_1 + address_2 separately for
 * editing; on read-only summary views we collapse to one line so
 * the admin grid stays at two columns wide.
 */
function formatStreetAddress(home: {
  address_1?: string;
  address_2?: string;
}): string {
  const a1 = home.address_1?.trim() ?? "";
  const a2 = home.address_2?.trim() ?? "";
  return [a1, a2].filter(Boolean).join(", ");
}

/* ─────────────────────── Disabled input primitives ─────────────────────── */

/**
 * `valueIsEmpty` — the predicate used to decide whether a required
 * field should be flagged red. Treats null / undefined / empty
 * string / "$0" / formatted "0" all as "missing data" so a parent
 * leaving a number field at its default doesn't slip through.
 */
function valueIsEmpty(v: string | number | null | undefined): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return v === 0;
  const s = v.trim();
  return (
    s === "" ||
    s === "—" ||
    s === "0" ||
    s === "$0" ||
    s === "$0.00"
  );
}

/**
 * Read-only field that still renders a real `<Input>` element so the
 * page reads as a form (with borders, labels, and structure) rather
 * than a text dump. Mirrors the `FieldRow` used by the per-section
 * editors when their `editing` state is `false`.
 *
 * `required` — when set, the input borders red when its value is
 * empty so admin can spot missing data on in-progress applications
 * at a glance. Doesn't change behavior when the value is present.
 */
function DisabledField({
  label,
  value,
  type = "text",
  placeholder,
  required,
}: {
  label: string;
  value: string | number | null | undefined;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const display =
    value === null || value === undefined || value === "" ? "" : String(value);
  const isMissing = required && valueIsEmpty(value);
  return (
    <Field>
      {label ? (
        <FieldLabel className="text-xs">
          {label}
          {required ? (
            <span
              className="ml-1 text-red-500"
              aria-label="required"
            >
              *
            </span>
          ) : null}
        </FieldLabel>
      ) : null}
      <Input
        type={type}
        value={display}
        // `readOnly` (not `disabled`) so admin can select + copy
        // text out of the field. Disabled HTML inputs reject every
        // selection event, which makes "look at this email so I
        // can paste it elsewhere" impossible — readOnly keeps the
        // input non-editable while preserving the native text-
        // selection behavior.
        readOnly
        placeholder={placeholder}
        aria-invalid={isMissing || undefined}
        className={cn(
          "bg-white",
          isMissing
            ? "border-red-500 ring-1 ring-red-500/20"
            : "border-input"
        )}
      />
    </Field>
  );
}

function DisabledTextarea({
  label,
  value,
  required,
}: {
  label: string;
  value: string | null | undefined;
  required?: boolean;
}) {
  const isMissing = required && valueIsEmpty(value);
  return (
    <Field>
      {label ? (
        <FieldLabel className="text-xs">
          {label}
          {required ? (
            <span
              className="ml-1 text-red-500"
              aria-label="required"
            >
              *
            </span>
          ) : null}
        </FieldLabel>
      ) : null}
      <textarea
        value={value ?? ""}
        disabled
        readOnly
        onChange={() => {}}
        aria-invalid={isMissing || undefined}
        className={cn(
          "flex min-h-[80px] w-full rounded-md border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground cursor-default opacity-100",
          isMissing
            ? "border-red-500 ring-1 ring-red-500/20"
            : "border-input"
        )}
      />
    </Field>
  );
}

function SignaturePreview({
  signature,
}: {
  signature: Record<string, unknown> | null;
}) {
  if (!signature || typeof signature !== "object") return null;
  const sig = signature as { url?: string; path?: string };
  const src = sig.url ?? (sig.path ? `${xanoBase}${sig.path}` : null);
  if (!src) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        Signature
      </p>
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2 hover:no-underline"
      >
        Open signature
        <ExternalLink className="size-3" />
      </a>
    </div>
  );
}

/* ─────────────────────── Decision card ─────────────────────── */

/**
 * SUFS award tiers — keys map directly to the matching numeric column
 * on `registration_school_years` so the displayed amount is always
 * the year-specific value (Florida tweaks the SUFS dollar figures
 * year over year). Persisted on the application row's `sufs_type`.
 *
 * `none` is a sentinel for "this student isn't on a SUFS scholarship";
 * we save it as the empty string per the existing column convention.
 */
const SUFS_TIERS: Array<{
  key: string; // saved as `sufs_type`; "" === none
  label: string;
  field: keyof XanoSchoolYear | null;
}> = [
  { key: "", label: "Not on a SUFS scholarship", field: null },
  { key: "fes_eo_8", label: "FES-EO · Grade 8", field: "fes_eo_8" },
  { key: "fes_eo_9", label: "FES-EO · Grade 9", field: "fes_eo_9" },
  { key: "ftc_8", label: "FTC · Grade 8", field: "ftc_8" },
  { key: "ftc_9", label: "FTC · Grade 9", field: "ftc_9" },
  {
    key: "fes_ua_8_ese_1_3",
    label: "FES-UA · Grade 8 (ESE 1-3)",
    field: "fes_ua_8_ese_1_3",
  },
  {
    key: "fes_ua_9_ese_1_3",
    label: "FES-UA · Grade 9 (ESE 1-3)",
    field: "fes_ua_9_ese_1_3",
  },
  { key: "fes_ua_ese_4", label: "FES-UA · ESE 4", field: "fes_ua_ese_4" },
  { key: "fes_ua_ese_5", label: "FES-UA · ESE 5", field: "fes_ua_ese_5" },
];

const SUFS_STATUSES = [
  { key: "", label: "—" },
  { key: "Pending", label: "Pending" },
  { key: "Approved", label: "Approved" },
  { key: "Denied", label: "Denied" },
];

function sufsAmountFor(
  type: string,
  schoolYear: XanoSchoolYear | null
): number {
  if (!schoolYear) return 0;
  const tier = SUFS_TIERS.find((t) => t.key === type);
  if (!tier?.field) return 0;
  const v = schoolYear[tier.field];
  return typeof v === "number" ? v : 0;
}

function formatCurrencyZero(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * Compute a single human-readable reason the Approve button should
 * stay blocked, or `null` when nothing's blocking. Drives both the
 * `disabled` state on the Approve button itself AND a visible
 * banner rendered above the action row.
 *
 * The gate is "every section verified" — Family / Students /
 * Financial Aid / Testing all need their admin-verify bool true
 * before the family can be approved. Documents to review and the
 * per-student Confirm Scholarship Award Amount affordances roll
 * up under their parent section's verify (admin can't responsibly
 * verify Financial Aid without confirming the income docs first),
 * so the gate doesn't list them separately — one unified message
 * keeps the footer banner short and the path forward obvious.
 *
 * The `allDocsConfirmed`, `allSufsConfirmed`, and `unconfirmedCount`
 * inputs are still accepted so existing call sites don't have to
 * change shape; they're intentionally unused.
 */
function computeApproveBlockReason(input: {
  allDocsConfirmed: boolean;
  allSufsConfirmed: boolean;
  unconfirmedCount: number;
  unverifiedSections: string[];
}): string | null {
  void input.allDocsConfirmed;
  void input.allSufsConfirmed;
  void input.unconfirmedCount;
  if (input.unverifiedSections.length > 0) {
    return "All sections need to be verified before family can be approved.";
  }
  return null;
}

function DecisionCard({
  familyId,
  yearId,
  familyName,
  students,
  apps,
  schoolYear,
  scholarship,
  progress,
  loading,
  onChanged,
}: {
  familyId: number;
  yearId: number;
  familyName: string;
  students: Student[];
  apps: XanoApplication[];
  schoolYear: XanoSchoolYear | null;
  scholarship: XanoScholarship | null;
  progress: {
    id: number;
    isAccepted: boolean;
    isSubmitted: boolean;
    /** Section-verify bools — drive the Approve gate. Family /
     *  Students / Financial Aid / Testing all need admin verification
     *  before the Approve button unlocks. Optional on the type
     *  because legacy rows pre-date the columns. */
    family_admin_confirm?: boolean;
    students_admin_confirm?: boolean;
    testing_admin_confirm?: boolean;
    /** Financial Aid verify uses the same `*_admin_confirm`
     *  pattern as Family / Students / Testing — see the matching
     *  note on `XanoFamilyApplicationProgress`. */
    financial_aid_admin_confirm?: boolean;
    /** Scholarship Determination verify triplet — gates Acceptance
     *  alongside the four parent-facing section verifies. Admin can
     *  only flip this once every per-student
     *  `confirmed_scholarship` is true. */
    scholarship_admin_complete?: boolean;
    scholarship_complete_admin_time?: number | null;
    scholarship_admin_complete_admin?: string;
  } | null;
  loading: boolean;
  onChanged: () => void;
}) {
  const accepted = progress?.isAccepted === true;
  const familySubmitted = progress?.isSubmitted === true;
  // Section-verify gate — Acceptance is blocked until each section
  // is verified by admin. `unverifiedSections` lists the human-
  // readable labels that haven't been verified yet so the gate-
  // block reason can tell admin what to fix.
  const unverifiedSections: string[] = [];
  if (progress?.family_admin_confirm !== true) unverifiedSections.push("Family");
  if (progress?.students_admin_confirm !== true)
    unverifiedSections.push("Students");
  if (progress?.financial_aid_admin_confirm !== true)
    unverifiedSections.push("Financial Aid");
  if (progress?.scholarship_admin_complete !== true)
    unverifiedSections.push("Scholarship");
  if (progress?.testing_admin_confirm !== true)
    unverifiedSections.push("Testing");

  // Local scholarship-verify state + handler. Lives inside
  // DecisionCard rather than being lifted to the page level
  // because the verify button + audit caption render right at the
  // bottom of the Scholarship Determination card — keeping the
  // PATCH next to its surface avoids prop-drilling
  // `toggleSectionConfirmed("scholarship", …)` through here.
  // `onChanged` already refreshes the surrounding progress SWR so
  // the gate state re-evaluates on completion.
  const [savingScholarship, setSavingScholarship] = useState(false);
  async function toggleScholarshipVerify(next: boolean) {
    setSavingScholarship(true);
    try {
      const res = await fetch(`/api/admin/family-progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyId,
          yearId,
          scholarship_admin_complete: next,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Update failed (${res.status})`);
      }
      toast.success(
        next ? "Scholarship verified." : "Verification cleared."
      );
      onChanged();
    } catch (err) {
      console.error("[DecisionCard.toggleScholarshipVerify]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't update.");
    } finally {
      setSavingScholarship(false);
    }
  }
  const anySubmitted =
    familySubmitted ||
    apps.some((a) => (a as { isSubmitted?: boolean }).isSubmitted);

  // Family-level Approve gate — every per-student row needs its
  // scholarship award confirmed before the family can be approved.
  // Reads `confirmed_scholarship` (the renamed flag the per-student
  // Confirm Scholarship Award Amount button writes); legacy rows
  // that still carry only `sufs_confirmed` are NOT auto-counted —
  // admin needs to re-confirm under the new flow so the audit
  // trail is consistent.
  const activeApps = apps.filter(
    (a) => (a as { isActive?: boolean }).isActive !== false
  );
  const unconfirmedCount = activeApps.filter(
    (a) => a.confirmed_scholarship !== true
  ).length;
  const allSufsConfirmed = unconfirmedCount === 0;

  // Documents-to-review gate. Confirm Scholarship Award Amount on
  // each per-student row is blocked until every confirmable
  // document under the scholarship has been marked confirmed —
  // contributing-member income docs (W-2 / pay stubs) AND any
  // government benefits the family declared. SNAP / unemployment
  // don't have confirm columns yet, so they're not part of the gate.
  //
  // SWR shares its cache by URL, so subscribing here from
  // `<DocumentsToReviewBlock>` (which uses the same keys) costs no
  // extra request — both components watch the same data and both
  // re-render together when an admin flips a row.
  const { data: contribMembers } = useSWR<XanoScholarshipContributingMember[]>(
    scholarship && !scholarship.no_contributing_member
      ? `/api/admin/contributing-members?scholarshipId=${scholarship.id}`
      : null,
    adminFetcher
  );
  const { data: scholarshipBenefits } = useSWR<XanoScholarshipBenefit[]>(
    scholarship && scholarship.government_benefits
      ? `/api/admin/scholarship-benefits?scholarshipId=${scholarship.id}`
      : null,
    adminFetcher
  );
  const allDocsConfirmed = computeAllDocsConfirmed(
    scholarship,
    contribMembers ?? [],
    scholarshipBenefits ?? []
  );

  // Bracket cells fetched here too (cached by SWR — same keys
  // ScholarshipReviewBlock uses) so we can compute the family's
  // monthly snapshot at approval time. Pulled to this layer rather
  // than re-derived in ApproveFamilyButton because the matrix
  // bracket is stitched from school-year + scholarship + apps
  // state, all of which DecisionCard already has.
  const { data: payCells } = useSWR<AwardBracketCell[]>(
    yearId ? `/api/admin/school-year-brackets?yearId=${yearId}` : null,
    adminFetcher
  );
  const { data: netAssetsCells } = useSWR<AwardBracketCell[]>(
    yearId
      ? `/api/admin/school-year-net-assets-brackets?yearId=${yearId}`
      : null,
    adminFetcher
  );
  const monthlyTuitionPayment = computeFamilyMonthlyTotal({
    scholarship,
    apps,
    schoolYear,
    payCells: payCells ?? [],
    netAssetsCells: netAssetsCells ?? [],
  });

  // Snapshot the line-item totals alongside the monthly figure so the
  // `registration_families_payment` row keeps a per-receipt breakdown,
  // not just a rolled-up monthly amount. Downstream tuition/billing
  // surfaces can render the receipt without having to re-derive from
  // per-student rows.
  //
  // - Annual fee: $500 × active students. Every family pays this.
  // - Transportation total: null for SNAP families (transport is
  //   waived for them), otherwise the sum of per-student transport
  //   for students whose `is_bus_transportation=true`.
  //
  // Reuses the `activeApps` variable computed above for the SUFS
  // gate, so we don't double-filter.
  const annualFeeTotal =
    (schoolYear?.annual_fees ?? 0) * activeApps.length;
  // Family-level transport total — sum of every active student's
  // `transportation_cost` (the per-student column admin can
  // override on the Decision row). For each app:
  //   - bus not elected → contributes 0 (column may be null;
  //     treat that as no transport rather than an unset default)
  //   - bus elected with explicit `transportation_cost` → that
  //     dollar value
  //   - bus elected, `transportation_cost` still null on a legacy
  //     row → fall back to the school year's `transportation_fees`
  //     so the column rollout doesn't drop already-elected
  //     students from the total
  // SNAP families collapse to `null` regardless — transportation
  // is waived for them.
  const transportationTotal = scholarship?.isSNAPBenefits
    ? null
    : activeApps.reduce((acc, a) => {
        if (a.is_bus_transportation !== true) return acc;
        const stored =
          typeof a.transportation_cost === "number"
            ? a.transportation_cost
            : null;
        const perStudent =
          stored != null ? stored : schoolYear?.transportation_fees ?? 0;
        return acc + perStudent;
      }, 0);
  // Family-level SUFS total — sum of every active student's
  // `sufs_award_amount` (the per-student column admin captures
  // during Scholarship Determination). Falls back to the derived
  // `sufsAmountFor(sufs_type, schoolYear)` amount when the explicit
  // column is missing on a row, so legacy applications that
  // pre-date the column still contribute to the family total. Sums
  // to 0 → write `null` so the billing surfaces render "N/A" for
  // a family with no SUFS scholarship instead of "$0 awarded."
  const sufsTotal = (() => {
    const sum = activeApps.reduce((acc, a) => {
      const explicit =
        typeof a.sufs_award_amount === "number" && a.sufs_award_amount > 0
          ? a.sufs_award_amount
          : null;
      const derived = sufsAmountFor(a.sufs_type ?? "", schoolYear);
      return acc + (explicit ?? derived);
    }, 0);
    return sum > 0 ? sum : null;
  })();

  // Tri-state edit status that drives the small colored dot in the
  // header — same vocabulary as the rest of the page's section
  // cards (red / yellow / green). The mapping:
  //   - accepted (green) → admin has approved the family
  //   - submitted but not yet accepted (yellow) → in-progress review
  //   - not yet submitted (red) → nothing to act on
  // Keeps the visual rhythm consistent with the Family / Students /
  // Testing sections above: skim the dots top-to-bottom to see what
  // still needs attention.
  const decisionStatus: SectionStatus = accepted
    ? "complete"
    : anySubmitted
    ? "in_progress"
    : "not_started";

  return (
    // `space-y-6` matches the gap the page's `<main>` puts between
    // section cards — without it the two cards inside DecisionCard
    // (Acceptance + Scholarship Determination) sit flush against
    // each other while every other adjacent section gets the
    // standard 24px rhythm.
    <div className="space-y-6">
    {/* Acceptance card — student receipt(s) + the family-level
        Approve / Revoke decision in the footer. Rendered FIRST in
        the section so admin lands on "is this family accepted yet?"
        immediately on page open; Scholarship Determination follows
        with the supporting per-student awards + financial review. */}
    {!loading && students.length > 0 ? (
      <Card
        id="section-acceptance"
        className={cn(
          "overflow-hidden gap-0 py-0 bg-white scroll-mt-20 transition-opacity"
        )}
      >
        <CardHeader className="py-3 !pb-3 border-b">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={cn(
                  "inline-block size-2.5 rounded-full shrink-0",
                  STATUS_DOT_CLASS[decisionStatus]
                )}
                aria-label={STATUS_LABEL[decisionStatus]}
                title={STATUS_LABEL[decisionStatus]}
              />
              <CardTitle className="text-base truncate">
                Acceptance
              </CardTitle>
              {accepted ? (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800">
                  <CheckCircle2 className="size-2.5" />
                  Accepted
                </span>
              ) : null}
            </div>
            {/* Gate-reason caption — pinned to the right side of
                the header. Computed from the same helper the Accept
                Student button uses for its disabled state, so the
                two surfaces can't drift. Stays out of the footer so
                the action row reads as just the action row; admin
                gets the explanation in their field of view as soon
                as they look at the card. */}
            {!accepted ? (
              (() => {
                const reason = computeApproveBlockReason({
                  allDocsConfirmed,
                  allSufsConfirmed,
                  unconfirmedCount,
                  unverifiedSections,
                });
                if (!reason) return null;
                return (
                  <span className="text-xs text-muted-foreground truncate text-right shrink-0">
                    {reason}
                  </span>
                );
              })()
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-6 py-5 bg-white">
          {/* Per-student tuition receipt — mirrors the parent's
              /tuition page row-by-row so admin sees the exact
              figures the family will see immediately before
              approving or revoking. */}
          <TuitionBreakdownTable
            students={students}
            apps={apps}
            schoolYear={schoolYear}
            isSnapFamily={scholarship?.isSNAPBenefits === true}
          />
        </CardContent>
        {/* Footer mirrors the SectionConfirmFooter pattern: divider
            + bg-white px-5 py-3 anchor row. Two paths:
              - Not accepted yet → Approve gate banner + Archive /
                [Reject] / Approve grid (Reject only when submitted,
                so the grid collapses to two columns otherwise).
              - Accepted → single Revoke acceptance button on the
                right, since the rest of the actions don't apply
                post-acceptance. */}
        <div className="border-t bg-white px-5 py-3 space-y-2">
          {!accepted ? (
            <>
              <div
                className={cn(
                  "grid gap-2",
                  familySubmitted ? "grid-cols-3" : "grid-cols-2"
                )}
              >
                <ArchiveApplicationButton
                  familyId={familyId}
                  yearId={yearId}
                  familyName={familyName}
                  onArchived={onChanged}
                />
                {familySubmitted ? (
                  <RejectApplicationButton
                    familyId={familyId}
                    yearId={yearId}
                    familyName={familyName}
                    onRejected={onChanged}
                  />
                ) : null}
                <ApproveFamilyButton
                  familyId={familyId}
                  yearId={yearId}
                  familyName={familyName}
                  allSufsConfirmed={allSufsConfirmed}
                  unconfirmedCount={unconfirmedCount}
                  allDocsConfirmed={allDocsConfirmed}
                  unverifiedSections={unverifiedSections}
                  monthlyTuitionPayment={monthlyTuitionPayment}
                  annualFeeTotal={annualFeeTotal}
                  transportationTotal={transportationTotal}
                  sufsTotal={sufsTotal}
                  onApproved={onChanged}
                />
              </div>
              {/* Gate-reason caption moved up into the card header
                  (right side, next to the title) — keeps the
                  footer focused on the action row instead of
                  hanging a second explanation line under it. */}
            </>
          ) : (
            // Post-accept footer — Revoke far left, View
            // registration far right. The two actions split the
            // post-acceptance surface: Revoke is the destructive
            // escape hatch (rarely used, lives where it won't be
            // hit by accident), View registration is the
            // forward-motion link admin clicks to keep working on
            // the family's enrollment paperwork. `justify-between`
            // pushes them to opposite ends; on narrow widths the
            // row stays single-line because both buttons truncate
            // their labels rather than wrapping.
            <div className="flex items-center justify-between gap-2">
              <RevokeAcceptanceButton
                familyId={familyId}
                yearId={yearId}
                familyName={familyName}
                onRevoked={onChanged}
              />
              <Button
                asChild
                variant="outline"
                size="lg"
                className="bg-white"
              >
                <Link
                  href={`/admin/registrations/${familyId}?yearId=${yearId}`}
                  className="inline-flex items-center"
                >
                  <ExternalLink className="size-4 mr-1.5 shrink-0" />
                  <span className="truncate">View registration</span>
                </Link>
              </Button>
            </div>
          )}
        </div>
      </Card>
    ) : null}
    <Card
      id="section-scholarship-determination"
      className={cn(
        "overflow-hidden gap-0 py-0 bg-white scroll-mt-20 transition-opacity",
        // Whole-card mute mirrors the SectionShell behavior: once
        // admin has accepted the family, the card's work is done,
        // gray it out so it stops competing with the still-live
        // sections above. The Acceptance card above carries the
        // Revoke affordance so admin can still reverse from the
        // post-acceptance surface.
        accepted && "opacity-60"
      )}
    >
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {/* Edit-status dot — Scholarship Determination card's
                dot tracks the SECTION VERIFY state, not the page-
                level decision status. Green once admin has clicked
                Verify Scholarship in the footer below, otherwise
                the surrounding `decisionStatus` (red / yellow /
                green based on submitted / accepted) drives it.
                Once the section's been verified the dot stays
                green even before acceptance lands. */}
            <span
              className={cn(
                "inline-block size-2.5 rounded-full shrink-0",
                progress?.scholarship_admin_complete === true
                  ? STATUS_DOT_CLASS.complete
                  : STATUS_DOT_CLASS[decisionStatus]
              )}
              aria-label={
                progress?.scholarship_admin_complete === true
                  ? "Verified"
                  : STATUS_LABEL[decisionStatus]
              }
              title={
                progress?.scholarship_admin_complete === true
                  ? "Verified"
                  : STATUS_LABEL[decisionStatus]
              }
            />
            <CardTitle className="text-base truncate">
              Scholarship Determination
            </CardTitle>
            {/* Status pill next to the title — green Verified pill
                once admin has signed off on the section. The earlier
                redundant Accepted pill was removed: acceptance is
                already conveyed by the dedicated Acceptance card
                directly above and by the family-level Accepted
                badge in the page header, so duplicating it next to
                Scholarship Determination just added noise. Pre-
                verify state stays quiet — the dot + the Verify
                footer carry the state. */}
            {progress?.scholarship_admin_complete === true ? (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800">
                <CheckCircle2 className="size-2.5" />
                Verified
              </span>
            ) : null}
          </div>
          {/* Notes drawer — section-scoped to "scholarship_determination"
              so the comms thread for the decision review lives next to
              the work. Mirrors the per-section Notes affordance on the
              Family / Students / Testing cards above. The Export PDF
              affordance used to live here too; moved up to the page
              header so admin can grab the acceptance summary without
              scrolling to this card. */}
          <div className="flex items-center gap-2 shrink-0">
            <FamilyNotesSheet
              familyId={familyId}
              section="scholarship_determination"
              title="Scholarship Determination"
              phase="application"
            />
          </div>
        </div>
      </CardHeader>
      {/* Body keeps a constant background — the whole-card opacity
          handles the muted look when accepted. Stacking `bg-muted/30`
          on top of an opacity-reduced parent doubled the dimming and
          made the text harder to read. */}
      <CardContent className="space-y-6 py-5 bg-white">
        {loading ? (
          <Skeleton className="h-48 w-full rounded-md" />
        ) : students.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No students on file.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Reviewing the family&rsquo;s scholarship is the core of
              this decision: the financial picture below sets the
              context, the SUFS section per student captures their
              state-funded portion, and the Opportunity Scholarship
              award is the per-student determination that completes
              the offer.
            </p>

            <div className="space-y-4">
              {students.map((student) => {
                const app = apps.find(
                  (a) => Number(a.registration_students_id) === student.id
                );
                return (
                  <DecisionStudentRow
                    key={student.id}
                    student={student}
                    app={app}
                    schoolYear={schoolYear}
                    onSaved={onChanged}
                    approveCtx={{
                      accepted,
                      allDocsConfirmed,
                      isSNAPPath: scholarship?.isSNAPBenefits === true,
                      // `scholarshipSectionVerified` locks per-
                      // student Undo until admin unconfirms the
                      // Scholarship section. Keeps the
                      // confirmation hierarchy intact — admin
                      // shouldn't be able to revoke a single
                      // student's award while the umbrella
                      // section verify still claims everyone is
                      // good.
                      scholarshipSectionVerified:
                        progress?.scholarship_admin_complete === true,
                    }}
                  />
                );
              })}
            </div>

            {/* Documents to Review moved up into the Financial Aid
                SectionShell (the W-2 / pay stub uploads are part of
                the family's financial picture, not the per-student
                determination). The Approve gate still reads the same
                `*_confirm` Xano columns, so confirming a row in the
                Financial Aid surface still unlocks both the per-
                student Confirm Scholarship Award Amount button and
                the family-level Approve from this card. */}

            {/* Scholarship Review — Pay Matrix or Net Assets bracket
                + (on SNAP path) the SNAP cost determination. Read-
                only context that supports the per-student
                determination rows above. */}
            <ScholarshipReviewBlock
              yearId={yearId}
              scholarship={scholarship}
              schoolYear={schoolYear}
              apps={apps}
              familyId={familyId}
              loading={loading}
              onScholarshipChanged={onChanged}
            />

            {/* Student-Specific Payments + the family-level Approve /
                Revoke / Archive / Reject actions moved into their
                own Acceptance card rendered below this one. The
                Scholarship Determination card now ends with the
                Scholarship Review block so it stays focused on
                "what's the family's situation and award" — the
                "is this family accepted?" question gets its own
                surface with its own footer. */}
          </>
        )}
      </CardContent>
      {/* Scholarship verify footer — admin can't flip
          `scholarship_admin_complete` true until every per-student
          `confirmed_scholarship` is true, since the verify is the
          umbrella "all student awards are locked in" signal that
          gates Acceptance. Re-uses the same `SectionConfirmFooter`
          chrome the SectionShells above the page use so the
          audit caption + Undo modal pattern stays consistent.
          Only renders once we have students on file — empty
          families don't have a scholarship to verify. */}
      {!loading && students.length > 0 ? (
        <SectionConfirmFooter
          confirm={{
            sectionLabel: "Scholarship",
            confirmed: progress?.scholarship_admin_complete === true,
            parentCompleted:
              progress?.scholarship_admin_complete === true,
            confirmTime:
              progress?.scholarship_complete_admin_time ?? null,
            confirmedByName:
              progress?.scholarship_admin_complete_admin?.trim() ||
              null,
            saving: savingScholarship,
            onToggle: toggleScholarshipVerify,
            // Gate: every per-student award has to be confirmed
            // first. Once the section itself is verified, drop the
            // gate so admin can still Undo.
            disabled:
              progress?.scholarship_admin_complete !== true &&
              !allSufsConfirmed,
            disabledReason:
              unconfirmedCount > 0
                ? `Confirm scholarship award for ${unconfirmedCount} student${
                    unconfirmedCount === 1 ? "" : "s"
                  } before verifying.`
                : "Confirm every student's scholarship award before verifying.",
          }}
        />
      ) : null}
    </Card>
    </div>
  );
}

/**
 * Per-student tuition receipt rendered at the bottom of the
 * Scholarship Determination card. Mirrors the parent-side
 * /tuition page row-by-row so admin sees the exact figures the
 * family will see — the two surfaces share the same math:
 *
 *   familyPaysForTuition = opportunity_scholarship_award_amount ?? 0
 *   scholarshipCoverage  = (SNAP ? tuition + transport : tuition)
 *                          − SUFS − familyPaysForTuition
 *   subtotal             = familyPaysForTuition + adminFee
 *                          + (SNAP ? 0 : transport)
 *
 * SNAP path bumps the OS coverage to absorb transport so the
 * subtotal collapses to the annual admin fee — same behavior the
 * family-payment row writes (`transportation_total = null`).
 *
 * Active-only: students whose application row has `isActive=false`
 * (soft-deleted from the year) are filtered out so the receipt
 * matches the cohort the family will actually pay for.
 */
function TuitionBreakdownTable({
  students,
  apps,
  schoolYear,
  isSnapFamily,
}: {
  students: Student[];
  apps: XanoApplication[];
  schoolYear: XanoSchoolYear | null;
  isSnapFamily: boolean;
}) {
  if (!schoolYear) return null;
  const tuition = schoolYear.tuition ?? 0;
  const adminFee = schoolYear.annual_fees ?? 0;
  const transportFee = schoolYear.transportation_fees ?? 0;

  // Build one row group per active student; skip students whose app
  // is soft-deleted so the totals match the family-payment snapshot
  // the Approve button writes.
  const rows = students
    .map((student) => {
      const app = apps.find(
        (a) => Number(a.registration_students_id) === student.id
      );
      if (!app) return null;
      if ((app as { isActive?: boolean }).isActive === false) return null;
      return { student, app };
    })
    .filter(
      (r): r is { student: Student; app: XanoApplication } => r !== null
    );

  if (rows.length === 0) return null;

  const lineItems = rows.map(({ student, app }) => {
    const stepUpAmount = sufsAmountFor(app.sufs_type ?? "", schoolYear);
    const stepUpStatus = app.sufs_status ?? "";
    const stepUpType = app.sufs_type ?? "";
    const familyPaysForTuition = app.opportunity_scholarship_award_amount ?? 0;
    const usesTransport = !!app.is_bus_transportation;
    const transportApplicable = usesTransport ? transportFee : 0;
    const scholarshipCoverage = isSnapFamily
      ? Math.max(
          0,
          tuition + transportApplicable - stepUpAmount - familyPaysForTuition
        )
      : Math.max(0, tuition - stepUpAmount - familyPaysForTuition);
    const subtotal = isSnapFamily
      ? familyPaysForTuition + adminFee
      : familyPaysForTuition + adminFee + transportApplicable;
    return {
      studentName: `${student.first_name} ${student.last_name}`.trim(),
      tuition,
      adminFee,
      transportFee,
      usesTransport,
      stepUpAmount,
      stepUpStatus,
      stepUpType,
      scholarshipCoverage,
      subtotal,
    };
  });

  const grandTotal = lineItems.reduce((sum, r) => sum + r.subtotal, 0);

  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <table className="w-full text-sm">
        <tbody>
          {lineItems.map((row, idx) => (
            <Fragment key={idx}>
              <tr className="bg-muted/40 border-t first:border-t-0">
                <td colSpan={2} className="px-4 py-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Student
                  </span>
                  <span className="mx-2 text-muted-foreground">—</span>
                  <span className="font-semibold text-foreground">
                    {row.studentName}
                  </span>
                </td>
              </tr>

              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Annual Tuition
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                  ${formatCurrency2(row.tuition)}
                </td>
              </tr>

              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Annual Admin Fee
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                  ${formatCurrency2(row.adminFee)}
                </td>
              </tr>

              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Transportation Fee
                  {!row.usesTransport ? (
                    <span className="ml-1.5 text-xs text-muted-foreground/60">
                      (N/A)
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                  {row.usesTransport ? (
                    `$${formatCurrency2(row.transportFee)}`
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>

              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Step Up for Students Award Status
                </td>
                <td className="px-4 py-3 text-right text-sm">
                  {row.stepUpStatus ? (
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {row.stepUpStatus}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>

              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Step Up for Students Award Type
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  {row.stepUpType
                    ? SUFS_TIERS.find((t) => t.key === row.stepUpType)?.label ??
                      row.stepUpType
                    : "—"}
                </td>
              </tr>

              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Step Up for Students Award Amount
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums text-green-600">
                  {row.stepUpAmount > 0
                    ? `-$${formatCurrency2(row.stepUpAmount)}`
                    : "$0.00"}
                </td>
              </tr>

              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Opportunity Scholarship Award
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums text-green-600">
                  {row.scholarshipCoverage > 0
                    ? `-$${formatCurrency2(row.scholarshipCoverage)}`
                    : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>

              <tr className="border-t bg-muted/20">
                <td className="px-4 py-3 font-medium">
                  Subtotal — {row.studentName}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  ${formatCurrency2(row.subtotal)}
                </td>
              </tr>
            </Fragment>
          ))}

          <tr className="border-t-2 bg-white">
            <td className="px-4 py-3 font-bold">
              Total Annual Due
              {schoolYear.year_name ? (
                <span className="ml-1.5 font-normal text-muted-foreground">
                  — School Year ({schoolYear.year_name})
                </span>
              ) : null}
            </td>
            <td className="px-4 py-3 text-right font-bold tabular-nums">
              ${formatCurrency2(grandTotal)}
            </td>
          </tr>
          <tr className="border-t bg-white">
            <td className="px-4 py-3 font-bold">
              Monthly Payment (Aug – Jul, 12 months)
            </td>
            <td className="px-4 py-3 text-right font-bold tabular-nums">
              ${formatCurrency2(grandTotal / 12)}/mo
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * 2-decimal currency formatter shared by `TuitionBreakdownTable`
 * rows. Matches the parent /tuition page so the two surfaces read
 * identically. Distinct from `formatCurrencyZero` (which strips
 * decimals for matrix-bracket displays) — the receipt always shows
 * cents.
 */
function formatCurrency2(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Family-level Approve button — embedded inside each
 * `<DecisionStudentRow>` so admin can approve from the row they're
 * reviewing. Every instance flips `isAccepted=true` on the same
 * per-year `registration_family_application_progress` row, so
 * clicking from any row has identical effect; the duplication is
 * intentional (admin shouldn't have to scroll to find the action).
 *
 * Gated on every active student's `sufs_confirmed=true` flag — the
 * tooltip surfaces the count of unconfirmed students when the gate
 * holds the button disabled. Each instance owns its own confirm
 * dialog; the dialog only opens for one row at a time so the
 * duplicate mounts are cheap.
 */
function ApproveFamilyButton({
  familyId,
  yearId,
  familyName,
  allSufsConfirmed,
  unconfirmedCount,
  allDocsConfirmed,
  unverifiedSections,
  monthlyTuitionPayment,
  annualFeeTotal,
  transportationTotal,
  sufsTotal,
  onApproved,
}: {
  familyId: number;
  yearId: number;
  familyName: string;
  allSufsConfirmed: boolean;
  unconfirmedCount: number;
  /** True when every confirmable document under "Documents to
   *  review" has been marked confirmed. The Approve gate also
   *  requires this — admin can't approve a family with unreviewed
   *  income docs, even if the per-student awards are confirmed. */
  allDocsConfirmed: boolean;
  /** List of section labels that haven't been verified yet (a
   *  subset of `["Family", "Students", "Financial Aid",
   *  "Scholarship", "Testing"]`). Empty array means every section
   *  is verified. Drives the gate-block reason string on the
   *  Acceptance button. */
  unverifiedSections: string[];
  /** Monthly snapshot computed at the DecisionCard level. Sent
   *  alongside the family-progress PATCH so the
   *  `registration_families_payment` row holds a copy of the
   *  authoritative payment amount at approval time. */
  monthlyTuitionPayment: number;
  /** Annual fee total — `$500 × active students`. Snapshotted
   *  alongside the monthly figure so the family-payment row holds
   *  the line-item breakdown, not just a rolled-up monthly. */
  annualFeeTotal: number;
  /** Annual transportation total. `null` for SNAP families (transport
   *  is waived); a number for non-SNAP families. Pass-through to the
   *  family-payment POST as-is so SNAP rows write `null` and
   *  downstream consumers can render N/A. */
  transportationTotal: number | null;
  /** Total SUFS scholarship dollars awarded across every active
   *  student in the family. Snapshotted onto
   *  `registration_families_payment.sufs_total` at approval time so
   *  billing surfaces don't have to re-sum per-student rows.
   *  `null` when the family has no SUFS scholarship. */
  sufsTotal: number | null;
  onApproved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function runApprove() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/family-progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId, yearId, isAccepted: true }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Approve failed (${res.status})`);
      }

      // Bring the family-payment row's `isFamilyAccepted` flag in
      // sync. The monthly amount itself was already snapshotted at
      // each per-student Confirm Scholarship Award Amount click —
      // this final write just flips the acceptance flag and
      // refreshes the monthly figure with the latest computed
      // value (in case admin tweaked any per-student amount
      // between confirms).
      try {
        const snapRes = await fetch(`/api/admin/family-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            familyId,
            yearId,
            monthly_tuition_payment: monthlyTuitionPayment,
            // Line-item snapshot — admin fee always set. For
            // transport, SNAP families pass explicit `null`
            // (waived) and non-SNAP families OMIT the field so
            // the route server-derives the sum from every active
            // app's `transportation_cost`. The route is the
            // authoritative computer; the page deliberately
            // doesn't pass its own sum to avoid drift from stale
            // SWR caches.
            annual_fee_total: annualFeeTotal,
            ...(transportationTotal === null
              ? { transportation_total: null }
              : {}),
            // SUFS total — sum of every active student's
            // `sufs_award_amount`. `null` when the family has no
            // SUFS scholarship; the route preserves null vs.
            // undefined so legacy rows don't get clobbered with 0.
            sufs_total: sufsTotal,
            isFamilyAccepted: true,
          }),
        });
        if (!snapRes.ok) {
          const snapErr = await snapRes.json().catch(() => null);
          console.error("[ApproveFamilyButton] snapshot failed:", snapErr);
          toast.error(
            "Approved, but couldn't update the payment snapshot — retry from the tuition page."
          );
        }
      } catch (snapErr) {
        console.error("[ApproveFamilyButton] snapshot threw:", snapErr);
      }

      // Mirror the snapshot onto `registration_student_registration_progress`
      // — the registration-flow detail page (`/admin/registrations/[id]`)
      // reads its Tuition card from `monthly_tuition_payment` +
      // `monthly_transportation_payment` on this row, so the legacy
      // `registration_families_payment` snapshot above isn't enough on
      // its own. Without this PATCH, the registrations page renders
      // $0 / $0 in the Monthly Snapshot grid even though the family
      // has been accepted with real numbers.
      //
      // `monthly_transportation_payment` is the monthly figure (the
      // column above is the annualized total — divide by 12). SNAP
      // families have `transportationTotal === null` (transport
      // waived); we collapse to 0 there since the column is typed
      // as `number` rather than nullable.
      try {
        const monthlyTransport =
          transportationTotal == null
            ? 0
            : Math.round((transportationTotal / 12) * 100) / 100;
        const regSnapRes = await fetch(
          `/api/admin/registration-progress`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              familyId,
              yearId,
              monthly_tuition_payment: monthlyTuitionPayment,
              monthly_transportation_payment: monthlyTransport,
            }),
          }
        );
        if (!regSnapRes.ok) {
          const regErr = await regSnapRes.json().catch(() => null);
          console.error(
            "[ApproveFamilyButton] registration-progress snapshot failed:",
            regErr
          );
        }
      } catch (regErr) {
        console.error(
          "[ApproveFamilyButton] registration-progress snapshot threw:",
          regErr
        );
      }

      toast.success(`${familyName || "Family"} approved for this year.`);
      setOpen(false);
      onApproved();
    } catch (err) {
      console.error("[ApproveFamilyButton.runApprove] failed:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't approve.");
    } finally {
      setSaving(false);
    }
  }

  // Gate-check helper — drives the disabled state's hover title.
  // Returns null when the gate passes, an error message otherwise.
  // Order matters: the most actionable / earliest-in-flow gate
  // surfaces first so admin sees "do this before that" guidance.
  const gateBlockReason = computeApproveBlockReason({
    allDocsConfirmed,
    allSufsConfirmed,
    unconfirmedCount,
    unverifiedSections,
  });

  return (
    <>
      <Button
        type="button"
        size="lg"
        disabled={saving || !!gateBlockReason}
        onClick={() => setOpen(true)}
        className="bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
        title={
          gateBlockReason ??
          `Accept ${familyName || "family"} for the selected school year`
        }
      >
        {saving ? (
          <Loader2 className="size-4 mr-1.5 animate-spin" />
        ) : (
          <CheckCircle2 className="size-4 mr-1.5" />
        )}
        Accept {familyName || "Family"}
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(o) => {
          if (!saving) setOpen(o);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Approve {familyName || "family"} for this year?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The family will receive an acceptance email and gain
              access to the next steps — tuition review, enrollment
              agreement, and registration. Per-student scholarship
              awards stay as you&rsquo;ve set them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={(e) => {
                e.preventDefault();
                void runApprove();
              }}
            >
              {saving ? (
                <Loader2 className="size-4 mr-1.5 animate-spin" />
              ) : null}
              Yes, approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Family-level "reject" — sends the application back to the
 * editable apply flow by flipping `isSubmitted=false` and clearing
 * `submitted_at`. Lives next to Approve in each `<DecisionStudentRow>`
 * footer so admin can reject from the same surface they review.
 *
 * Naming note: the underlying behavior is "return for revisions"
 * rather than a final denial — the family can re-submit once they
 * fix things. We use "Reject" for the button label because that's
 * the term the rest of the admin-side conversation uses; the modal
 * copy below clarifies the actual semantics.
 */
function RejectApplicationButton({
  familyId,
  yearId,
  familyName,
  onRejected,
}: {
  familyId: number;
  yearId: number;
  familyName: string;
  onRejected: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function runReject() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/family-progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyId,
          yearId,
          isSubmitted: false,
          submitted_at: null,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Reject failed (${res.status})`);
      }
      toast.success(
        `${familyName || "Family"} application returned — back to the editable apply flow.`
      );
      setOpen(false);
      onRejected();
    } catch (err) {
      console.error("[RejectApplicationButton.runReject] failed:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't reject.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={saving}
        onClick={() => setOpen(true)}
        // Neutral gray rather than red — reject is a routine "send
        // back for revisions" action, not a destructive permanent
        // denial. The modal copy below carries the full semantics.
        className="bg-white"
        title="Send this application back to the family for revisions"
      >
        {saving ? (
          <Loader2 className="size-4 mr-1.5 animate-spin" />
        ) : (
          <Undo2 className="size-4 mr-1.5" />
        )}
        Reject
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(o) => {
          if (!saving) setOpen(o);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Return {familyName || "family"}&rsquo;s application?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The application moves back to the family&rsquo;s
              editable view so they can update it. It drops out of
              the admissions review queue until they re-submit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={(e) => {
                e.preventDefault();
                void runReject();
              }}
            >
              {saving ? (
                <Loader2 className="size-4 mr-1.5 animate-spin" />
              ) : null}
              Yes, reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Archive the family's application for the year. Captures a required
 * text reason so the next admin can see why the row was set aside —
 * stamps both `is_archived=true` and `reason_for_archive=<text>` in
 * a single `/api/admin/family-progress` PATCH so the audit pair
 * can't drift apart.
 *
 * Always available in the page header (no submitted / accepted gate)
 * since archive cases include "duplicate family on file" and
 * "withdrew before submitting" — admin needs to be able to retire
 * a row at any stage.
 *
 * The Save button is disabled until the textarea has non-empty
 * trimmed text; the route doesn't enforce that requirement so
 * future surfaces (e.g. a CSV-style bulk-archive) could lift it.
 */
function ArchiveApplicationButton({
  familyId,
  yearId,
  familyName,
  onArchived,
}: {
  familyId: number;
  yearId: number;
  familyName: string;
  onArchived: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function runArchive() {
    const trimmed = reason.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/family-progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyId,
          yearId,
          is_archived: true,
          reason_for_archive: trimmed,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Archive failed (${res.status})`);
      }
      toast.success(`${familyName || "Family"} archived.`);
      setOpen(false);
      setReason("");
      onArchived();
      // Send admin back to the applications list — the archived row
      // drops out of the active queues and surfaces in the dedicated
      // "Archived" card on that page, so there's nothing left to do
      // on the family detail page itself.
      router.push(`/admin/applications?yearId=${yearId}`);
    } catch (err) {
      console.error("[ArchiveApplicationButton.runArchive] failed:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't archive.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={saving}
        onClick={() => setOpen(true)}
        // `size="lg"` so it visually matches Reject + Approve in
        // the determination card footer; the prior `sm` was sized
        // for the page header it used to live in.
        className="bg-white"
        title="Archive this family's application for the year"
      >
        <Archive className="size-4 mr-1.5" />
        Archive
      </Button>

      {/* Reason capture — `<Dialog>` rather than `<AlertDialog>`
          because the Textarea needs proper focus + scroll behavior,
          which `<AlertDialog>`'s body doesn't accommodate cleanly.
          Cancel + Save share a footer so the modal acts like a
          mini-form. */}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (saving) return;
          setOpen(o);
          if (!o) setReason("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Archive {familyName || "family"}&rsquo;s application?
            </DialogTitle>
            <DialogDescription>
              Archiving moves this family out of the active admin
              review queues for this year. Add a short reason so the
              next admin knows why — duplicate row, withdrew, no
              follow-through, etc.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="archive-reason" className="text-xs font-medium">
              Reason for archiving
            </Label>
            <Textarea
              id="archive-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Duplicate family record (see family #14), or withdrew via email on Apr 14"
              rows={4}
              disabled={saving}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => {
                if (saving) return;
                setOpen(false);
                setReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving || reason.trim().length === 0}
              onClick={() => void runArchive()}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {saving ? (
                <Loader2 className="size-4 mr-1.5 animate-spin" />
              ) : (
                <Archive className="size-4 mr-1.5" />
              )}
              Archive application
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Admin escape hatch — hard-delete a family's per-year application
 * AND every row that hangs off it (apply-flow scholarship cluster,
 * student application rows, registration packets, progress rows,
 * payment snapshot). Family / parents / students stay so the
 * record survives for re-application; this is for wiping the
 * year-scoped data only.
 *
 * Dropped behind a typed-confirmation modal because the cascade is
 * irreversible — the admin has to type the family name (or "delete"
 * if no name is on file) before the destructive button unlocks.
 * Mirrors the safety affordance on similar admin nukes elsewhere.
 *
 * On success, navigates back to the Applications list since the
 * page we're sitting on no longer has data to render. Failures
 * are toasted with the upstream error so admin can tell whether
 * the cascade partially landed.
 */
function DeleteApplicationButton({
  familyId,
  yearId,
  familyName,
}: {
  familyId: number;
  yearId: number;
  familyName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Required typed confirmation — defaults to the family name when
  // it's on file, falls back to the literal string "delete" so the
  // affordance still works for unnamed/blank families. Comparison
  // is case-insensitive + trim-tolerant since admin will sometimes
  // type "Smith" with a trailing space.
  const expected = (familyName || "delete").trim();
  const matches =
    confirmText.trim().toLowerCase() === expected.toLowerCase();

  async function runDelete() {
    if (!matches) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/admin/family-applications/${familyId}?yearId=${yearId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Delete failed (${res.status})`);
      }
      const result = (await res.json()) as {
        ok?: boolean;
        failures?: Array<{ step: string; message: string }>;
      };
      // Surface partial-failure info: if the route reports any
      // step's row didn't delete, warn admin so they can retry or
      // check the underlying Xano table directly.
      if (Array.isArray(result.failures) && result.failures.length > 0) {
        console.warn(
          "[DeleteApplicationButton] partial cascade:",
          result.failures
        );
        toast.warning(
          `Deleted with ${result.failures.length} leftover row${
            result.failures.length === 1 ? "" : "s"
          }. Check console for details.`
        );
      } else {
        toast.success(
          `${familyName || "Family"}'s application deleted for the year.`
        );
      }
      setOpen(false);
      setConfirmText("");
      router.push(`/admin/applications?yearId=${yearId}`);
    } catch (err) {
      console.error("[DeleteApplicationButton.runDelete] failed:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't delete.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={deleting}
        onClick={() => setOpen(true)}
        // Red text + border so the action reads as destructive even
        // before the modal opens. `bg-white` keeps it from competing
        // with the colored Approve button down the page.
        className="bg-white border-red-200 text-red-700 hover:bg-red-50 hover:text-red-700"
        title="Permanently delete this family's application for the year"
      >
        <Trash2 className="size-4 mr-1.5" />
        Delete application
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (deleting) return;
          setOpen(o);
          if (!o) setConfirmText("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-700">
              Delete {familyName || "this family"}&rsquo;s application?
            </DialogTitle>
            <DialogDescription>
              This wipes the family&rsquo;s application row, all per-student
              applications, the scholarship + every contributing
              member / home / vehicle / benefit underneath it, both
              progress rows for the year, and the payment snapshot.
              The family, parents, students, and emergency contacts
              stay so the record survives for re-application.
              <br />
              <br />
              <span className="font-medium text-foreground">
                This can&rsquo;t be undone.
              </span>{" "}
              Type{" "}
              <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted text-foreground">
                {expected}
              </span>{" "}
              below to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label
              htmlFor="delete-confirm"
              className="text-xs font-medium"
            >
              Confirmation
            </Label>
            <Input
              id="delete-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={expected}
              disabled={deleting}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={deleting}
              onClick={() => {
                if (deleting) return;
                setOpen(false);
                setConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={deleting || !matches}
              onClick={() => void runDelete()}
              className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
            >
              {deleting ? (
                <Loader2 className="size-4 mr-1.5 animate-spin" />
              ) : (
                <Trash2 className="size-4 mr-1.5" />
              )}
              Yes, delete application
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Compute the family's monthly tuition snapshot for the year — the
 * value snapshotted into `registration_families_payment` when admin
 * approves. Mirrors the math `<ScholarshipReviewBlock>` renders
 * (one of three branches based on the path the family chose):
 *
 *   - Opt-out: 0 (admin sets per-student awards manually; no
 *     family-level matrix to derive from).
 *   - SNAP: `(tuition × N + admin_fee × N − sumSUFS) / 12`.
 *     Transport waived. Admin fee is per student on this path.
 *   - Otherwise (matrix path): `(calculatedTuition +
 *     calculatedTransport + annualFees) / 12`. Calculations match
 *     the matrix bracket the family lands in.
 *
 * Returns `0` when data isn't loaded yet (no scholarship row,
 * empty bracket cells, etc.) — the caller debounces the actual
 * write behind the Approve button which is gated on
 * `allSufsConfirmed` + `allDocsConfirmed` anyway, so by the time
 * admin clicks the data is loaded.
 */
function computeFamilyMonthlyTotal({
  scholarship,
  apps,
  schoolYear,
  payCells,
  netAssetsCells,
}: {
  scholarship: XanoScholarship | null;
  apps: XanoApplication[];
  schoolYear: XanoSchoolYear | null;
  payCells: AwardBracketCell[];
  netAssetsCells: AwardBracketCell[];
}): number {
  if (!scholarship || !schoolYear) return 0;

  const baseTuition = schoolYear.tuition ?? 0;
  const baseTransport = schoolYear.transportation_fees ?? 0;
  const annualFees = schoolYear.annual_fees ?? 0;

  const activeApps = apps.filter(
    (a) => (a as { isActive?: boolean }).isActive !== false
  );
  const numStudents = activeApps.length;

  // Opt-out → no matrix-derived total. Admin will fill this in
  // manually downstream if needed.
  if (scholarship.isNotParticipating) return 0;

  // SNAP path — straight-line math, no bracket.
  if (scholarship.isSNAPBenefits) {
    // Post-confirm: SailFuture's Opportunity Scholarship auto-rebate
    // covers tuition + transport beyond SUFS, so the family owes only
    // the admin/annual fee portion. Mirrors the SNAP cost determination
    // table's `familyOwedSnap` calculation so the snapshot we write to
    // `registration_families_payment` matches what admin saw on screen.
    if (scholarship.is_snap_confirmed === true) {
      return (annualFees * numStudents) / 12;
    }
    // Pre-confirm: full receipt minus SUFS (transport waived per SNAP).
    const sufsTotal = activeApps.reduce(
      (sum, a) => sum + sufsAmountFor(a.sufs_type, schoolYear),
      0
    );
    const total =
      baseTuition * numStudents + annualFees * numStudents - sufsTotal;
    return Math.max(total / 12, 0);
  }

  // Default Opportunity Scholarship path — re-derive the matrix
  // bracket the same way `<ScholarshipReviewBlock>` does so the
  // snapshot matches what admin saw on screen at approval time.
  const member =
    scholarship._registration_opportunity_scholarship_contributing_members_of_registration_opportunity_scholarship_1 ??
    scholarship._registration_opportunity_scholarship_contributing_members_of_registration_opportunity_scholarship ??
    null;
  const home =
    scholarship._registration_opportunity_scholarship_home_of_registration_opportunity_scholarship_3 ??
    scholarship._registration_opportunity_scholarship_home_of_registration_opportunity_scholarship ??
    null;
  const vehicle =
    scholarship._registration_opportunity_scholarship_vehicles_of_registration_opportunity_scholarship ??
    scholarship._registration_opportunity_scholarship_vehicles_of_registration_opportunity_scholarship_2 ??
    null;

  const householdSize =
    (scholarship.household_adults ?? 0) +
    (scholarship.household_children ?? 0);
  const wagesAnnualIncome = member?.estimated_annual_income ?? 0;
  const passiveAnnualIncome =
    ((scholarship.business_income_monthly ?? 0) +
      (scholarship.capital_gains_monthly ?? 0) +
      (scholarship.child_support_monthly ?? 0) +
      (scholarship.alimony_monthly ?? 0) +
      (scholarship.trusts_monthly ?? 0) +
      (scholarship.other_income_monthly ?? 0)) *
    12;
  const totalAnnualIncome = wagesAnnualIncome + passiveAnnualIncome;
  const liquidAssets =
    (scholarship.assets_checking ?? 0) +
    (scholarship.assets_savings ?? 0) +
    (scholarship.assets_retirement_savings ?? 0) +
    (scholarship.assets_stocks_bonds_securities ?? 0) +
    (scholarship.assets_trusts_inheritance ?? 0) +
    (scholarship.assets_business ?? 0);
  const homeEquity =
    home && Number.isFinite(home.total_value)
      ? (home.total_value ?? 0) - (home.outstanding_debt ?? 0)
      : 0;
  const vehicleEquity =
    vehicle && Number.isFinite(vehicle.total_value)
      ? (vehicle.total_value ?? 0) - (vehicle.remaining_debt ?? 0)
      : 0;
  const totalAssets = liquidAssets + homeEquity + vehicleEquity;
  const totalDebts =
    (scholarship.debts_credit_cards ?? 0) +
    (scholarship.debts_student_loans ?? 0) +
    (scholarship.debts_personal_loans ?? 0);
  const netAssets = totalAssets - totalDebts;

  const useNetAssetsMatrix = netAssets > 100_000;
  const matchedCell = useNetAssetsMatrix
    ? (netAssetsCells.find(
        (c) =>
          (c.net_asset_min ?? 0) <= netAssets &&
          (c.net_asset_max === null ||
            c.net_asset_max === undefined ||
            netAssets < (c.net_asset_max as number))
      ) ?? null)
    : (payCells.find(
        (c) =>
          c.household_size === householdSize &&
          (c.income_min ?? 0) <= totalAnnualIncome &&
          (c.income_max === null ||
            c.income_max === undefined ||
            totalAnnualIncome < (c.income_max as number))
      ) ?? null);

  const tuitionPct = useNetAssetsMatrix
    ? (matchedCell?.percentage_of_total_tuition ?? 0)
    : (matchedCell?.tuition_percentage ?? 0);

  const calculatedTuition = baseTuition * (tuitionPct / 100);
  const anyBusTransportation = apps.some((a) => a.is_bus_transportation);
  const transportBeforeOptIn = useNetAssetsMatrix
    ? baseTransport
    : baseTransport * (tuitionPct / 100);
  const calculatedTransport = anyBusTransportation ? transportBeforeOptIn : 0;

  return (calculatedTuition + calculatedTransport + annualFees) / 12;
}

/* ─────────────────────── Scholarship review (Decision header) ─────────────────────── */

interface AwardBracketCell {
  household_size?: number;
  income_min?: number;
  income_max?: number | null;
  net_asset_min?: number;
  net_asset_max?: number | null;
  tuition_percentage?: number;
  percentage_of_total_tuition?: number;
}

/**
 * Read-only summary that opens the Decision card. Surfaces the
 * family's financial picture + the matrix bracket they fall into
 * so admins can make a per-student Opportunity Scholarship
 * determination without bouncing to the Financial Aid section.
 *
 * Two paths based on net assets:
 *   - net assets > $100k → high-net-assets matrix (1D, asset bracket)
 *   - else → standard tuition matrix (2D, household × income)
 *
 * Annual income includes wages from the contributing-member row
 * (`estimated_annual_income`) plus passive monthly fields × 12.
 * Total assets include liquid asset columns plus the equity from
 * the family's home (`total_value − outstanding_debt`) and primary
 * vehicle (`total_value − remaining_debt`). The expansion source is
 * the `admin_family_application` Xano query; if a family has
 * multiple members / homes / vehicles, only the first is read here
 * (matches the endpoint's expansion shape today).
 */
function ScholarshipReviewBlock({
  yearId,
  scholarship,
  schoolYear,
  apps,
  familyId,
  loading,
  onScholarshipChanged,
}: {
  yearId: number;
  scholarship: XanoScholarship | null;
  schoolYear: XanoSchoolYear | null;
  /** Per-student application rows for this year — used to derive
   *  whether ANY student opted into bus transportation. The fee is
   *  per-family but the opt-in is per-application, so we OR the
   *  flags across the family's apps. */
  apps: XanoApplication[];
  /** Family id — threaded down to the Documents-to-review block so
   *  per-member Notes drawers write against the right family record. */
  familyId: number;
  loading: boolean;
  /** Bubbles up the SNAP confirm/undo so the parent (DecisionCard)
   *  re-fetches the scholarship row and the gate flips immediately.
   *  Same callback DocumentsToReviewBlock uses for unemployment +
   *  benefits. */
  onScholarshipChanged: () => void;
}) {
  const { data: payCells, isLoading: payLoading } = useSWR<AwardBracketCell[]>(
    yearId ? `/api/admin/school-year-brackets?yearId=${yearId}` : null,
    adminFetcher
  );
  const { data: netAssetsCells, isLoading: netLoading } = useSWR<
    AwardBracketCell[]
  >(
    yearId ? `/api/admin/school-year-net-assets-brackets?yearId=${yearId}` : null,
    adminFetcher
  );
  // Admin name lookup used to live here for the SNAP doc confirm
  // row; now that SNAP renders inside `<DocumentsToReviewBlock>`'s
  // table, the lookup lives there. No reason to duplicate the
  // fetch on this surface.

  const showSkeleton = loading || payLoading || netLoading;

  if (showSkeleton) {
    return (
      <div className="rounded-md border bg-white p-4 space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (!scholarship) {
    return (
      <div className="rounded-md border bg-white p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Scholarship Review
        </h4>
        <p className="text-sm text-muted-foreground">
          No scholarship row for this family + year yet — the parent
          hasn&rsquo;t opened the Financial Aid section. Once they do,
          their financial picture and the resulting payment bracket
          will land here.
        </p>
      </div>
    );
  }

  // Hoist a few school-year derived values above the path branches —
  // the SNAP cost determination needs them, and the regular Pay
  // Matrix path also reuses them lower in the function (the
  // duplicate declarations below this block read fine; same value,
  // unrelated scopes).
  const baseTuition = schoolYear?.tuition ?? 0;
  const baseTransport = schoolYear?.transportation_fees ?? 0;
  const annualFees = schoolYear?.annual_fees ?? 0;

  // Opt-out short-circuit. The matrix below depends on income / asset
  // figures the family explicitly chose not to provide, so rendering
  // the financial table with all-zeros would imply the lowest bracket
  // when the truth is "we don't know." Show the explicit opt-out
  // signal instead — admin can still set per-student awards manually
  // below this block.
  if (scholarship.isNotParticipating) {
    return (
      <div className="rounded-md border bg-white p-4 space-y-3">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Scholarship Review
          </h4>
          <p className="text-xs text-muted-foreground mt-1">
            The family opted out of the SailFuture Opportunity
            Scholarship for this year — no financial picture or matrix
            bracket to derive. Set per-student awards manually below.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="size-2 rounded-full bg-amber-500" aria-hidden />
          Opted out of Opportunity Scholarship
        </div>
      </div>
    );
  }

  // SNAP short-circuit. Same reasoning as the opt-out path: the
  // matrix is meaningless when the family pre-qualified via SNAP and
  // skipped the Opportunity Scholarship form, so we drop the
  // financial picture / matrix / contributing-members entirely and
  // just surface the SNAP award letter for verification. Admin sets
  // per-student awards manually below this block.
  if (scholarship.isSNAPBenefits) {
    // SNAP cost determination — replaces the matrix when the
    // family pre-qualifies via SNAP. The Opportunity Scholarship
    // form was skipped, so there's no income/asset bracket to
    // compute. Instead the family pays:
    //   - Tuition: full base × number of active students, less the
    //     SUFS sum across students.
    //   - Transport: $0 — SNAP families don't pay the
    //     transportation fee.
    //   - Annual admin fee: $500 per student (NOT per family on the
    //     SNAP path; the user spec'd this explicitly).
    //
    // Cost-per-student auto-fills further down via the
    // `sufsAmountFor` lookup in `<DecisionStudentRow>`; this table
    // is the family-level summary that mirrors the regular Pay
    // Matrix Determination receipt.
    const snapStudents = apps.filter(
      (a) => (a as { isActive?: boolean }).isActive !== false
    );
    const numStudents = snapStudents.length;
    const sufsTotal = snapStudents.reduce(
      (sum, a) => sum + sufsAmountFor(a.sufs_type, schoolYear),
      0
    );
    const tuitionTotal = baseTuition * numStudents;
    // Transport is shown on the SNAP cost table (admin needs to see
    // what the school normally bills) but the Opportunity
    // Scholarship line below absorbs it on the SNAP path. Multi-
    // student families: count tuition × N + transport × N for the
    // tuition+transport ceiling.
    const transportTotal = baseTransport * numStudents;
    const annualFeeTotal = annualFees * numStudents;
    // Pre-confirmation: family owes the remaining amount (tuition +
    // transport + admin fee − SUFS).
    // Post-confirmation: SailFuture's Opportunity Scholarship
    // covers tuition + transport that SUFS didn't, leaving only
    // the per-student admin fee for the family. Auto-derived so
    // admin doesn't have to type the rebate per student.
    const snapConfirmed = scholarship.is_snap_confirmed === true;
    const opportunityScholarshipRebate = snapConfirmed
      ? Math.max(tuitionTotal + transportTotal - sufsTotal, 0)
      : 0;
    const familyOwedSnap = snapConfirmed
      ? annualFeeTotal
      : tuitionTotal + transportTotal + annualFeeTotal - sufsTotal;
    const monthlySnap = familyOwedSnap / 12;
    return (
      <div className="rounded-md border bg-white p-4 space-y-4">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Scholarship Review
          </h4>
          <p className="text-xs text-muted-foreground mt-1">
            The family pre-qualifies via SNAP benefits. No
            Opportunity Scholarship financial form was filled out —
            confirm the award letter below and review the
            SUFS-derived cost determination.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
          SNAP benefits pre-qualification
        </div>
        {/* `DocumentsToReviewBlock` was previously rendered inline
            here on both the SNAP and non-SNAP paths. It now lives at
            the `DecisionCard` level so the card flow reads as: SUFS
            rows → Documents to Review → Scholarship Review (this
            block) → Student-Specific Payments. Keeping it lifted to
            one render also avoids the prior duplicate render across
            the two `ScholarshipReviewBlock` branches. */}

        {/* SNAP Cost Determination — same wrapper shell as Pay
            Matrix Determination so both paths read consistently;
            the body just runs different math. Body rows are
            explicit `bg-white` so the muted wrapper only shows
            through the totals rows. */}
        <div className="rounded-md border bg-muted/20 overflow-hidden">
          <div className="px-4 py-2 border-b bg-muted/40 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              SNAP Cost Determination
            </p>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {numStudents} student{numStudents === 1 ? "" : "s"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground px-4 pt-3 pb-2 bg-white">
            {snapConfirmed
              ? "SNAP award letter confirmed — SailFuture's Opportunity Scholarship covers tuition + transport beyond SUFS. The family pays only the per-student admin fee."
              : "Family pre-qualifies via SNAP. Confirm the award letter above to apply the Opportunity Scholarship rebate; the family will then pay only the per-student admin fee."}
          </p>
          <table className="w-full text-sm">
            <tbody className="divide-y border-t">
              <tr className="bg-white">
                <td className="px-4 py-2 font-medium">
                  Tuition
                  <span className="block text-[11px] text-muted-foreground font-normal">
                    {formatCurrency(baseTuition)} × {numStudents} student
                    {numStudents === 1 ? "" : "s"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatCurrency(tuitionTotal)}
                </td>
              </tr>
              <tr className="bg-white">
                <td className="px-4 py-2 font-medium">
                  Transport
                  <span className="block text-[11px] text-muted-foreground font-normal">
                    {formatCurrency(baseTransport)} × {numStudents} student
                    {numStudents === 1 ? "" : "s"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatCurrency(transportTotal)}
                </td>
              </tr>
              <tr className="bg-white">
                <td className="px-4 py-2 font-medium">
                  SUFS coverage
                  <span className="block text-[11px] text-muted-foreground font-normal">
                    Combined per-student SUFS awards
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                  -{formatCurrency(sufsTotal)}
                </td>
              </tr>
              {/* Opportunity Scholarship row — only renders post-SNAP-
                  confirmation. Auto-rebate equals (tuition + transport
                  − SUFS), wiping out everything except the admin fee.
                  Pre-confirmation we deliberately omit it; admin
                  needs to confirm the SNAP letter before the school
                  commits to covering the rest. */}
              {snapConfirmed ? (
                <tr className="bg-white">
                  <td className="px-4 py-2 font-medium">
                    Opportunity Scholarship
                    <span className="block text-[11px] text-muted-foreground font-normal">
                      Auto-rebate: covers tuition + transport beyond SUFS
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                    -{formatCurrency(opportunityScholarshipRebate)}
                  </td>
                </tr>
              ) : null}
              <tr className="bg-white">
                <td className="px-4 py-2 font-medium">
                  Annual admin fee
                  <span className="block text-[11px] text-muted-foreground font-normal">
                    {formatCurrency(annualFees)} × {numStudents} student
                    {numStudents === 1 ? "" : "s"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatCurrency(annualFeeTotal)}
                </td>
              </tr>
              <tr className="bg-muted/40">
                <td className="px-4 py-2 font-semibold">Family owed total</td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold">
                  {formatCurrency(familyOwedSnap)}
                </td>
              </tr>
              <tr className="bg-muted/40">
                <td className="px-4 py-2 font-semibold">
                  Monthly payment
                  <span className="ml-1.5 text-[11px] text-muted-foreground font-normal">
                    · 12 months
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold">
                  {formatCurrency(monthlySnap)}
                  /mo
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Read the admin-endpoint expansions. Each is a single object today
  // (Xano returns the first matching child); guard against null so a
  // family with no member / home / vehicle still renders. Xano's
  // alias suffixes have drifted across revisions of the
  // `admin_family_application` query (e.g. `_1` on contributing
  // members, `_3` on home), so each read falls back through the
  // known suffix variants and lands on `null` if none match.
  const member =
    scholarship._registration_opportunity_scholarship_contributing_members_of_registration_opportunity_scholarship_1 ??
    scholarship._registration_opportunity_scholarship_contributing_members_of_registration_opportunity_scholarship ??
    null;
  const home =
    scholarship._registration_opportunity_scholarship_home_of_registration_opportunity_scholarship_3 ??
    scholarship._registration_opportunity_scholarship_home_of_registration_opportunity_scholarship ??
    null;
  const vehicle =
    scholarship._registration_opportunity_scholarship_vehicles_of_registration_opportunity_scholarship ??
    scholarship._registration_opportunity_scholarship_vehicles_of_registration_opportunity_scholarship_2 ??
    null;

  const householdSize =
    (scholarship.household_adults ?? 0) +
    (scholarship.household_children ?? 0);

  const wagesAnnualIncome = member?.estimated_annual_income ?? 0;
  const passiveAnnualIncome =
    ((scholarship.business_income_monthly ?? 0) +
      (scholarship.capital_gains_monthly ?? 0) +
      (scholarship.child_support_monthly ?? 0) +
      (scholarship.alimony_monthly ?? 0) +
      (scholarship.trusts_monthly ?? 0) +
      (scholarship.other_income_monthly ?? 0)) *
    12;
  const totalAnnualIncome = wagesAnnualIncome + passiveAnnualIncome;

  // Assets in three buckets: liquid, home equity, vehicle equity.
  // Net the home / vehicle debts into their respective equities so
  // the Personal Debt row stays focused on unsecured liabilities
  // (credit cards / student loans / personal loans).
  const liquidAssets =
    (scholarship.assets_checking ?? 0) +
    (scholarship.assets_savings ?? 0) +
    (scholarship.assets_retirement_savings ?? 0) +
    (scholarship.assets_stocks_bonds_securities ?? 0) +
    (scholarship.assets_trusts_inheritance ?? 0) +
    (scholarship.assets_business ?? 0);
  const homeEquity =
    home && Number.isFinite(home.total_value)
      ? (home.total_value ?? 0) - (home.outstanding_debt ?? 0)
      : 0;
  const vehicleEquity =
    vehicle && Number.isFinite(vehicle.total_value)
      ? (vehicle.total_value ?? 0) - (vehicle.remaining_debt ?? 0)
      : 0;
  const totalAssets = liquidAssets + homeEquity + vehicleEquity;

  const totalDebts =
    (scholarship.debts_credit_cards ?? 0) +
    (scholarship.debts_student_loans ?? 0) +
    (scholarship.debts_personal_loans ?? 0);

  const netAssets = totalAssets - totalDebts;
  const familyNet = totalAnnualIncome + totalAssets - totalDebts;

  // Path selection. >$100k net assets routes to the dedicated
  // sliding-scale table on `_net_assets_bracket`.
  const useNetAssetsMatrix = netAssets > 100_000;

  let matchedCell: AwardBracketCell | null = null;
  let tuitionPct = 0;

  if (useNetAssetsMatrix) {
    matchedCell =
      (netAssetsCells ?? []).find(
        (c) =>
          (c.net_asset_min ?? 0) <= netAssets &&
          (c.net_asset_max === null ||
            c.net_asset_max === undefined ||
            netAssets < (c.net_asset_max as number))
      ) ?? null;
    tuitionPct = matchedCell?.percentage_of_total_tuition ?? 0;
  } else {
    matchedCell =
      (payCells ?? []).find(
        (c) =>
          c.household_size === householdSize &&
          (c.income_min ?? 0) <= totalAnnualIncome &&
          (c.income_max === null ||
            c.income_max === undefined ||
            totalAnnualIncome < (c.income_max as number))
      ) ?? null;
    tuitionPct = matchedCell?.tuition_percentage ?? 0;
  }

  // `baseTuition`, `baseTransport`, `annualFees` are all hoisted
  // above the SNAP branch (the SNAP cost table needs them too).
  const calculatedTuition = baseTuition * (tuitionPct / 100);
  // Bus transportation is a per-family fee, but the opt-in flag lives
  // on each `registration_application`. OR across the family's apps —
  // a single student riding pulls the family into the fee. When no
  // student opts in, we zero out the row entirely (and dash it in the
  // table below) so the matrix doesn't bake a fee the family didn't
  // sign up for.
  const anyBusTransportation = apps.some((a) => a.is_bus_transportation);
  const transportBeforeOptIn = useNetAssetsMatrix
    ? baseTransport
    : baseTransport * (tuitionPct / 100);
  // High-net-assets families pay the full transportation fee; on the
  // standard matrix transport scales with the same percentage.
  const calculatedTransport = anyBusTransportation
    ? transportBeforeOptIn
    : 0;

  // Coordinates the matrix views use to highlight the matching cell.
  // Stable keys built from the bracket bounds + household so the
  // highlight survives re-orders/sorts.
  const matchedPayKey = useNetAssetsMatrix
    ? null
    : matchedCell
      ? `${matchedCell.household_size}::${matchedCell.income_min}-${
          matchedCell.income_max ?? "null"
        }`
      : null;
  const matchedNetKey = useNetAssetsMatrix && matchedCell
    ? `${matchedCell.net_asset_min}-${matchedCell.net_asset_max ?? "null"}`
    : null;

  // SNAP and opt-out paths short-circuit above this point — the
  // remainder of the block is the full Opportunity Scholarship
  // review (financial picture + matrix + documents). No SNAP
  // banner inline here anymore; SNAP families render their
  // dedicated SNAP-only view from the early return up top.

  return (
    <div className="space-y-4">
      {/* Scholarship review — financial picture rendered with the
          same wrapper shell as the Pay Matrix Determination block
          below: outer rounded border, header strip with title +
          subtitle, table inside. Keeps both blocks visually in
          conversation rather than the prior plain-table treatment. */}
      <div className="rounded-md border bg-muted/20 overflow-hidden">
        <div className="px-4 py-2 border-b bg-muted/40">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Scholarship Review
          </p>
        </div>
        <p className="text-xs text-muted-foreground px-4 pt-3 pb-2 bg-white">
          Auto-calculated from the family&rsquo;s Financial Aid
          submission. Use the bracket determination below to inform
          the per-student Opportunity Scholarship awards.
        </p>
        {/* Body rows are explicit `bg-white` so the muted wrapper only
            shows through the header strip + the totals row. Without
            this the middle rows inherit the muted `bg-muted/20`
            wrapper tone and the table reads as one flat block. */}
        <table className="w-full text-sm">
          <tbody className="divide-y border-t">
            <tr className="bg-white">
              <td className="px-4 py-2 font-medium">
                Annual income
                <span className="block text-[11px] text-muted-foreground font-normal">
                  {formatCurrency(wagesAnnualIncome)} wages +{" "}
                  {formatCurrency(passiveAnnualIncome)} passive
                </span>
              </td>
              <td
                className={cn(
                  "px-4 py-2 text-right tabular-nums align-top",
                  totalAnnualIncome > 0 && "text-green-600"
                )}
              >
                {formatCurrency(totalAnnualIncome)}
              </td>
            </tr>
            <tr className="bg-white">
              <td className="px-4 py-2 font-medium">
                Total assets
                <span className="block text-[11px] text-muted-foreground font-normal">
                  {formatCurrency(liquidAssets)} liquid
                  {homeEquity !== 0
                    ? ` · ${formatCurrency(homeEquity)} home equity`
                    : ""}
                  {vehicleEquity !== 0
                    ? ` · ${formatCurrency(vehicleEquity)} vehicle equity`
                    : ""}
                </span>
              </td>
              <td
                className={cn(
                  "px-4 py-2 text-right tabular-nums align-top",
                  totalAssets > 0 && "text-green-600",
                  // Underwater total assets (debts/equity netting
                  // out below zero) read as red, matching the
                  // negative-balance pattern used on the Personal
                  // debt row below.
                  totalAssets < 0 && "text-red-600"
                )}
              >
                {formatCurrency(totalAssets)}
              </td>
            </tr>
            <tr className="bg-white">
              <td className="px-4 py-2 font-medium">
                Personal debt / liabilities
                <span className="block text-[11px] text-muted-foreground font-normal">
                  Credit cards, student loans, personal loans
                </span>
              </td>
              <td
                className={cn(
                  "px-4 py-2 text-right tabular-nums align-top",
                  totalDebts > 0 && "text-red-600"
                )}
              >
                -{formatCurrency(totalDebts)}
              </td>
            </tr>
            <tr className="bg-muted/40">
              <td className="px-4 py-2 font-semibold">Family Net</td>
              <td
                className={cn(
                  "px-4 py-2 text-right tabular-nums font-semibold",
                  familyNet < 0 ? "text-red-600" : "text-green-600"
                )}
              >
                {formatCurrency(familyNet)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Matrix bracket determination — final per-family payment
          breakdown rendered as a small table so it reads as a
          receipt: Tuition + Transport + Annual Fee = Total. The
          $500 annual fee applies to every family regardless of the
          matrix path. */}
      <div className="rounded-md border bg-muted/20 overflow-hidden">
        <div className="px-4 py-2 border-b bg-muted/40 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Pay Matrix Determination
          </p>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {useNetAssetsMatrix ? "High net assets" : "Standard"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground px-4 pt-3">
          {useNetAssetsMatrix
            ? `Net assets ${formatCurrency(netAssets)} exceed $100k — using the high-net-assets sliding scale.${anyBusTransportation ? " Transport is the full base fee." : ""}`
            : `Household of ${householdSize}, annual income ${formatCurrency(totalAnnualIncome)} — using the standard tuition matrix.`}
        </p>
        {matchedCell ? (
          // Body rows are explicit `bg-white`; the muted wrapper only
          // shows through on the bottom totals rows so admin's eye
          // lands on the totals section.
          <table className="w-full text-sm mt-2">
            <tbody className="divide-y border-t">
              {/* Family-pays percentage — hidden when the matched
                  bracket assigns the family $0 of tuition (i.e.
                  household income / assets fall below the matrix's
                  minimum-payment threshold). A literal "Family
                  pays 0%" row reads like an empty bracket; better
                  to drop it entirely and let the Tuition row's $0
                  carry the message. */}
              {tuitionPct > 0 ? (
                <tr className="bg-white">
                  <td className="px-4 py-2 font-medium">Family pays</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {tuitionPct}%
                  </td>
                </tr>
              ) : null}
              <tr className="bg-white">
                <td className="px-4 py-2 font-medium">Tuition</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatCurrency(calculatedTuition)}
                </td>
              </tr>
              <tr className="bg-white">
                <td className="px-4 py-2 font-medium">
                  {useNetAssetsMatrix ? "Transport (full)" : "Transport"}
                  {!anyBusTransportation ? (
                    <span className="block text-[11px] text-muted-foreground font-normal">
                      No student opted into bus transportation
                    </span>
                  ) : null}
                </td>
                <td
                  className={cn(
                    "px-4 py-2 text-right tabular-nums",
                    !anyBusTransportation && "text-muted-foreground"
                  )}
                >
                  {anyBusTransportation
                    ? formatCurrency(calculatedTransport)
                    : "—"}
                </td>
              </tr>
              <tr className="bg-white">
                <td className="px-4 py-2 font-medium">
                  Annual fee
                  <span className="block text-[11px] text-muted-foreground">
                    Applies to every family regardless of bracket
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums align-top">
                  {formatCurrency(annualFees)}
                </td>
              </tr>
              <tr className="bg-muted/40">
                <td className="px-4 py-2 font-semibold">Family owed total</td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold">
                  {formatCurrency(
                    calculatedTuition + calculatedTransport + annualFees
                  )}
                </td>
              </tr>
              {/* Monthly cadence — matches the acceptance-side
                  tuition page so admin and parent see the same
                  monthly figure. Aug–Jul, 12 equal months; the
                  cadence is inlined as a bulleted suffix on the
                  label rather than a stacked subtitle. */}
              <tr className="bg-muted/40">
                <td className="px-4 py-2 font-semibold">
                  Monthly payment
                  <span className="ml-1.5 text-[11px] text-muted-foreground font-normal">
                    · 12 months
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold">
                  {formatCurrency(
                    (calculatedTuition + calculatedTransport + annualFees) / 12
                  )}
                  /mo
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="text-xs italic text-muted-foreground px-4 py-3">
            No matrix cell matches this family&rsquo;s bracket. Verify
            the matrix is configured for the relevant{" "}
            {useNetAssetsMatrix
              ? "net-asset bracket"
              : "household size + income range"}{" "}
            on the school year page.
          </p>
        )}
      </div>

      {/* Only render the applicable matrix — the inactive path adds
          noise without clarifying the determination. Net assets >
          $100k → high-net-assets table; otherwise → standard pay
          matrix. */}
      {useNetAssetsMatrix ? (
        <NetAssetsMatrixView
          cells={netAssetsCells ?? []}
          matchedKey={matchedNetKey}
          baseTuition={baseTuition}
          dimmed={false}
        />
      ) : (
        <PayMatrixView
          cells={payCells ?? []}
          matchedKey={matchedPayKey}
          matchedHouseholdSize={householdSize}
          baseTuition={baseTuition}
          dimmed={false}
        />
      )}

      {/* `DocumentsToReviewBlock` moved out — now rendered once at
          the `DecisionCard` level (between the per-student SUFS
          rows and this block) so the card flow reads:
            SUFS rows → Documents to Review → Scholarship Review →
            Student-Specific Payments. */}
    </div>
  );
}

/* ─── Full pay matrix (read-only, with highlighted bracket) ─── */

function bracketLabelMoney(min: number, max: number | null | undefined): string {
  if (max === null || max === undefined) return `${formatCurrency(min)} +`;
  return `${formatCurrency(min)} – ${formatCurrency(max)}`;
}

function PayMatrixView({
  cells,
  matchedKey,
  matchedHouseholdSize,
  baseTuition,
  dimmed,
}: {
  cells: AwardBracketCell[];
  /** `${household_size}::${min}-${max}` or null when this matrix
   *  isn't the active path for this family. */
  matchedKey: string | null;
  /** Household size for the active row highlight. Null = no row
   *  highlight (e.g. when this matrix is dimmed). */
  matchedHouseholdSize: number | null;
  baseTuition: number;
  /** When true, the matrix renders at 50% opacity with a "Not
   *  applicable" hint — the family routes through the other matrix. */
  dimmed: boolean;
}) {
  const sizes = Array.from(
    new Set(cells.map((c) => c.household_size ?? 0).filter((s) => s > 0))
  ).sort((a, b) => a - b);

  // Distinct brackets, sorted by income_min; null max sinks to bottom.
  const brackets: Array<{
    key: string;
    income_min: number;
    income_max: number | null;
  }> = [];
  const seen = new Set<string>();
  for (const c of cells) {
    const min = c.income_min ?? 0;
    const max = c.income_max ?? null;
    const key = `${min}-${max ?? "null"}`;
    if (!seen.has(key)) {
      seen.add(key);
      brackets.push({ key, income_min: min, income_max: max });
    }
  }
  brackets.sort((a, b) => {
    if (a.income_max === null && b.income_max !== null) return 1;
    if (b.income_max === null && a.income_max !== null) return -1;
    return a.income_min - b.income_min;
  });

  const cellLookup = new Map<string, AwardBracketCell>();
  for (const c of cells) {
    const key = `${c.household_size}::${c.income_min}-${
      c.income_max ?? "null"
    }`;
    cellLookup.set(key, c);
  }

  // The bracket-key portion of `matchedKey` (after `::`) — used to
  // highlight the matching column header.
  const matchedColKey = matchedKey ? matchedKey.split("::")[1] : null;

  if (sizes.length === 0 || brackets.length === 0) {
    return (
      <div className="rounded-md border bg-white p-4">
        <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Family Tuition Payment Matrix
        </h5>
        <p className="text-xs text-muted-foreground mt-1">
          No matrix configured for this year yet.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border bg-white overflow-hidden",
        dimmed && "opacity-60"
      )}
    >
      <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
        <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Family Tuition Payment Matrix
        </h5>
        {dimmed ? (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Not applicable — net assets &gt; $100k
          </span>
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Active path
          </span>
        )}
      </div>
      {/* Same body styling as the rest of the admin tables: text-sm
          rows, px-4 py-3 cells, xs uppercase tracking-wider headers.
          Highlight is intentionally subtle — yellow-50 wash on the
          active row, slightly darker yellow-100 on the matched cell,
          no heavy amber ring. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">
                Household
              </th>
              {brackets.map((b) => (
                <th
                  key={b.key}
                  className={cn(
                    "text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 whitespace-nowrap",
                    b.key === matchedColKey && !dimmed && "bg-yellow-50"
                  )}
                >
                  {bracketLabelMoney(b.income_min, b.income_max)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {sizes.map((size) => {
              const isMatchedRow =
                !dimmed && size === matchedHouseholdSize;
              return (
                <tr
                  key={size}
                  className={isMatchedRow ? "bg-yellow-50/60" : ""}
                >
                  <td className="px-4 py-3 font-medium whitespace-nowrap">
                    {size} {size === 1 ? "person" : "people"}
                  </td>
                  {brackets.map((b) => {
                    const cell = cellLookup.get(`${size}::${b.key}`);
                    const pct = cell?.tuition_percentage ?? 0;
                    const dollars = baseTuition * (pct / 100);
                    const isMatchedCell =
                      !dimmed &&
                      `${size}::${b.key}` === matchedKey;
                    return (
                      <td
                        key={b.key}
                        className={cn(
                          "px-4 py-3 tabular-nums whitespace-nowrap",
                          isMatchedCell &&
                            "bg-yellow-100 font-semibold"
                        )}
                      >
                        {pct}% • {formatCurrency(dollars)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Full net-assets matrix (read-only, with highlighted row) ─── */

function NetAssetsMatrixView({
  cells,
  matchedKey,
  baseTuition,
  dimmed,
}: {
  cells: AwardBracketCell[];
  /** `${min}-${max}` of the matching net-asset bracket, or null when
   *  this matrix isn't the active path. */
  matchedKey: string | null;
  baseTuition: number;
  dimmed: boolean;
}) {
  // Sort by net_asset_min; null max (the "+ unbounded" row) sinks to
  // the bottom so the matrix reads in ascending order.
  const sorted = [...cells].sort((a, b) => {
    const aMax = a.net_asset_max ?? null;
    const bMax = b.net_asset_max ?? null;
    if (aMax === null && bMax !== null) return 1;
    if (bMax === null && aMax !== null) return -1;
    return (a.net_asset_min ?? 0) - (b.net_asset_min ?? 0);
  });

  if (sorted.length === 0) {
    return (
      <div className="rounded-md border bg-white p-4">
        <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Net Assets &gt; $100k Payment Percentage
        </h5>
        <p className="text-xs text-muted-foreground mt-1">
          No high-net-assets brackets configured for this year yet.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border bg-white overflow-hidden",
        dimmed && "opacity-60"
      )}
    >
      <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
        <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Net Assets &gt; $100k Payment Percentage
        </h5>
        {dimmed ? (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Not applicable — net assets ≤ $100k
          </span>
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Active path
          </span>
        )}
      </div>
      {/* Standardized table styling — text-sm body, px-4 py-3 cells,
          xs uppercase headers. Highlight: a soft yellow-50 row
          background instead of the previous amber-100 + ring-2
          combo. Subtle enough to scan past, distinct enough to land
          on. */}
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 w-1/2">
              Net Asset Bracket
            </th>
            <th className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 w-1/2">
              Family Pays
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sorted.map((c) => {
            const min = c.net_asset_min ?? 0;
            const max = c.net_asset_max ?? null;
            const key = `${min}-${max ?? "null"}`;
            const isMatched = !dimmed && key === matchedKey;
            const pct = c.percentage_of_total_tuition ?? 0;
            const dollars = baseTuition * (pct / 100);
            return (
              <tr
                key={key}
                className={cn(isMatched && "bg-yellow-50")}
              >
                <td className="px-4 py-3 font-medium whitespace-nowrap">
                  {bracketLabelMoney(min, max)}
                </td>
                <td
                  className={cn(
                    "px-4 py-3 tabular-nums whitespace-nowrap",
                    isMatched && "font-semibold"
                  )}
                >
                  {pct}% • {formatCurrency(dollars)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One row per student in the Decision card. Every field is
 * always-editable — there's no Edit/Save round-trip. Each input
 * autosaves: text/number fields fire a PATCH on blur (compared
 * against the last-saved value to skip no-ops); Selects fire on
 * change. The "Confirm" button stays as a one-click toggle for the
 * `sufs_confirmed` flag.
 */
function DecisionStudentRow({
  student,
  app,
  schoolYear,
  onSaved,
  approveCtx,
}: {
  student: Student;
  app: XanoApplication | undefined;
  schoolYear: XanoSchoolYear | null;
  onSaved: () => void;
  /** Slimmed approve-context — only the bits the per-student row's
   *  Confirm button cares about now that Reject + Approve moved to
   *  the family-level footer at the bottom of the Scholarship
   *  Determination card. */
  approveCtx: {
    /** True when the family's per-year progress row has
     *  `isAccepted=true`. Hides the Confirm button (the row reads
     *  as final once admin has approved). */
    accepted: boolean;
    /** True when every confirmable document under "Documents to
     *  review" has been marked confirmed. The Confirm Scholarship
     *  Award Amount button is gated on this so admin can't lock
     *  in a per-student award before reviewing the income docs. */
    allDocsConfirmed: boolean;
    /** True when the family pre-qualifies via SNAP. Drives the
     *  per-student Cost per student auto-fill: SNAP families have
     *  no Opportunity Scholarship award form, so the cost defaults
     *  to (base tuition − student's SUFS amount). Admin can still
     *  override the value manually. */
    isSNAPPath: boolean;
    /** True when admin has verified the Scholarship section
     *  (`scholarship_admin_complete=true`). Locks the per-student
     *  Undo button — admin can't unwind a single student's award
     *  while the section verify is still claiming the whole
     *  family is good. Admin has to undo the section verify
     *  first; once that drops to false, per-student Undo unlocks. */
    scholarshipSectionVerified: boolean;
  };
}) {
  const [confirming, setConfirming] = useState(false);
  // Confirm flips an admissions-decision-relevant flag, so it gets a
  // warning modal first instead of a one-click toggle. The modal
  // also doubles as a clear/uncheck affordance when the field is
  // already confirmed.
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);

  const sufsType = app?.sufs_type ?? "";
  const sufsStatus = app?.sufs_status ?? "";
  const sufsAmount = sufsAmountFor(sufsType, schoolYear);
  // The "is this student's award confirmed?" state lives on
  // `confirmed_scholarship` now (renamed from `sufs_confirmed`
  // since the button covers SUFS + Opportunity Scholarship). The
  // local name `sufsConfirmed` stays here for blast-radius reasons
  // — every render branch downstream reads it — but the source of
  // truth on the row is the new column.
  const sufsConfirmed = app?.confirmed_scholarship === true;

  // Cost per student auto-fill for SNAP families. SNAP path has no
  // Opportunity Scholarship form, so the per-student cost defaults
  // to (base tuition − this student's SUFS award) — i.e. "tuition
  // remaining after SUFS." Only fills the input when:
  //   - the family is on the SNAP path
  //   - the persisted value on the row is null/0 (admin hasn't
  //     entered a manual override yet)
  // Once admin types a value or saves a non-zero amount, the
  // suggestion stops fighting the manual entry.
  const baseTuition = schoolYear?.tuition ?? 0;
  const snapSuggestedCost = Math.max(baseTuition - sufsAmount, 0);
  const persistedAward = app?.opportunity_scholarship_award_amount;
  const shouldAutoFillSnap =
    approveCtx.isSNAPPath &&
    (persistedAward === null ||
      persistedAward === undefined ||
      persistedAward === 0);

  // Local mirror of the editable fields so typing feels native.
  // Each field's onBlur compares against the source `app` snapshot
  // and PATCHes only the diff, so concurrent edits to other fields
  // don't get clobbered. Cost per student initializes to the SNAP
  // suggestion when applicable; admin can overwrite at will.
  // Transportation cost — per-student column on the app row,
  // editable by admin. Defaults to the school year's
  // `transportation_fees` when the parent opted into bus
  // transportation but admin hasn't set an override yet. `null`
  // when bus wasn't elected, so the receipt math distinguishes
  // "no transport" from "transport at $0". Stringified in the
  // draft so the controlled input doesn't fight React's number
  // → string coercion.
  const persistedTransportCost = app?.transportation_cost;
  const defaultTransportCost = schoolYear?.transportation_fees ?? 0;

  const [draft, setDraft] = useState({
    sufs_award_id: app?.sufs_award_id ? String(app.sufs_award_id) : "",
    opportunity_scholarship_award_amount: persistedAward
      ? String(persistedAward)
      : shouldAutoFillSnap
        ? String(snapSuggestedCost)
        : "",
    transportation_cost:
      persistedTransportCost != null
        ? String(persistedTransportCost)
        : app?.is_bus_transportation
          ? String(defaultTransportCost)
          : "",
  });

  useEffect(() => {
    setDraft({
      sufs_award_id: app?.sufs_award_id ? String(app.sufs_award_id) : "",
      opportunity_scholarship_award_amount: persistedAward
        ? String(persistedAward)
        : shouldAutoFillSnap
          ? String(snapSuggestedCost)
          : "",
      transportation_cost:
        persistedTransportCost != null
          ? String(persistedTransportCost)
          : app?.is_bus_transportation
            ? String(defaultTransportCost)
            : "",
    });
    // Re-derive only when the source data changes; deliberate stale
    // closure on shouldAutoFillSnap is fine since it's computed
    // from `app` + `approveCtx.isSNAPPath` which are both deps.
  }, [
    app,
    persistedAward,
    shouldAutoFillSnap,
    snapSuggestedCost,
    persistedTransportCost,
    defaultTransportCost,
  ]);

  /**
   * Single-field PATCH. Compares a stringified `current` against the
   * already-persisted `previous` and skips the network call when
   * nothing changed. Surfaces errors via toast — the caller doesn't
   * need to handle rejection.
   */
  async function patchField(
    fieldKey: string,
    body: Record<string, unknown>
  ) {
    if (!app) return;
    setSavingField(fieldKey);
    try {
      const res = await fetch(`/api/admin/applications/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${res.status})`);
      }
      onSaved();
    } catch (err) {
      console.error("[DecisionStudentRow.patchField] failed:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSavingField(null);
    }
  }

  /**
   * Open the confirm-flow modal. The actual flip happens after the
   * admin confirms in the dialog — `runToggleConfirmed` below.
   *
   * The button is now scoped to the whole row's scholarship award
   * (SUFS + Opportunity Scholarship), so admin can confirm even
   * when the student isn't on a SUFS tier — e.g. opportunity
   * scholarship only, or a $0 award where admin still needs to
   * acknowledge the determination. The earlier "pick a SUFS tier
   * first" guard blocked exactly that case.
   */
  function toggleConfirmed() {
    if (!app) return;
    setConfirmDialogOpen(true);
  }

  async function runToggleConfirmed() {
    if (!app) return;
    setConfirming(true);
    try {
      // On confirm (flipping `confirmed_scholarship` true), also
      // stamp the SUFS award amount onto the row so the column
      // captures the dollar value at the moment admin locked in
      // the award. Without this, a tier change after confirmation
      // could drift the stored amount away from "what admin
      // confirmed" — the snapshot semantic is important for
      // billing audits.
      //
      // On undo (flipping to false), we deliberately keep the
      // amount column intact rather than zeroing it out. The bool
      // is the source of truth for "is this confirmed"; the
      // amount is just the captured number, useful even when the
      // confirmation is cleared.
      const next = !sufsConfirmed;
      const body: Record<string, unknown> = {
        confirmed_scholarship: next,
      };
      if (next) {
        body.sufs_award_amount = sufsAmountFor(
          sufsType ?? "",
          schoolYear
        );
      }
      const res = await fetch(`/api/admin/applications/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${res.status})`);
      }
      // Per-student confirm only flips this student's
      // `sufs_confirmed`. The family-payment snapshot is a
      // family-level concept and lives entirely on the family
      // Approve flow — per-student edits before approval don't
      // mutate the snapshot row.
      toast.success(
        sufsConfirmed
          ? "SUFS confirmation cleared."
          : "SUFS selection confirmed."
      );
      setConfirmDialogOpen(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="rounded-md border bg-muted/10 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">
            {student.first_name} {student.last_name}
          </p>
          {!app ? (
            <p className="text-xs italic text-muted-foreground">
              No application row for this year.
            </p>
          ) : null}
        </div>
        {savingField ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Saving…
          </span>
        ) : null}
      </div>

      {app ? (
        <div className="space-y-4">
          {/* ─── SUFS sub-card ─── */}
          <div className="rounded-md border bg-white p-4 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Step Up For Students
            </h4>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <Field>
                <FieldLabel className="text-xs">SUFS award tier</FieldLabel>
                <Select
                  value={sufsType || "__none"}
                  onValueChange={(v) => {
                    const nextType = v === "__none" ? "" : v;
                    // Also stamp the derived dollar amount onto
                    // `sufs_award_amount` so the column on the
                    // application row tracks what admin picked.
                    // The amount used to live only as derived state
                    // (computed from `sufs_type` + the school year's
                    // tier dollars on every render), but billing
                    // surfaces need a stored figure that survives
                    // future year-amount edits. Tier change writes
                    // both columns in the same PATCH.
                    const nextAmount = sufsAmountFor(nextType, schoolYear);
                    patchField("sufs_type", {
                      sufs_type: nextType,
                      sufs_award_amount: nextAmount,
                    });
                  }}
                >
                  <SelectTrigger className="w-full bg-white">
                    <SelectValue placeholder="Select tier" />
                  </SelectTrigger>
                  <SelectContent>
                    {SUFS_TIERS.map((tier) => {
                      const amount = tier.field
                        ? sufsAmountFor(tier.key, schoolYear)
                        : 0;
                      return (
                        <SelectItem
                          key={tier.key || "__none"}
                          value={tier.key || "__none"}
                        >
                          {tier.label}
                          {tier.field
                            ? ` · ${formatCurrencyZero(amount)}`
                            : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel className="text-xs">SUFS award amount</FieldLabel>
                {savingField === "sufs_type" ? (
                  // Tier just changed — show a skeleton on the
                  // derived amount field so the admin doesn't see a
                  // stale dollar value while the SWR refetch lands.
                  <Skeleton className="h-9 w-full rounded-md" />
                ) : (
                  <Input
                    value={sufsType ? formatCurrencyZero(sufsAmount) : "—"}
                    disabled
                    readOnly
                    onChange={() => {}}
                    className="border-input disabled:opacity-100 disabled:bg-white disabled:cursor-default"
                  />
                )}
              </Field>

              <Field>
                <FieldLabel className="text-xs">SUFS status</FieldLabel>
                <Select
                  value={sufsStatus || "__none"}
                  onValueChange={(v) =>
                    patchField("sufs_status", {
                      sufs_status: v === "__none" ? "" : v,
                    })
                  }
                >
                  <SelectTrigger className="w-full bg-white">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    {SUFS_STATUSES.map((s) => (
                      <SelectItem
                        key={s.key || "__none"}
                        value={s.key || "__none"}
                      >
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel className="text-xs">SUFS award ID</FieldLabel>
                <Input
                  value={draft.sufs_award_id}
                  type="text"
                  inputMode="numeric"
                  // SUFS portal hands out a fixed 9-digit numeric
                  // ID. Constrain the input shape so admin can't
                  // typo extra digits or paste a longer string in
                  // by accident — `pattern` covers form-submit
                  // hints, `maxLength` enforces the cap on typed
                  // characters, and the onChange filter drops any
                  // non-digit input on the fly (paste of a
                  // hyphenated ID like "123-456-789" gets cleaned
                  // before it lands in state).
                  pattern="\d{0,9}"
                  maxLength={9}
                  placeholder="From SUFS portal (9 digits)"
                  onChange={(e) => {
                    const cleaned = e.target.value
                      .replace(/\D/g, "")
                      .slice(0, 9);
                    setDraft((d) => ({
                      ...d,
                      sufs_award_id: cleaned,
                    }));
                  }}
                  onBlur={() => {
                    const next = Number(draft.sufs_award_id);
                    const safe = Number.isFinite(next) ? next : 0;
                    if (safe === (app.sufs_award_id ?? 0)) return;
                    patchField("sufs_award_id", { sufs_award_id: safe });
                  }}
                  className="border-input"
                />
              </Field>
            </div>
          </div>

          {/* ─── Opportunity Scholarship sub-card ─── Hidden on the
              SNAP path: SNAP families' Opportunity Scholarship is
              auto-calculated at the family level (the rebate row
              on the SNAP cost determination card up top), so a
              per-student input here would let admin overwrite a
              derived value with a hand-typed one and split-brain
              the math. The matrix path keeps the manual input. */}
          {/* ─── Transportation sub-card ─── Only renders when
              the parent opted into bus transportation on their
              application. Stores the per-student fee on
              `transportation_cost` (decimal, nullable). Admin can
              override the school-year default; clearing the input
              writes `null` so the family-level transport total
              treats this student as "no transport." */}
          {app?.is_bus_transportation ? (
            <div className="rounded-md border bg-white p-4 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Transportation
              </h4>
              <Field>
                <FieldLabel className="text-xs">Cost per student</FieldLabel>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                    $
                  </span>
                  <Input
                    value={draft.transportation_cost}
                    type="number"
                    inputMode="decimal"
                    placeholder={String(defaultTransportCost)}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        transportation_cost: e.target.value,
                      }))
                    }
                    onBlur={() => {
                      const raw = draft.transportation_cost.trim();
                      // Empty input → write null so the column
                      // distinguishes "admin cleared it" from
                      // "admin set it to 0." `null` propagates
                      // through the family-payment transport
                      // total as "no transport for this student."
                      if (raw === "") {
                        if (
                          persistedTransportCost == null
                        )
                          return;
                        patchField("transportation_cost", {
                          transportation_cost: null,
                        });
                        return;
                      }
                      const next = Number(raw);
                      if (!Number.isFinite(next)) return;
                      if (next === persistedTransportCost) return;
                      patchField("transportation_cost", {
                        transportation_cost: next,
                      });
                    }}
                    className="border-input pl-7 tabular-nums"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Bus stop: {app?.bus_stop || "—"}
                </p>
              </Field>
            </div>
          ) : null}

          {!approveCtx.isSNAPPath ? (
            <div className="rounded-md border bg-white p-4 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Opportunity Scholarship
              </h4>
              <Field>
                {/* Label reads as "what the family will pay per
                    student" — that's the value admin types here, not
                    a scholarship award amount. The underlying column
                    is still `opportunity_scholarship_award_amount` for
                    backwards compatibility, but the field's
                    user-facing meaning is the per-student family
                    cost. Allows $0 (admin explicitly set zero). */}
                <FieldLabel className="text-xs">
                  Cost per student
                </FieldLabel>
                {/* Currency input — leading "$" sigil on the left
                    matches every other money input on the page so
                    admins see this field as a dollar value at a
                    glance. */}
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                    $
                  </span>
                  <Input
                    value={draft.opportunity_scholarship_award_amount}
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        opportunity_scholarship_award_amount: e.target.value,
                      }))
                    }
                    onBlur={() => {
                      const next = Number(
                        draft.opportunity_scholarship_award_amount
                      );
                      const safe = Number.isFinite(next) ? next : 0;
                      // Compare against the raw persisted value, NOT
                      // against `?? 0` — `null` / `undefined` (column
                      // never set) must be treated as DIFFERENT from
                      // `0` (admin explicitly set zero), otherwise
                      // typing "0" on a fresh row silently no-ops and
                      // the confirm button never gets a value to save.
                      // Strict-equality keeps `null !== 0` and
                      // `undefined !== 0`, which is what we want.
                      const persisted =
                        app.opportunity_scholarship_award_amount;
                      if (safe === persisted) return;
                      patchField("opportunity_scholarship_award_amount", {
                        opportunity_scholarship_award_amount: safe,
                      });
                    }}
                    className="border-input pl-7 tabular-nums"
                  />
                </div>
              </Field>
            </div>
          ) : null}

          {/* ─── Confirm Scholarship Award Amount ─── Per-student
              terminal action — flips `confirmed_scholarship` for
              THIS student. Reject / Approve / Archive are
              family-level decisions and live in the Acceptance
              card's footer (one set, after every student row), so
              they're not duplicated per-row.

              Three visual states:
                - default → blue primary button, clickable when the
                  Documents to Review gate is satisfied
                - saving (mid-PATCH) → spinner + "Submitting…"
                - confirmed → muted "Submitted" pill + outline
                  "Undo" button next to it. The pill is non-
                  interactive; the Undo button opens a confirm
                  dialog that flips `confirmed_scholarship` back to
                  false so admin can re-edit the award amount and
                  re-confirm.

              Once the family is accepted, this row hides — the
              Decision card grays out as a unit. */}
          {!approveCtx.accepted ? (
            sufsConfirmed ? (
              // Confirmed footer mirrors the family-level
              // `SectionConfirmFooter` chrome on the parent-facing
              // section cards (Family / Students / Financial Aid /
              // Testing / Scholarship): audit caption on the left,
              // muted "Submitted" pill + "Undo" button on the
              // right. Same visual vocabulary so admin reads
              // per-student and per-section confirmations the
              // same way at a glance.
              <div className="flex items-center justify-between gap-3 pt-1">
                {/* Audit caption — Confirmed by {admin} · {when}.
                    Stamped server-side on the
                    `confirmed_scholarship_time` + `_admin` columns
                    whenever the bool flips, so the caption can't
                    drift away from the row's actual state. Hover
                    surfaces the full timestamp. */}
                <span className="text-xs text-muted-foreground truncate">
                  {(() => {
                    const name =
                      app?.confirmed_scholarship_admin?.trim();
                    const at = app?.confirmed_scholarship_time;
                    if (!name && !at) return "Confirmed";
                    return (
                      <span
                        title={
                          at
                            ? new Date(at).toLocaleString()
                            : undefined
                        }
                      >
                        {name ? (
                          <>
                            Confirmed by{" "}
                            <span className="font-medium text-foreground">
                              {name}
                            </span>
                          </>
                        ) : (
                          "Confirmed"
                        )}
                        {at ? (
                          <span> · {formatNoteTimestamp(at)}</span>
                        ) : null}
                      </span>
                    );
                  })()}
                </span>
                {/* Submitted pill + Undo pair, right-aligned. The
                    pill is non-interactive (a labeled disabled
                    button keeps it pixel-aligned with the Undo
                    next to it); Undo opens the same toggle dialog
                    the Confirm path uses — `runToggleConfirmed`
                    flips the bool either direction based on the
                    current state. */}
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled
                    className="bg-muted text-muted-foreground cursor-default disabled:opacity-100"
                  >
                    <CheckCircle2 className="size-3.5 mr-1.5" />
                    Scholarship Submitted
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={toggleConfirmed}
                    // Section-verify gate: per-student Undo locks
                    // once admin has signed off on the Scholarship
                    // section as a whole. Keeps the umbrella
                    // verify intact — admin has to roll the
                    // section back first, then peel off the
                    // student. Hover-tooltip explains the gate so
                    // the greyed-out button isn't a mystery.
                    disabled={
                      confirming ||
                      approveCtx.scholarshipSectionVerified
                    }
                    className="bg-white"
                    title={
                      approveCtx.scholarshipSectionVerified
                        ? "Undo the Scholarship section verification first"
                        : "Undo this student's scholarship award submission"
                    }
                  >
                    {confirming ? (
                      <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Undo2 className="size-3.5 mr-1.5" />
                    )}
                    Undo
                  </Button>
                </div>
              </div>
            ) : (
              // Pre-confirm action — right-justified so it hugs its
              // text rather than stretching across the row. The
              // confirmed state above also lives in a right-aligned
              // cluster, so this keeps the resolved-vs-pending
              // layouts on the same axis. Personalized label
              // ("Confirm Maxual's Scholarship Amount") makes the
              // student-specific intent obvious — important when
              // the family has multiple kids and admin is working
              // through them one at a time.
              <div className="flex items-center justify-end">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  disabled={confirming}
                  onClick={toggleConfirmed}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                  title={`Confirm ${student.first_name}'s scholarship award amount`}
                >
                  {confirming ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="size-3.5 animate-spin" />
                      <span className="text-sm font-semibold">
                        Submitting…
                      </span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <Check className="size-3.5" />
                      <span>
                        Confirm {student.first_name}{" "}
                        {student.last_name} Scholarship Amount
                      </span>
                    </span>
                  )}
                </Button>
              </div>
            )
          ) : null}
        </div>
      ) : null}

      <AlertDialog
        open={confirmDialogOpen}
        onOpenChange={(open) => {
          if (!confirming) setConfirmDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {sufsConfirmed
                ? `Clear scholarship award confirmation for ${student.first_name}?`
                : `Confirm scholarship award for ${student.first_name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {sufsConfirmed ? (
                <>
                  The Approve button at the top of the page will lock
                  again until you re-confirm{" "}
                  {student.first_name} {student.last_name}&rsquo;s
                  scholarship award.
                </>
              ) : (
                <>
                  Make sure the SUFS tier and Opportunity Scholarship
                  amount above are correct for {student.first_name}{" "}
                  {student.last_name}. Approving the family is gated
                  until every student&rsquo;s scholarship award is
                  confirmed, so this is one of the last steps before
                  approval.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirming}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={confirming}
              className={cn(
                sufsConfirmed
                  ? "bg-amber-600 hover:bg-amber-700 text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              )}
              onClick={(e) => {
                e.preventDefault();
                void runToggleConfirmed();
              }}
            >
              {confirming ? (
                <Loader2 className="size-4 mr-1.5 animate-spin" />
              ) : null}
              {sufsConfirmed ? "Yes, clear it" : "Yes, confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Page-header actions for the family-year decision: a "Return
 * Application" affordance (admin-side unsubmit) and an "Approve" /
 * "Revoke acceptance" toggle. Both open a confirm modal first
 * because both fire downstream notifications and a misclick is
 * costly.
 *
 * Approve is gated on every active student's SUFS confirmation.
 * If a student has a SUFS tier selected, `sufs_confirmed` must be
 * true on their application row before the family can be approved.
 * Students without a SUFS tier (set to "Not on a SUFS scholarship")
 * don't need confirmation. The button stays disabled with a tooltip
 * until the gate clears.
 *
 * Patches `isAccepted` on the per-year
 * `registration_family_application_progress` row (the bridge keyed
 * by `(registration_families_id, registration_school_years_id)`).
 * Per-student `isAccepted` flags on application rows aren't touched.
 *
 * Return Application patches `isSubmitted=false` + clears
 * `submitted_at` on the same progress row, so the parent drops back
 * into the editable apply flow.
 */
function FamilyDecisionActions({
  familyId,
  yearId,
  familyName,
  progress,
  apps,
  onChanged,
}: {
  familyId: number;
  yearId: number;
  familyName: string;
  progress: { isAccepted?: boolean; isSubmitted?: boolean } | null;
  apps: XanoApplication[];
  onChanged: () => void;
}) {
  const accepted = progress?.isAccepted === true;

  const [saving, setSaving] = useState(false);
  // The header keeps Revoke acceptance only — Approve and Reject
  // both moved into each `<DecisionStudentRow>` so admin can act
  // from the row they're reviewing rather than scrolling back up.
  // Revoke makes sense here because by the time it's relevant the
  // Decision card is grayed out (accepted state), and admin would
  // otherwise have to scroll past a disabled card to find it.
  const [pending, setPending] = useState<null | "revoke">(null);

  async function patchProgress(body: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/family-progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId, yearId, ...body }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Update failed (${res.status})`);
      }
      onChanged();
    } catch (err) {
      console.error("[FamilyDecisionActions.patchProgress] failed:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't update.");
    } finally {
      setSaving(false);
      setPending(null);
    }
  }

  // `pending`, `patchProgress`, and `saving` used to back the page-
  // header Revoke button — now consolidated into the Acceptance
  // card's footer (`RevokeAcceptanceButton`). Left in place so any
  // future page-header decision affordances can reuse them without
  // rewiring; reference them here so the unused-var lint stays
  // quiet.
  void pending;
  void patchProgress;
  void saving;
  void accepted;

  // Page header no longer renders Revoke (moved into the Acceptance
  // card footer); apps prop is also now redundant here but kept on
  // the signature so the parent's call site doesn't need to change.
  void apps;

  return null;
}

/**
 * Export PDF button — generates a multi-page acceptance summary PDF
 * via `exportFamilyPDF` and triggers a real download (not a print
 * dialog). The generator lives in `lib/family-pdf.ts` and is
 * imported dynamically inside the click handler so the jsPDF +
 * autotable bundles only load when admin actually clicks Export —
 * keeps the main admin chunk lean.
 */
function ExportPdfButton({
  familyId,
  yearId,
}: {
  familyId: number;
  yearId: number;
}) {
  const [exporting, setExporting] = useState(false);
  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      // Dynamic import — `lib/family-pdf.ts` pulls in `jspdf` +
      // `jspdf-autotable` (~150KB combined), so we only load it
      // on first click. Subsequent clicks resolve from the
      // module cache.
      const { exportFamilyPDF } = await import("@/lib/family-pdf");
      await exportFamilyPDF({ familyId, yearId });
    } catch (err) {
      console.error("[ExportPdfButton] export failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't generate PDF."
      );
    } finally {
      setExporting(false);
    }
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={exporting}
      className="bg-white"
      title="Download a multi-page PDF summary of this family's acceptance"
    >
      {exporting ? (
        <Loader2 className="size-3.5 mr-1.5 animate-spin" />
      ) : (
        <FileText className="size-3.5 mr-1.5" />
      )}
      {exporting ? "Generating…" : "Export PDF"}
    </Button>
  );
}

/**
 * Standalone Revoke acceptance button + confirmation modal. Used by
 * the Acceptance card's footer when the family is in the accepted
 * state. Mirrors the patch flow `FamilyDecisionActions` used to
 * own; extracted so multiple surfaces can render the affordance
 * without duplicating the modal copy.
 */
function RevokeAcceptanceButton({
  familyId,
  yearId,
  familyName,
  onRevoked,
}: {
  familyId: number;
  yearId: number;
  familyName: string;
  onRevoked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function runRevoke() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/family-progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId, yearId, isAccepted: false }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Update failed (${res.status})`);
      }
      toast.success(`Acceptance revoked for ${familyName || "family"}.`);
      setOpen(false);
      onRevoked();
    } catch (err) {
      console.error("[RevokeAcceptanceButton.runRevoke] failed:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't revoke.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={saving}
        onClick={() => setOpen(true)}
        className="bg-white"
      >
        <XCircle className="size-4 mr-1.5" />
        Revoke acceptance
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !saving) setOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revoke acceptance for {familyName || "family"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The family loses access to tuition, enrollment, and
              registration until you approve them again. Their
              application data stays intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={(e) => {
                e.preventDefault();
                void runRevoke();
              }}
            >
              {saving ? (
                <Loader2 className="size-4 mr-1.5 animate-spin" />
              ) : null}
              Yes, revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ─────────────────────── Scholarship path selector ─────────────────────── */

/**
 * Admin-side picker for the family's scholarship lifecycle path —
 * Opportunity Scholarship (the full application), SNAP benefits
 * (pre-qualification), or Opted out. Mostly used when admin is
 * transcribing a paper application or correcting a path mid-cycle.
 * The PATCH route cascades the mutually-exclusive flags so the
 * scholarship row can't carry conflicting signals.
 *
 * Renders as a row of three pill buttons. The active path is
 * highlighted; clicking another path triggers an inline PATCH
 * (no confirmation modal — admin can flip back immediately if
 * they pick wrong, and the cascade means there's no data-loss
 * risk).
 */
function ScholarshipPathSelector({
  scholarship,
  onChanged,
}: {
  scholarship: XanoScholarship;
  onChanged?: () => void;
}) {
  const [savingPath, setSavingPath] = useState<
    "isOpportunityScholarship" | "isSNAPBenefits" | "isNotParticipating" | null
  >(null);
  const active: "opp" | "snap" | "out" | null = scholarship.isOpportunityScholarship
    ? "opp"
    : scholarship.isSNAPBenefits
      ? "snap"
      : scholarship.isNotParticipating
        ? "out"
        : null;

  async function setPath(
    flag: "isOpportunityScholarship" | "isSNAPBenefits" | "isNotParticipating",
    label: string
  ) {
    setSavingPath(flag);
    try {
      const res = await fetch(`/api/admin/scholarships/${scholarship.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [flag]: true }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${res.status})`);
      }
      toast.success(`Path set to ${label}.`);
      onChanged?.();
    } catch (err) {
      console.error("[ScholarshipPathSelector.setPath]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't update.");
    } finally {
      setSavingPath(null);
    }
  }

  type Option = {
    key: "opp" | "snap" | "out";
    flag: "isOpportunityScholarship" | "isSNAPBenefits" | "isNotParticipating";
    label: string;
  };
  const options: Option[] = [
    {
      key: "opp",
      flag: "isOpportunityScholarship",
      label: "Opportunity Scholarship",
    },
    {
      key: "snap",
      flag: "isSNAPBenefits",
      label: "SNAP benefits",
    },
    {
      key: "out",
      flag: "isNotParticipating",
      label: "Opted out",
    },
  ];

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Scholarship Path
      </p>
      {/* Three-pill picker — single-line label per option (no
          sub-description), outline-only active state (heavier
          border, no tinted background). Selected option swaps
          its empty circle for a filled circle so the choice is
          clear at a glance without painting the button green. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {options.map((opt) => {
          const isActive = active === opt.key;
          const isSaving = savingPath === opt.flag;
          return (
            <button
              key={opt.key}
              type="button"
              disabled={isSaving || savingPath !== null}
              onClick={() => {
                if (isActive) return;
                void setPath(opt.flag, opt.label);
              }}
              className={cn(
                "flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
                isActive
                  ? "border-foreground border-2 hover:bg-white"
                  : "border-border hover:bg-muted/40"
              )}
            >
              {isSaving ? (
                <Loader2 className="size-3.5 animate-spin shrink-0 text-muted-foreground" />
              ) : isActive ? (
                // Filled circle — Radix's Circle gets a fill to
                // signal selection without leaning on the heavier
                // green-bg active state.
                <Circle className="size-3.5 shrink-0 fill-foreground text-foreground" />
              ) : (
                <Circle className="size-3.5 shrink-0 text-muted-foreground/40" />
              )}
              <span className="font-medium text-foreground">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
