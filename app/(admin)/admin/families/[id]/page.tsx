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
  HelpCircle,
  Loader2,
  Pencil,
  SquarePen,
  Trash2,
  Undo2,
  Users,
  XCircle,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
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

  // Tax return — required on the Opportunity Scholarship path
  // (every path except SNAP-only and Opted-out renders this doc
  // slot). Gate only when a return has been uploaded — same
  // "don't gate on empty docs" treatment so admin isn't blocked
  // from verifying when the parent simply hasn't uploaded yet.
  // Opted-out families don't go through the Financial Aid verify
  // flow at all, so we skip the gate there.
  if (!scholarship.isSNAPBenefits && !scholarship.isNotParticipating) {
    const taxReturnFiles = Array.isArray(scholarship.tax_return)
      ? scholarship.tax_return.length
      : 0;
    if (
      taxReturnFiles > 0 &&
      scholarship.tax_document_confirm !== true
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
  // Page-level acceptance latch. When a family is accepted, every
  // section's Undo affordance freezes — admin has to revoke the
  // acceptance from the Acceptance card below before they can step
  // back into any section to amend it. Keeps the lifecycle linear
  // ("accept = decision is final unless explicitly reversed") so
  // admin can't accidentally rewind a section's verify while the
  // Acceptance card still claims the family is fully approved.
  const pageAccepted = progress?.isAccepted === true;
  const unverifyLockedConfig = pageAccepted
    ? {
        unverifyLocked: true as const,
        unverifyLockedReason:
          "Revoke acceptance below before undoing.",
      }
    : {};

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

  // (The per-section editor route `/admin/families/[id]/[section]`
  // is no longer used — admin edits live inline on each SectionShell
  // body. The route still exists for legacy bookmarks but no nav
  // affordance points there.)

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
              Archive on the far left so admin reaches for it
              intentionally (not as muscle memory), Decision actions
              in the middle (the daily work), Export PDF just left
              of Notes (frequent enough to be page-level but not the
              primary action), Notes on the far right as the
              most-clicked utility. All four only render when a year
              is selected — they're year-scoped. */}
          <div className="flex items-center gap-2 shrink-0">
            {yearId ? (
              <ArchiveApplicationButton
                familyId={Number(familyId)}
                yearId={Number(yearId)}
                familyName={family.family_name}
                size="sm"
                onArchived={() => {
                  refreshDetail();
                  refreshProgress();
                }}
              />
            ) : null}
            {/* Cross-surface jump to the family overview page —
                cross-year summary + matching inquiries / applications
                / registrations / sent emails. Year-scoped link so
                the overview's email log filters to this year. Lives
                next to Delete since both are family-scoped
                navigation/lifecycle actions; Decision / Export PDF /
                Notes that follow are the year-scoped action set. */}
            {yearId ? (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="bg-white"
              >
                <Link
                  href={`/admin/families/${Number(familyId)}/overview?yearId=${Number(yearId)}`}
                >
                  <Users className="size-3.5 mr-1.5" />
                  Family overview
                </Link>
              </Button>
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
              ...unverifyLockedConfig,
            }}
          >
            {parents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No parents on file.
              </p>
            ) : (
              <div className="space-y-4">
                {parents.map((parent) => (
                  <ParentBlock
                    key={parent.id}
                    parent={parent}
                    onChanged={() => {
                      refreshFamily();
                      refreshDetail();
                    }}
                  />
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
              ...unverifyLockedConfig,
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
                      yearId={yearId ? Number(yearId) : undefined}
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
                ...unverifyLockedConfig,
              }}
            >
              {detailLoading && !detail ? (
                <Skeleton className="h-48 w-full rounded-md" />
              ) : scholarship ? (
                <ScholarshipBlock
                  scholarship={scholarship}
                  familyId={family.id}
                  onScholarshipChanged={refreshDetail}
                  // Lock the path selector once admin has verified
                  // the Financial Aid section — switching paths
                  // mid-verify would invalidate the determination
                  // the verify is anchored on. Admin Undoes the
                  // verification on the section footer to unlock.
                  pathLocked={
                    progress?.financial_aid_admin_confirm === true
                  }
                />
              ) : (
                // No scholarship row yet — admin can still choose
                // the family's path on their behalf (paper
                // applications, mid-cycle corrections, etc.).
                // Clicking a path POSTs a fresh row scoped to
                // this (family, year). After creation the section
                // re-renders with the full Financial Aid form
                // below, ready for admin to fill in financial
                // detail.
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    The parent hasn&rsquo;t opened the Financial Aid
                    section yet. Pick the family&rsquo;s path below
                    to start the application on their behalf.
                  </p>
                  <ScholarshipPathSelector
                    scholarship={null}
                    familyId={family.id}
                    yearId={Number(yearId)}
                    onChanged={refreshDetail}
                    disabled={
                      progress?.financial_aid_admin_confirm === true
                    }
                    disabledReason={
                      progress?.financial_aid_admin_confirm === true
                        ? "Undo the Financial Aid verification below to switch paths."
                        : undefined
                    }
                  />
                </div>
              )}
            </SectionShell>
          </section>
        ) : null}

        {/* Testing */}
        {yearId ? (
          <section id="section-testing" className="scroll-mt-20">
            <SectionShell
              title="Initial Testing (NWEA)"
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
                ...unverifyLockedConfig,
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
  // Mute kicks in only when admin has *verified* the section. The
  // parent marking it complete (`*_completed`) on its own isn't
  // enough — that's still pending review on our side, and a
  // premature gray-out reads as "this is settled" before admin has
  // actually looked.
  //
  // Opacity is scoped to the *body* (the view-only field grid), not
  // the whole `<Card>`. The header (Notes / Edit / status pill) and
  // footer (Verified pill + Undo button) stay at full opacity so the
  // verified-state controls are still clearly readable and clickable
  // — fading the entire card made the Undo button look half-disabled
  // and the verified pill hard to find. `parentCompleted` is still
  // surfaced via the status dot (yellow → in progress, green → done)
  // so admin can scan progress without relying on the mute alone.
  const fullyDone = confirmed;
  // Silence the unused-var warning — `parentCompleted` used to
  // drive `fullyDone` and is kept on the props for future surfaces
  // that may want to reintroduce the parent-completion mute.
  void parentCompleted;
  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
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
              header. Once the section is verified, both are
              disabled — admin can't add notes or jump into an editor
              on a settled section without first hitting Undo on the
              footer to re-open it. This keeps the audit trail honest
              ("the verified state is the source of truth, edits flow
              through the unverify path") and prevents accidental
              clicks from muddying a confirmed surface. */}
          <div className="flex items-center gap-2 shrink-0">
            {notes ? (
              <FamilyNotesSheet
                familyId={notes.familyId}
                section={notes.section}
                title={notes.title}
                phase="application"
                disabled={fullyDone}
              />
            ) : null}
            {editHref ? (
              fullyDone ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="bg-white"
                  disabled
                >
                  <Pencil className="size-4 mr-1" />
                  Edit
                </Button>
              ) : (
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
              )
            ) : null}
          </div>
        </div>
      </CardHeader>
      {/* Body fades to muted when verified so the field grid reads
          as settled, while the header (badge + buttons) and footer
          (Verified pill + Undo) stay at full opacity for visibility
          and click affordance. */}
      <CardContent
        className={cn(
          "space-y-6 py-5 bg-white transition-opacity",
          fullyDone && "opacity-60"
        )}
      >
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
  /** When true, the Undo affordance on the verified-state footer is
   *  disabled — admin can't unverify the section until they revoke
   *  the family's acceptance first. Wired to the page-level
   *  `accepted` flag on every section so the acceptance latch is
   *  the single gate admin has to clear before they can undo any
   *  section's verification. The reason renders as a small caption
   *  next to the verified pill so admin sees what's blocking the
   *  undo without hovering. */
  unverifyLocked?: boolean;
  unverifyLockedReason?: string;
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
    unverifyLocked,
    unverifyLockedReason,
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
              {/* Unverify lock caption — appended to the audit line
                  when admin can't currently Undo (typically because
                  the family is accepted and acceptance must be
                  revoked first). The reason rides on the disabled
                  Undo button's tooltip too, but the inline caption
                  surfaces it without requiring a hover so admin
                  immediately sees what's blocking the action. */}
              {unverifyLocked && unverifyLockedReason ? (
                <span> · {unverifyLockedReason}</span>
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
            disabled={saving || !!unverifyLocked}
            title={
              unverifyLocked && unverifyLockedReason
                ? unverifyLockedReason
                : undefined
            }
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

function ParentBlock({
  parent,
  onChanged,
}: {
  parent: Parent;
  /** Called after a successful save so the parent page can
   *  refetch the family payload and re-render the now-persisted
   *  values into the read mode. */
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    first_name: parent.first_name ?? "",
    last_name: parent.last_name ?? "",
    email: parent.email ?? "",
    phone: parent.phone ?? "",
    relationship: parent.relationship ?? "",
    address_line_1: parent.address_line_1 ?? "",
    address_line_2: parent.address_line_2 ?? "",
    city: parent.city ?? "",
    state: parent.state ?? "",
    zipcode: parent.zipcode ?? "",
  });

  function enterEdit() {
    setDraft({
      first_name: parent.first_name ?? "",
      last_name: parent.last_name ?? "",
      email: parent.email ?? "",
      phone: parent.phone ?? "",
      relationship: parent.relationship ?? "",
      address_line_1: parent.address_line_1 ?? "",
      address_line_2: parent.address_line_2 ?? "",
      city: parent.city ?? "",
      state: parent.state ?? "",
      zipcode: parent.zipcode ?? "",
    });
    setEditing(true);
  }

  async function runSave() {
    // Diff against the persisted values so we only send fields
    // admin actually changed. Trim text fields to match the
    // parent-side form's behavior.
    const patch: Record<string, string> = {};
    for (const k of [
      "first_name",
      "last_name",
      "email",
      "phone",
      "relationship",
      "address_line_1",
      "address_line_2",
      "city",
      "state",
      "zipcode",
    ] as const) {
      const next = draft[k]?.trim() ?? "";
      const prev = parent[k] ?? "";
      if (next !== prev) patch[k] = next;
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/parents/${parent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${res.status})`);
      }
      toast.success("Parent saved.");
      setEditing(false);
      onChanged();
    } catch (err) {
      console.error("[ParentBlock.runSave]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  const displayName =
    parent.first_name || parent.last_name
      ? `${parent.first_name} ${parent.last_name}`.trim()
      : `Parent #${parent.id}`;

  return (
    <div className="rounded-md border bg-muted/10 p-4 space-y-5">
      {/* Sub-header — parent name on the left, Edit/Save/Cancel on
          the right. Matches the StudentApplicationBlock pattern
          so admin uses the same affordance shape across the page. */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold truncate">{displayName}</p>
        <div className="flex items-center gap-2 shrink-0">
          {editing ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditing(false)}
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
      {/* `required` flag mirrors what the parent-side family form
          validates as required — name, all contact fields, and a
          street + city + state + zip. Apt/Suite is optional. */}
      <SectionGroup title="Name">
        <div className="grid gap-4 grid-cols-2">
          {editing ? (
            <>
              <Field>
                <FieldLabel className="text-xs">First name</FieldLabel>
                <Input
                  value={draft.first_name}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, first_name: e.target.value }))
                  }
                  disabled={saving}
                />
              </Field>
              <Field>
                <FieldLabel className="text-xs">Last name</FieldLabel>
                <Input
                  value={draft.last_name}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, last_name: e.target.value }))
                  }
                  disabled={saving}
                />
              </Field>
            </>
          ) : (
            <>
              <DisabledField label="First name" value={parent.first_name} required />
              <DisabledField label="Last name" value={parent.last_name} required />
            </>
          )}
        </div>
      </SectionGroup>
      <SectionGroup title="Contact">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
          {editing ? (
            <>
              <Field>
                <FieldLabel className="text-xs">Email</FieldLabel>
                <Input
                  type="email"
                  value={draft.email}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, email: e.target.value }))
                  }
                  disabled={saving}
                />
              </Field>
              <Field>
                <FieldLabel className="text-xs">Phone</FieldLabel>
                <PhoneInput
                  value={draft.phone}
                  onChange={(d) => setDraft((dd) => ({ ...dd, phone: d }))}
                />
              </Field>
              <Field>
                <FieldLabel className="text-xs">Relationship</FieldLabel>
                <Input
                  value={draft.relationship}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, relationship: e.target.value }))
                  }
                  disabled={saving}
                />
              </Field>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </SectionGroup>
      <SectionGroup title="Address">
        <div className="grid gap-4 grid-cols-1">
          {editing ? (
            <>
              <Field>
                <FieldLabel className="text-xs">Street address</FieldLabel>
                <Input
                  value={draft.address_line_1}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, address_line_1: e.target.value }))
                  }
                  disabled={saving}
                />
              </Field>
              <Field>
                <FieldLabel className="text-xs">Apt / suite</FieldLabel>
                <Input
                  value={draft.address_line_2}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, address_line_2: e.target.value }))
                  }
                  disabled={saving}
                />
              </Field>
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
                <Field>
                  <FieldLabel className="text-xs">City</FieldLabel>
                  <Input
                    value={draft.city}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, city: e.target.value }))
                    }
                    disabled={saving}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">State</FieldLabel>
                  <Input
                    value={draft.state}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, state: e.target.value }))
                    }
                    disabled={saving}
                    maxLength={2}
                  />
                </Field>
                <Field>
                  <FieldLabel className="text-xs">Zip</FieldLabel>
                  <Input
                    value={draft.zipcode}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, zipcode: e.target.value }))
                    }
                    disabled={saving}
                  />
                </Field>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
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
  yearId,
  onChanged,
}: {
  student: Student;
  app: XanoApplication | undefined;
  /** Current per-year scope. Drives the "Open enrolled view" deep-link
   *  in the sub-header so admin can pivot from family-level review
   *  to the per-student enrolled detail page without losing the
   *  year context. Optional because the family page renders this
   *  block in family-overview mode (no year selected), where the
   *  enrolled link doesn't make sense and gets omitted. */
  yearId?: number;
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
              <>
                {/* Deep-link to the per-student enrolled detail page
                    for this year. Lets admin pivot from family-level
                    review into the focused student view without
                    losing the year context. Only renders when a
                    year is selected — without one the link is
                    meaningless. */}
                {yearId ? (
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="bg-white"
                  >
                    <Link href={`/admin/enrolled/${student.id}?yearId=${yearId}`}>
                      <ExternalLink className="size-3.5 mr-1.5" />
                      Open
                    </Link>
                  </Button>
                ) : null}
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
              </>
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

  /**
   * Patches a field on the per-year application row. Used for the
   * NWEA scheduling flags (`nwea_testing_scheduled` /
   * `nwea_testing_complete`) which live on the app row rather than
   * the student row — those are year-scoped (a student can have
   * tested for one year but not another). Mirrors `patchField`
   * above structurally; separate route + table, same UX.
   */
  async function patchAppField(
    field: "nwea_testing_scheduled" | "nwea_testing_complete",
    value: boolean,
    appId: number
  ) {
    setSavingField(field);
    try {
      const res = await fetch(`/api/admin/applications/${appId}`, {
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
      console.error(`[TestingBlock.patchAppField.${field}]`, err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
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
          {/* Scheduling state — admin can flip these on behalf of
              the family. Parent flow also writes these on its
              NWEA page, but admin needs the override here since
              the testing is sometimes scheduled / completed by
              school staff before the parent sees the page. Saves
              on Select change with no extra button. */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <Field>
              <FieldLabel className="text-xs">NWEA scheduled</FieldLabel>
              <Select
                value={app.nwea_testing_scheduled ? "Yes" : "No"}
                onValueChange={(v) =>
                  patchAppField("nwea_testing_scheduled", v === "Yes", app.id)
                }
                disabled={savingField === "nwea_testing_scheduled"}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel className="text-xs">NWEA complete</FieldLabel>
              <Select
                value={app.nwea_testing_complete ? "Yes" : "No"}
                onValueChange={(v) =>
                  patchAppField("nwea_testing_complete", v === "Yes", app.id)
                }
                disabled={savingField === "nwea_testing_complete"}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                </SelectContent>
              </Select>
            </Field>
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
  pathLocked,
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
  /** When true, the path selector is locked — admin has verified
   *  the Financial Aid section, so switching paths is gated behind
   *  Undoing the verification first. */
  pathLocked?: boolean;
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
        disabled={pathLocked}
        disabledReason={
          pathLocked
            ? "Undo the Financial Aid verification below to switch paths."
            : undefined
        }
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
  // Registration-confirmed lookup — lives on a separate Xano table
  // (`registration_student_registration_progress`) so we have to
  // fetch it independently. The Acceptance card's Revoke
  // affordance is gated on this: once admin has confirmed the
  // family's registration downstream, revoking the upstream
  // acceptance would orphan a confirmed registration on a
  // no-longer-accepted family. Admin has to undo the registration
  // confirmation first.
  const { data: regProgress, mutate: refreshRegProgress } = useSWR<{
    isRegistrationConfirmed?: boolean;
  } | null>(
    familyId && yearId
      ? `/api/admin/registration-progress?familyId=${familyId}&yearId=${yearId}`
      : null,
    adminFetcher
  );
  const registrationConfirmed =
    regProgress?.isRegistrationConfirmed === true;
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
        with the supporting per-student awards + financial review.
        Renders even when `students` is empty so admin retains
        access to Archive / Revoke in the footer — without this,
        families whose `registration_application` rows are missing
        get stranded with no lifecycle actions on the page. */}
    {!loading ? (
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
              approving or revoking. Empty fallback covers families
              with no active applications for the year (e.g. data
              loss, or pre-application stragglers) — keeps the
              footer actions reachable. */}
          {students.length > 0 ? (
            <TuitionBreakdownTable
              students={students}
              apps={apps}
              schoolYear={schoolYear}
              isOpportunityScholarshipFamily={
                scholarship?.isOpportunityScholarship === true
              }
              isSnapFamily={scholarship?.isSNAPBenefits === true}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No students on file for this year.
            </p>
          )}
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
              {/* Archive lives in the page header — same slot on
                  both apply-flow and registration pages — so the
                  pre-accept footer focuses on the decision pair:
                  Return Application (send back for edits) + Approve.
                  Return stays mounted at all times — disabled when
                  the family hasn't submitted yet — so the action
                  surface is stable across states and admin sees the
                  full lifecycle vocabulary regardless of where the
                  family is in the flow. */}
              <div className="grid gap-2 grid-cols-2">
                <RejectApplicationButton
                  familyId={familyId}
                  yearId={yearId}
                  familyName={familyName}
                  onRejected={onChanged}
                  disabled={!familySubmitted}
                  disabledReason={
                    !familySubmitted
                      ? "Family hasn't submitted yet — nothing to return."
                      : undefined
                  }
                />
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
            // Post-accept footer — 3-cell grid: Revoke (destructive
            // escape, left), Undo registration confirmation
            // (prerequisite for Revoke when registration is
            // confirmed, middle), View registration (forward-motion
            // link to keep working on enrollment paperwork, right).
            // Both Revoke and Undo stay mounted at all times; their
            // disable state is driven by `registrationConfirmed` so
            // admin always sees the full action set and the gate
            // reads from the disabled tooltip rather than a missing
            // button. Equal-width cells make the row read as a
            // single decision surface.
            <div className="grid gap-2 grid-cols-3">
              <RevokeAcceptanceButton
                familyId={familyId}
                yearId={yearId}
                familyName={familyName}
                disabled={registrationConfirmed}
                disabledReason={
                  registrationConfirmed
                    ? "Undo registration confirmation first."
                    : undefined
                }
                onRevoked={onChanged}
              />
              <UndoRegistrationConfirmationButton
                familyId={familyId}
                yearId={yearId}
                familyName={familyName}
                registrationConfirmed={registrationConfirmed}
                onUndone={() => {
                  // `onChanged` only refreshes the apply-side detail +
                  // progress SWR caches; the Undo PATCH flips
                  // `isRegistrationConfirmed` on the registration-side
                  // progress row, which is fetched by a separate
                  // hook (`refreshRegProgress`). Without this the
                  // adjacent Revoke acceptance button stays disabled
                  // until the page reloads.
                  refreshRegProgress();
                  onChanged();
                }}
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
      className="overflow-hidden gap-0 py-0 bg-white scroll-mt-20"
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
      {/* Body fades to muted when admin has VERIFIED the
          Scholarship section (the section's own
          `scholarship_admin_complete` flag), not the page-level
          `accepted` latch. The two used to be entangled: the card
          dimmed on accept, so undoing the section's verify still
          left the body grayed out because the Acceptance card
          hadn't been revoked. Tying opacity to the section's own
          verify state means Undo on this footer restores the body
          to full opacity immediately, matching how every
          SectionShell elsewhere behaves. Header + footer stay at
          full opacity regardless. */}
      <CardContent
        className={cn(
          "space-y-6 py-5 bg-white transition-opacity",
          progress?.scholarship_admin_complete === true && "opacity-60"
        )}
      >
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
            // Acceptance is the final downstream signal of this
            // section — once the family is accepted, the
            // Scholarship Determination shouldn't be unwound
            // without first revoking the acceptance. Mirrors the
            // gate the page-level SectionShells use above.
            unverifyLocked: accepted,
            unverifyLockedReason: accepted
              ? "Revoke acceptance above before undoing."
              : undefined,
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
 *   familyPaysForTuition = remaining_opportunity_amount ?? 0
 *   scholarshipCoverage  = tuition − SUFS − familyPaysForTuition
 *   subtotal             = familyPaysForTuition + adminFee
 *
 * Transportation is no longer a separate line item — it's been
 * rolled into the annual tuition figure, so the SNAP-vs-non-SNAP
 * branching that used to handle the extra transport line is gone
 * too. SNAP families still get full OS coverage; their
 * `remaining_opportunity_amount` is just 0, so the subtotal
 * collapses to the annual admin fee on its own.
 *
 * `isOpportunityScholarshipFamily` gates a dedicated "Opportunity
 * Scholarship (Cost Per Student)" line that surfaces what the
 * family is paying for tuition under the OS determination — same
 * value that's baked into subtotal, broken out as its own row so
 * admin sees the per-student tuition cost before the totals.
 * `isSnapFamily` also renders that line (with a SNAP-specific
 * tooltip and a $0 value) so SNAP-qualified families see they
 * don't owe tuition under the Opportunity Scholarship.
 *
 * Active-only: students whose application row has `isActive=false`
 * (soft-deleted from the year) are filtered out so the receipt
 * matches the cohort the family will actually pay for.
 */
function TuitionBreakdownTable({
  students,
  apps,
  schoolYear,
  isOpportunityScholarshipFamily,
  isSnapFamily,
}: {
  students: Student[];
  apps: XanoApplication[];
  schoolYear: XanoSchoolYear | null;
  isOpportunityScholarshipFamily: boolean;
  isSnapFamily: boolean;
}) {
  if (!schoolYear) return null;
  const tuition = schoolYear.tuition ?? 0;
  const adminFee = schoolYear.annual_fees ?? 0;

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
    const familyPaysForTuition = app.remaining_opportunity_amount ?? 0;
    // A row has an OS determination when the family is on a
    // scholarship path OR admin has entered a per-student amount.
    // The third clause covers the case where admin enters the
    // per-student remaining amount before formally flipping the
    // family-level scholarship path flag — the breakout row + the
    // OS Award coverage should still render.
    const hasOSDetermination =
      isOpportunityScholarshipFamily ||
      isSnapFamily ||
      app.remaining_opportunity_amount != null;
    // Per-student award is only "finalized" once admin clicks
    // Confirm Scholarship Award Amount on the Determination card.
    // Until then, the Opportunity Scholarship coverage row stays
    // blank — admin shouldn't see a dollar value the family could
    // act on until they've locked it in.
    const awardConfirmed = app.confirmed_scholarship === true;
    const scholarshipCoverage = hasOSDetermination
      ? Math.max(0, tuition - stepUpAmount - familyPaysForTuition)
      : 0;
    const subtotal = familyPaysForTuition + adminFee;
    return {
      studentName: `${student.first_name} ${student.last_name}`.trim(),
      tuition,
      adminFee,
      familyPaysForTuition,
      stepUpAmount,
      stepUpStatus,
      stepUpType,
      scholarshipCoverage,
      awardConfirmed,
      hasOSDetermination,
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
                  Step Up for Students Award Status
                </td>
                <td className="px-4 py-3 text-right text-sm">
                  {row.stepUpStatus ? (
                    // Approved → green badge; anything else (Pending,
                    // Denied, etc.) stays muted-gray so the eye is drawn
                    // to the success-state cases.
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        row.stepUpStatus.toLowerCase() === "approved"
                          ? "bg-green-100 text-green-700"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
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
                  {row.awardConfirmed && row.scholarshipCoverage > 0
                    ? `-$${formatCurrency2(row.scholarshipCoverage)}`
                    : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>

              {/* Remaining Tuition Amount — the per-student tuition
                  the family still owes after the Opportunity
                  Scholarship has been applied. Same value baked into
                  the subtotal below, broken out as its own row so
                  admin sees the per-student tuition cost before any
                  fees. Renders whenever the row has a determination
                  (admin entered a per-student amount, OR family is
                  flagged on OS, OR family is on SNAP) — covers the
                  common case where admin enters the amount before
                  formally setting the scholarship path flag. */}
              {row.hasOSDetermination ? (
                <tr className="border-t">
                  <td className="px-4 py-3 text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      Remaining Tuition Amount
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                          >
                            <HelpCircle className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          className="max-w-xs text-xs"
                        >
                          {isSnapFamily ? (
                            <p>
                              SNAP-qualified families have no remaining
                              tuition — the Opportunity Scholarship covers
                              the full per-student amount.
                            </p>
                          ) : (
                            <p>
                              The per-student tuition the family still owes
                              after the Opportunity Scholarship has been
                              applied.
                            </p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    ${formatCurrency2(row.familyPaysForTuition)}
                  </td>
                </tr>
              ) : null}

              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Annual Admin Fee
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                  ${formatCurrency2(row.adminFee)}
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

      // Sync the family-payment row's `isFamilyAccepted` flag. The
      // per-student tuition/SUFS/annual_fee/monthly_amount columns
      // are already populated on each packet by the per-student
      // Confirm Scholarship Award Amount flow — admin walks through
      // each student on the Scholarship Determination card before
      // they ever get here, so the source-of-truth values are
      // already in place. This route also captures the family-
      // scoped transportation_total (server-derives the sum from
      // each app's `transportation_cost` when not provided
      // explicitly).
      try {
        const snapRes = await fetch(`/api/admin/family-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            familyId,
            yearId,
            // SNAP families pass explicit `null` (transport waived);
            // non-SNAP families omit the field so the route server-
            // derives the sum across active apps.
            ...(transportationTotal === null
              ? { transportation_total: null }
              : {}),
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
      // Note: the old registration_student_registration_progress
      // mirror (writing `monthly_tuition_payment` /
      // `monthly_transportation_payment` to the per-year progress
      // row) is gone — both columns were retired in favor of
      // per-student `monthly_amount` on each packet, which the
      // Tuition card reads directly via `sumFamilyBillingTotals`.

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
 * Sends the application back to the family for edits by flipping
 * `isSubmitted=false` and clearing `submitted_at`. The application
 * drops out of the admissions review queue and returns to the
 * editable apply flow on the family's side. Lives next to Approve
 * in the Acceptance card footer so admin can return-for-revisions
 * from the same surface they review.
 */
function RejectApplicationButton({
  familyId,
  yearId,
  familyName,
  onRejected,
  disabled,
  disabledReason,
}: {
  familyId: number;
  yearId: number;
  familyName: string;
  onRejected: () => void;
  /** When true, the button stays mounted but non-interactive. Used
   *  in the pre-accept footer so the action surface is always
   *  visible — admin sees the full lifecycle vocabulary at a glance
   *  even when one button doesn't apply yet (e.g. family hasn't
   *  submitted, so there's nothing to return). */
  disabled?: boolean;
  /** Tooltip text shown on the disabled button. */
  disabledReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function runReturn() {
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
        throw new Error(errBody?.error ?? `Return failed (${res.status})`);
      }
      toast.success(
        `${familyName || "Family"} application returned — back to the editable apply flow.`
      );
      setOpen(false);
      onRejected();
    } catch (err) {
      console.error("[RejectApplicationButton.runReturn] failed:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't return.");
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
        disabled={saving || !!disabled}
        onClick={() => setOpen(true)}
        // Neutral gray, not red — returning for revisions is a
        // routine action, not a destructive permanent denial.
        className="bg-white"
        title={
          disabled && disabledReason
            ? disabledReason
            : "Send this application back to the family for edits"
        }
      >
        {saving ? (
          <Loader2 className="size-4 mr-1.5 animate-spin shrink-0" />
        ) : (
          <Undo2 className="size-4 mr-1.5 shrink-0" />
        )}
        <span className="truncate">Return Application to Family</span>
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
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={(e) => {
                e.preventDefault();
                void runReturn();
              }}
            >
              {saving ? (
                <Loader2 className="size-4 mr-1.5 animate-spin" />
              ) : null}
              Yes, return
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
  size = "lg",
}: {
  familyId: number;
  yearId: number;
  familyName: string;
  onArchived: () => void;
  /** `lg` matches the Reject/Approve siblings in the determination
   *  card footer; `sm` matches the other header chips (Family
   *  overview, Export PDF, Notes) when rendered up top. */
  size?: "sm" | "lg";
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
        size={size}
        disabled={saving}
        onClick={() => setOpen(true)}
        // `lg` matches Reject + Approve in the determination card
        // footer; `sm` matches the other chips when rendered in the
        // page header.
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

      {/* `DocumentsToReviewBlock` moved out — now rendered once at
          the `DecisionCard` level (between the per-student SUFS
          rows and this block) so the card flow reads:
            SUFS rows → Documents to Review → Scholarship Review →
            Student-Specific Payments. */}
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

  // The "Remaining Amount Family Pays" input reads from the
  // `remaining_opportunity_amount` column on the app row. There's
  // intentionally no auto-fill (used to suggest `tuition − SUFS`
  // for SNAP families) — admin types the value per-student on
  // every path. Auto-fill made admin's manual entries get
  // overwritten on certain transitions; the input stays empty
  // until admin enters a number.
  const persistedAward = app?.remaining_opportunity_amount;

  // Local mirror of the editable fields so typing feels native.
  // Each field's onBlur compares against the source `app` snapshot
  // and PATCHes only the diff, so concurrent edits to other fields
  // don't get clobbered.
  const [draft, setDraft] = useState({
    sufs_award_id: app?.sufs_award_id ? String(app.sufs_award_id) : "",
    opportunity_scholarship_award_amount:
      typeof persistedAward === "number" ? String(persistedAward) : "",
  });

  useEffect(() => {
    setDraft({
      sufs_award_id: app?.sufs_award_id ? String(app.sufs_award_id) : "",
      opportunity_scholarship_award_amount:
        typeof persistedAward === "number" ? String(persistedAward) : "",
    });
  }, [app, persistedAward]);

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
   * Per-student billing PATCH — writes scholarship inputs (SUFS
   * amount, family-paid tuition portion) to the matching packet
   * row via the `/by-student` endpoint. The server derives all six
   * billing columns + re-syncs the Stripe SubscriptionItem when
   * billing is live, so the card just sends the raw inputs.
   *
   * Per-student values used to land on the application row; the
   * write moved to the per-student packet to avoid the same data
   * living in two places. Application row columns
   * (`sufs_award_amount`, `opportunity_scholarship_award_amount`)
   * are read-only legacy now — backfilled per-student values are
   * the source of truth.
   */
  async function patchPerStudentBilling(
    body: {
      sufsAwardAmount?: number;
      remainingOpportunityAmount?: number;
    }
  ) {
    if (!app) return;
    const yearId = Number(app.registration_school_years_id);
    if (!Number.isFinite(yearId) || yearId <= 0) return;
    setSavingField("per_student_billing");
    try {
      const res = await fetch(
        `/api/admin/student-registration/by-student`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: student.id,
            yearId,
            ...body,
          }),
        }
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${res.status})`);
      }
      onSaved();
    } catch (err) {
      console.error(
        "[DecisionStudentRow.patchPerStudentBilling] failed:",
        err
      );
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
      // The Confirm button just flips `confirmed_scholarship` on
      // the application row. The per-student billing math
      // (`sufs_amount`, `opportunity_award_amount`, etc.) lives
      // on the same application row and is written separately by
      // the Determination card's `/by-student` calls when admin
      // picks a SUFS tier or edits "Remaining Amount Family
      // Pays". This handler is a pure-bool toggle.
      const next = !sufsConfirmed;
      const body: Record<string, unknown> = {
        confirmed_scholarship: next,
      };
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
                  // Locked once the scholarship is confirmed — admin
                  // has to click Undo on the per-student footer to
                  // re-edit. Prevents accidental changes while the
                  // family-level approve gate is reading these
                  // values.
                  disabled={sufsConfirmed}
                  onValueChange={(v) => {
                    const nextType = v === "__none" ? "" : v;
                    // SUFS tier select writes two values to two
                    // different homes:
                    //   1. `sufs_type` (the tier label, e.g. "fes_eo_9")
                    //      stays on the application row — that's
                    //      where the admin queue + filters read it.
                    //   2. The derived dollar amount lands on the
                    //      per-student packet via
                    //      `/by-student` so billing reads the
                    //      single per-student source of truth.
                    // We deliberately stopped mirroring the amount
                    // onto the application row's
                    // `sufs_award_amount` — that column is legacy;
                    // packet's `sufs_amount` is canonical now.
                    const nextAmount = sufsAmountFor(nextType, schoolYear);
                    patchField("sufs_type", { sufs_type: nextType });
                    void patchPerStudentBilling({
                      sufsAwardAmount: nextAmount,
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
                  disabled={sufsConfirmed}
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
                  disabled={sufsConfirmed}
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

          {/* ─── Opportunity Scholarship sub-card ─── Shown on
              every scholarship path. The input is the single
              source of truth for the per-student
              `remaining_opportunity_amount`; admin types it
              manually for SNAP, Opportunity Scholarship, and
              opted-out families alike. No auto-fill or cascade
              derives this value — earlier versions zeroed it on
              SNAP-confirm or pre-filled it with `tuition − SUFS`,
              both of which silently overwrote admin's manual
              entries on certain transitions. */}
          <div className="rounded-md border bg-white p-4 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Opportunity Scholarship
            </h4>
            <Field>
              {/* The input persists onto the new
                  `remaining_opportunity_amount` column on the app
                  row (mirrored to the packet when one exists).
                  Allows $0 (admin explicitly set zero). */}
              <FieldLabel className="text-xs">
                Remaining Amount Family Pays
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
                  disabled={sufsConfirmed}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      opportunity_scholarship_award_amount: e.target.value,
                    }))
                  }
                  onBlur={() => {
                    const raw = draft.opportunity_scholarship_award_amount;
                    // Blank input = "no change" rather than an
                    // implicit $0. Admin who tabs through without
                    // typing shouldn't overwrite a persisted value.
                    if (raw === "" || raw == null) return;
                    const next = Number(raw);
                    if (!Number.isFinite(next)) return;
                    // No-op when the value hasn't changed. Compare
                    // against the row's persisted
                    // `remaining_opportunity_amount` — the column
                    // that captures this input. The `/by-student`
                    // route derives the remaining billing columns
                    // server-side and re-prices Stripe if billing
                    // is live.
                    const persisted = app.remaining_opportunity_amount;
                    if (next === persisted) return;
                    void patchPerStudentBilling({
                      remainingOpportunityAmount: next,
                    });
                  }}
                  className="border-input pl-7 tabular-nums"
                />
              </div>
            </Field>
          </div>

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
  disabled,
  disabledReason,
  onRevoked,
}: {
  familyId: number;
  yearId: number;
  familyName: string;
  /** When true, the button is non-interactive — typically because
   *  the family's registration has been confirmed and admin can't
   *  revoke acceptance without first undoing the registration
   *  confirmation. Reason rides on the button's `title` tooltip so
   *  admin sees why it's locked without leaving the page. */
  disabled?: boolean;
  disabledReason?: string;
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
        disabled={saving || !!disabled}
        title={disabled && disabledReason ? disabledReason : undefined}
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

/* ─────────── Undo registration confirmation (inline) ─────────── */

/**
 * Inline mirror of the Undo affordance that lives on the
 * registration detail page. Sits next to Revoke acceptance in the
 * post-accept footer so admin can do the full "rollback acceptance"
 * flow without bouncing between pages.
 *
 * The button stays mounted regardless of state — admin sees the
 * surface area for both Undo and Revoke at all times. Disabled when
 * `registrationConfirmed === false` (nothing to undo); when enabled
 * it's the prerequisite for the adjacent Revoke acceptance button,
 * which the Acceptance card's footer gates on the same flag.
 *
 * Same PATCH contract as the registration page's Undo button —
 * clears `isRegistrationConfirmed` on the per-year registration
 * progress row without touching per-section verifies or per-student
 * packet confirmations. Re-confirmable from the registration page
 * any time after.
 */
function UndoRegistrationConfirmationButton({
  familyId,
  yearId,
  familyName,
  registrationConfirmed,
  onUndone,
}: {
  familyId: number;
  yearId: number;
  familyName: string;
  registrationConfirmed: boolean;
  onUndone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function runUndo() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/registration-progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyId,
          yearId,
          isRegistrationConfirmed: false,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Update failed (${res.status})`);
      }
      toast.success(
        `Registration confirmation cleared for ${familyName || "family"}.`
      );
      setOpen(false);
      onUndone();
    } catch (err) {
      console.error(
        "[UndoRegistrationConfirmationButton.runUndo] failed:",
        err
      );
      toast.error(err instanceof Error ? err.message : "Couldn't undo.");
    } finally {
      setSaving(false);
    }
  }

  const disabled = !registrationConfirmed;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={saving || disabled}
        title={
          disabled
            ? "Registration isn't confirmed — nothing to undo."
            : undefined
        }
        onClick={() => setOpen(true)}
        className="bg-white"
      >
        <Undo2 className="size-4 mr-1.5" />
        Undo registration confirmation
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
              Undo {familyName || "family"} registration confirmation?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This clears the family-level registration latch.
              Per-section verifies and per-student packet
              confirmations stay intact — only the rollup audit is
              cleared. You can re-confirm at any time from the
              registration page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={(e) => {
                e.preventDefault();
                void runUndo();
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
    </>
  );
}

/* ─────────────────────── Scholarship path selector ─────────────────────── */

/**
 * Admin-side picker for the family's scholarship lifecycle path —
 * Opportunity Scholarship (the full application), SNAP benefits
 * (pre-qualification), or Opted out. Mostly used when admin is
 * transcribing a paper application or correcting a path mid-cycle.
 *
 * Two modes:
 *   - **Existing scholarship row** (scholarship !== null): clicks
 *     PATCH `/api/admin/scholarships/[id]`. The route's mutual-
 *     exclusion cascade ensures only one path flag is true.
 *   - **No scholarship row yet** (scholarship === null): clicks
 *     POST `/api/admin/scholarships` to bootstrap a fresh row with
 *     the chosen path set. Admin doesn't need the parent to open
 *     the Financial Aid section first — useful when transcribing
 *     paper applications.
 *
 * Renders as a row of three pill buttons. The active path is
 * highlighted. Switching paths on an existing scholarship row
 * routes through a confirmation modal — flipping the path nukes
 * down-stream data semantically (household + income +
 * contributing members are scoped to Opportunity, SNAP gets a
 * different cost determination, opted-out clears the application
 * entirely), so admin shouldn't be able to lose context with a
 * single misclick. Picking a path for a row that doesn't exist yet
 * skips the modal (nothing to lose).
 *
 * Locked when `disabled` is set — typically when admin has
 * verified the Financial Aid section: the verified state is the
 * source of truth, and changing the path mid-verify would
 * invalidate the determination underneath. Admin Undoes the
 * verification first to unlock the picker.
 */
function ScholarshipPathSelector({
  scholarship,
  familyId,
  yearId,
  onChanged,
  disabled,
  disabledReason,
}: {
  scholarship: XanoScholarship | null;
  /** Required when `scholarship` is null — scopes the POST that
   *  creates the new row. Ignored when an existing row is being
   *  PATCHed (the row's id carries the family + year). */
  familyId?: number;
  yearId?: number;
  onChanged?: () => void;
  /** When true, every option button is non-interactive and reads
   *  as muted. Used to lock the picker after the Financial Aid
   *  section is verified — admin has to Undo the verify to switch
   *  paths. */
  disabled?: boolean;
  /** Optional caption to render below the picker when `disabled`
   *  — explains *why* it's locked so admin doesn't wonder. */
  disabledReason?: string;
}) {
  const [savingPath, setSavingPath] = useState<
    "isOpportunityScholarship" | "isSNAPBenefits" | "isNotParticipating" | null
  >(null);
  // Pending switch sits in state so the modal can read which target
  // path admin clicked, render its specific copy, and route the
  // confirm action back through `setPath`. Cleared on cancel or
  // after the PATCH lands. Stays null when there's no existing row
  // — first-time pick skips the modal.
  const [pendingSwitch, setPendingSwitch] = useState<{
    flag: "isOpportunityScholarship" | "isSNAPBenefits" | "isNotParticipating";
    label: string;
  } | null>(null);
  const active: "opp" | "snap" | "out" | null = scholarship?.isOpportunityScholarship
    ? "opp"
    : scholarship?.isSNAPBenefits
      ? "snap"
      : scholarship?.isNotParticipating
        ? "out"
        : null;

  async function setPath(
    flag: "isOpportunityScholarship" | "isSNAPBenefits" | "isNotParticipating",
    label: string
  ) {
    setSavingPath(flag);
    try {
      // Existing row → PATCH the path flag (mutual-exclusion
      // cascade in the route handles clearing the other two).
      // No row → POST a new scholarship scoped to (family, year)
      // with the chosen path set at creation time.
      const res = scholarship
        ? await fetch(`/api/admin/scholarships/${scholarship.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [flag]: true }),
          })
        : await fetch(`/api/admin/scholarships`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              familyId,
              yearId,
              path: flag,
            }),
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
      setPendingSwitch(null);
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
          clear at a glance without painting the button green.
          When `disabled` is set every button reads as non-
          interactive (muted, no hover) and clicks are swallowed. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {options.map((opt) => {
          const isActive = active === opt.key;
          const isSaving = savingPath === opt.flag;
          const buttonDisabled =
            disabled || isSaving || savingPath !== null;
          return (
            <button
              key={opt.key}
              type="button"
              disabled={buttonDisabled}
              onClick={() => {
                if (isActive) return;
                // Switching an existing path routes through the
                // confirmation modal; first-time pick on an empty
                // row skips it (nothing to lose, just creates the
                // row with the chosen flag set).
                if (scholarship && active !== null) {
                  setPendingSwitch({ flag: opt.flag, label: opt.label });
                  return;
                }
                void setPath(opt.flag, opt.label);
              }}
              className={cn(
                "flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed",
                disabled
                  ? "opacity-60 hover:bg-white"
                  : "disabled:opacity-50",
                // Active-state border + filled circle use `green-500`
                // so the indicator matches the SectionShell card-
                // header status dot (also `bg-green-500`) — the two
                // greens used to drift, with the picker on `green-600`
                // and the dot on `green-500`. Same color now keeps the
                // surface visually coherent.
                isActive
                  ? "border-green-500 hover:bg-white"
                  : "border-border hover:bg-muted/40"
              )}
            >
              {isSaving ? (
                <Loader2 className="size-3 animate-spin shrink-0 text-muted-foreground" />
              ) : isActive ? (
                // Small filled green circle signals selection
                // without flooding the button with color — the
                // 1px green border + filled circle is enough
                // visual differentiation against the unselected
                // neutral outline.
                <Circle className="size-2.5 shrink-0 fill-green-500 text-green-500" />
              ) : (
                <Circle className="size-2.5 shrink-0 text-muted-foreground/40" />
              )}
              <span className="font-medium text-foreground">{opt.label}</span>
            </button>
          );
        })}
      </div>
      {disabled && disabledReason ? (
        <p className="text-xs text-muted-foreground">{disabledReason}</p>
      ) : null}

      {/* Confirmation modal for path switches on an existing row.
          The path change has downstream consequences (financial
          aid form fields visibility, SNAP-vs-Opportunity cost
          determination semantics, etc.), so a single misclick
          shouldn't be able to flip it. First-time picks on an
          empty row skip the modal — nothing to invalidate. */}
      <AlertDialog
        open={pendingSwitch !== null}
        onOpenChange={(o) => {
          if (!o) setPendingSwitch(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Switch scholarship path to {pendingSwitch?.label}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The Financial Aid section behaves differently for each
              path — household, income, asset, and debt fields only
              apply to the Opportunity Scholarship path; SNAP routes
              through the SNAP cost determination; Opted Out skips
              the financial review entirely. Existing data on file
              stays on the row, but it stops being shown to the
              family until the path is switched back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingPath !== null}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={savingPath !== null}
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={(e) => {
                e.preventDefault();
                if (pendingSwitch) {
                  void setPath(pendingSwitch.flag, pendingSwitch.label);
                }
              }}
            >
              {savingPath !== null ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : null}
              Yes, switch path
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
