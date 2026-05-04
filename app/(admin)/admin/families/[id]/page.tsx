"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { toast } from "sonner";
import {
  Archive,
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  ExternalLink,
  Loader2,
  Pencil,
  SquarePen,
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
  const { data: family, isLoading } = useSWR<FamilyResponse>(
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
  const { data: progress, mutate: refreshProgress } = useSWR<{
    id: number;
    isAccepted: boolean;
    isSubmitted: boolean;
    submitted_at: number | null;
    family_completed?: boolean;
    students_completed?: boolean;
    financial_aid_completed?: boolean;
    testing_completed?: boolean;
  } | null>(
    familyId && yearId
      ? `/api/admin/family-progress?familyId=${familyId}&yearId=${yearId}`
      : null,
    adminFetcher
  );

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
          {/* Header action row — Notes drawer trigger sits next to
              the Decision actions (Return / Approve / Revoke) so
              admin can pop open the comms log without scrolling.
              Notes is family-scoped so it renders regardless of
              whether a year is selected; the Decision actions only
              render when we have a year context. */}
          <div className="flex items-center gap-2 shrink-0">
            <FamilyNotesSheet
              familyId={family.id}
              defaultYearId={yearId ? Number(yearId) : null}
            />
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

        {/* Students — bio + per-app fields per student. */}
        <section id="section-students" className="scroll-mt-20">
          <SectionShell
            title={`Students${yearMeta ? ` · ${yearMeta.year_name}` : ""}`}
            editHref={sectionHref("students")}
            notes={{
              familyId: family.id,
              section: "section-students",
              title: "Notes — Students",
            }}
            status={deriveSectionStatus(
              progress?.students_completed,
              students.length > 0
            )}
          >
            {students.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No students on file.
              </p>
            ) : !yearId ? (
              <div className="space-y-4">
                {students.map((s) => (
                  <StudentBio key={s.id} student={s} />
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
            >
              {detailLoading && !detail ? (
                <Skeleton className="h-48 w-full rounded-md" />
              ) : scholarship ? (
                <ScholarshipBlock
                  scholarship={scholarship}
                  familyId={family.id}
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
  } | null;
  hasScholarship: boolean;
}) {
  // Mirror the parent app's two visual states: complete (green check)
  // vs in-progress (amber edit). For admin we don't bother
  // distinguishing "not started" — every section is editable, so the
  // edit affordance applies whenever it isn't yet complete.
  //
  // Notes intentionally absent — comms log is now a fixed bottom-right
  // sheet trigger handled outside this nav.
  const items: Array<{
    key: string;
    label: string;
    href: string;
    complete: boolean;
    show: boolean;
  }> = [
    {
      key: "decision",
      label: "Decision",
      href: "#section-decision",
      complete: progress?.isAccepted === true,
      show: !!yearId,
    },
    {
      key: "family",
      label: "Family",
      href: "#section-family",
      complete: progress?.family_completed === true,
      show: true,
    },
    {
      key: "students",
      label: "Students",
      href: "#section-students",
      complete: progress?.students_completed === true,
      show: true,
    },
    {
      key: "financial-aid",
      label: "Financial Aid",
      href: "#section-financial-aid",
      complete: progress?.financial_aid_completed === true,
      show: !!yearId && hasScholarship,
    },
    {
      key: "testing",
      label: "Testing",
      href: "#section-testing",
      complete: progress?.testing_completed === true,
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

          {items
            .filter((i) => i.show)
            .map((item) => (
              <a
                key={item.key}
                href={item.href}
                onClick={(e) => handleNavClick(e, item.href)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left text-sm transition-colors hover:bg-muted/30"
              >
                <NavCircle complete={item.complete} />
                <span
                  className={cn(
                    "truncate",
                    item.complete
                      ? "font-semibold text-foreground"
                      : "font-medium text-muted-foreground"
                  )}
                >
                  {item.label}
                </span>
              </a>
            ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Status circle for a sidebar nav row. Two visual modes — kept
 * pixel-aligned with the parent-side `ApplicationSideNav.StepCircle`
 * so admin and parent surfaces use the same visual vocabulary:
 *   - `complete`: filled green circle with a white checkmark
 *     (`bg-green-500` + `<Check>`)
 *   - editable section, not yet complete: filled amber circle with
 *     a white square-pen (`bg-amber-500` + `<SquarePen>`)
 */
function NavCircle({ complete }: { complete: boolean }) {
  if (complete) {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-500 text-white">
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
  children: React.ReactNode;
}) {
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
          </div>
          {/* Notes + Edit pair, docked at the right of the section
              header. Notes opens a section-filtered drawer (its own
              SWR cache key, its own POST scope); Edit jumps to the
              per-section editor route. */}
          <div className="flex items-center gap-2 shrink-0">
            {notes ? (
              <FamilyNotesSheet
                familyId={notes.familyId}
                section={notes.section}
                title={notes.title}
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
      <CardContent className="space-y-6 py-5 bg-white">{children}</CardContent>
    </Card>
  );
}

function SectionGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        {title}
      </h3>
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

function StudentBio({ student }: { student: Student }) {
  return (
    <div className="rounded-md border bg-muted/10 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">
          {student.first_name} {student.last_name}
        </p>
        {student.isAccepted ? <StatusBadge status="accepted" /> : null}
      </div>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <DisabledField
          label="Date of birth"
          value={
            student.date_of_birth
              ? new Date(`${student.date_of_birth}T00:00:00`)
                  .toLocaleDateString()
              : ""
          }
          required
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
}: {
  student: Student;
  app: XanoApplication | undefined;
}) {
  return (
    <div className="rounded-md border bg-muted/10 p-4 space-y-5">
      {/* Header — student name only. The earlier "App #24 · Created
          5/3/2026" subtitle and the Draft / status pill on the right
          read as developer-facing metadata; admins making
          determinations don't need either to do their job. The
          Decision card up top already surfaces the application's
          submitted/accepted state. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {student.first_name} {student.last_name}
          </p>
          {!app ? (
            <p className="text-xs italic text-muted-foreground">
              No application row for this year.
            </p>
          ) : null}
        </div>
      </div>

      {/* Demographics — sourced from the student record itself, not
          the per-year app. Always shown so the picture of who's
          applying stays at the top of the card. Required fields
          flagged red when missing per the parent flow's validation. */}
      <SectionGroup title="Student">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          <DisabledField
            label="Date of birth"
            value={
              student.date_of_birth
                ? new Date(`${student.date_of_birth}T00:00:00`)
                    .toLocaleDateString()
                : ""
            }
            required
          />
          <DisabledField label="Gender" value={student.gender} required />
          <DisabledField label="Ethnicity" value={student.ethnicity} required />
        </div>
      </SectionGroup>

      {app ? (
        <>
          <SectionGroup title="Academic">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
              <DisabledField
                label="Last grade completed"
                value={app.last_grade_completed}
                required
              />
              <DisabledField
                label="Current grade"
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
    </div>
  );
}

function TestingBlock({
  student,
  app,
}: {
  student: Student;
  app: XanoApplication | undefined;
}) {
  return (
    <div className="rounded-md border bg-muted/10 p-4 space-y-4">
      <p className="text-sm font-semibold">
        {student.first_name} {student.last_name}
      </p>
      {app ? (
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
}: {
  scholarship: XanoScholarship;
  /** Reserved for future surfaces inside the Financial Aid section
   *  that need to scope notes / actions back to the family record.
   *  Currently unused since the documents review (and its notes)
   *  moved entirely to the Scholarship Determination card. */
  familyId: number;
}) {
  // Opt-out + SNAP short-circuits. The Opportunity Scholarship form
  // is the only thing that fills in the household / income / asset
  // / debt fields below, so on either of those alternate paths the
  // form fields are all defaults and rendering them just looks like
  // data is missing. Show a notice + the relevant document(s)
  // instead so the section reads as "here's what they actually
  // submitted" rather than "the parent skipped this."
  if (scholarship.isNotParticipating) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          The family opted out of the SailFuture Opportunity Scholarship
          for this year. No financial information was collected.
        </p>
        <DisabledField
          label="Opportunity Scholarship status"
          value="Opted out"
        />
      </div>
    );
  }

  if (scholarship.isSNAPBenefits) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          The family pre-qualifies via SNAP benefits. The full
          Opportunity Scholarship form was skipped — only the SNAP
          award letter is on file. Confirm the document under the
          Scholarship Determination card.
        </p>
        <DisabledField
          label="Opportunity Scholarship status"
          value="SNAP benefits"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
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

      {/* Contributing-members + every other file-upload section
          (SNAP, unemployment, benefit docs) now lives under the
          Scholarship Determination card — that's where admin makes
          the verification + decision. Financial Aid stays focused
          on the household / income / asset numbers the parent
          submitted; uploaded paperwork is reviewed alongside the
          determination context. */}

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
    </div>
  );
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
        disabled
        readOnly
        placeholder={placeholder}
        onChange={() => {}}
        aria-invalid={isMissing || undefined}
        className={cn(
          "disabled:opacity-100 disabled:bg-white disabled:cursor-default",
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
  progress: { id: number; isAccepted: boolean; isSubmitted: boolean } | null;
  loading: boolean;
  onChanged: () => void;
}) {
  const accepted = progress?.isAccepted === true;
  const familySubmitted = progress?.isSubmitted === true;
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

  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white border-emerald-200">
      <CardHeader className="py-3 !pb-3 border-b bg-emerald-50/40">
        <div className="flex items-center justify-between gap-3">
          {/* Title-only header — the prior shield icon read as
              "approval / authority" and competed with the rest of
              the page's monochrome header treatment. */}
          <CardTitle className="text-base">Scholarship Determination</CardTitle>
          {/* Status badge stays in the card header for context; the
              actual Approve / Return Application buttons live in the
              page header up top. */}
          {accepted ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 text-xs font-medium">
              <CheckCircle2 className="size-3.5" />
              Accepted
            </span>
          ) : anySubmitted ? (
            // Neutral muted tone — keeps the page's monochrome read
            // for "no decision yet" and reserves color (green) for
            // the resolved Accepted state. Earlier blue was loud and
            // implied a positive status that hasn't been earned yet.
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted text-muted-foreground border border-border px-2.5 py-0.5 text-xs font-medium">
              Awaiting decision
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 px-2.5 py-0.5 text-xs font-medium">
              Not yet submitted
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent
        className={cn(
          "space-y-6 py-5 bg-white transition-opacity",
          // Once accepted, the entire Decision card content fades
          // out. Admin can still read everything (so we don't fully
          // hide it) but the visual cue says "this work is done."
          // Revoke lives in the page header for reversal — the
          // gray-out doesn't block clicks since admin may still
          // want to copy/inspect text.
          accepted && "opacity-60"
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

            {/* Financial picture + matrix bracket — read-only context
                so admins don't have to bounce to the Financial Aid
                section to make a per-student determination below. */}
            <ScholarshipReviewBlock
              yearId={yearId}
              scholarship={scholarship}
              schoolYear={schoolYear}
              apps={apps}
              familyId={familyId}
              loading={loading}
              onScholarshipChanged={onChanged}
            />

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
                    }}
                  />
                );
              })}
            </div>

            {/* Family-level decision footer — Reject + Approve. One
                set per family (not per student) since these are
                family-wide actions. Hidden once the family is
                accepted; the card grays out and the Revoke
                affordance lives in the page header.

                Layout (left → right, decreasing severity to right):
                  - Archive [Reject] [Approve]
                  - When the family hasn't submitted yet, Reject
                    drops out (nothing to send back); the layout
                    collapses to Archive + Approve. */}
            {!accepted ? (
              <div
                className={cn(
                  "grid gap-2 pt-2 border-t",
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
                  monthlyTuitionPayment={monthlyTuitionPayment}
                  onApproved={onChanged}
                />
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
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
  monthlyTuitionPayment,
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
  /** Monthly snapshot computed at the DecisionCard level. Sent
   *  alongside the family-progress PATCH so the
   *  `registration_families_payment` row holds a copy of the
   *  authoritative payment amount at approval time. */
  monthlyTuitionPayment: number;
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
  const gateBlockReason = (() => {
    if (!allDocsConfirmed) {
      return "Confirm every document under Documents to review before approving.";
    }
    if (!allSufsConfirmed) {
      return `Confirm scholarship award for ${unconfirmedCount} student${
        unconfirmedCount === 1 ? "" : "s"
      } before approving.`;
    }
    return null;
  })();

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
          "Approve this family for the selected school year"
        }
      >
        {saving ? (
          <Loader2 className="size-4 mr-1.5 animate-spin" />
        ) : (
          <CheckCircle2 className="size-4 mr-1.5" />
        )}
        Approve
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
        {/* Documents to Review on the SNAP path — uses the same flat
            table the non-SNAP path renders, just with a single row
            (the SNAP award letter) instead of contributing members
            + benefits. Keeps the doc-confirm visual consistent
            across every path. */}
        <DocumentsToReviewBlock
          scholarship={scholarship}
          familyId={familyId}
          onScholarshipChanged={onScholarshipChanged}
        />

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
                  totalAssets > 0 && "text-green-600"
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
              <tr className="bg-white">
                <td className="px-4 py-2 font-medium">Family pays</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {tuitionPct}%
                </td>
              </tr>
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

      {/* Documents to review — every file-upload section the parent's
          scholarship form collected (SNAP, unemployment, contributing
          members + per-file confirms, government benefits) lands
          here as a single flat table so admin can verify everything
          in one place. The Confirm Scholarship Award Amount button
          on each per-student row is gated on every confirmable doc
          here being marked confirmed. */}
      <DocumentsToReviewBlock
        scholarship={scholarship}
        familyId={familyId}
        onScholarshipChanged={onScholarshipChanged}
      />
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
  const [draft, setDraft] = useState({
    sufs_award_id: app?.sufs_award_id ? String(app.sufs_award_id) : "",
    opportunity_scholarship_award_amount: persistedAward
      ? String(persistedAward)
      : shouldAutoFillSnap
        ? String(snapSuggestedCost)
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
    });
    // Re-derive only when the source data changes; deliberate stale
    // closure on shouldAutoFillSnap is fine since it's computed
    // from `app` + `approveCtx.isSNAPPath` which are both deps.
  }, [app, persistedAward, shouldAutoFillSnap, snapSuggestedCost]);

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
      const res = await fetch(`/api/admin/applications/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed_scholarship: !sufsConfirmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
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
                  onValueChange={(v) =>
                    patchField("sufs_type", {
                      sufs_type: v === "__none" ? "" : v,
                    })
                  }
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
                  type="number"
                  inputMode="numeric"
                  placeholder="From SUFS portal"
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      sufs_award_id: e.target.value,
                    }))
                  }
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
              family-level decisions and live in the Scholarship
              Determination card's footer (one set, after every
              student row), so they're not duplicated per-row.

              Three visual states:
                - default → white outline button, clickable
                - saving (mid-PATCH) → spinner + "Submitting…"
                - confirmed → gray, disabled, "Submitted"
                  (intentionally non-toggleable; admin commits to
                  the per-student award once they confirm).

              Once the family is accepted, this button hides — the
              Decision card grays out as a unit. */}
          {!approveCtx.accepted ? (
            <Button
              type="button"
              variant={sufsConfirmed ? "secondary" : "outline"}
              size="lg"
              disabled={
                confirming ||
                sufsConfirmed ||
                (!sufsConfirmed && !approveCtx.allDocsConfirmed)
              }
              onClick={toggleConfirmed}
              className={cn(
                "w-full",
                sufsConfirmed
                  ? "bg-muted text-muted-foreground cursor-default disabled:opacity-100"
                  : "bg-white"
              )}
              title={
                sufsConfirmed
                  ? "Scholarship award already submitted for this student"
                  : !approveCtx.allDocsConfirmed
                    ? "Mark every document under Documents to Review confirmed first"
                    : "Confirm the scholarship award amounts above"
              }
            >
              {confirming ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-sm font-semibold">Submitting…</span>
                </span>
              ) : sufsConfirmed ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                  <CheckCircle2 className="size-4" />
                  Submitted
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Check className="size-4" />
                  <span>Confirm Scholarship Award Amount</span>
                </span>
              )}
            </Button>
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

  return (
    <>
      <div className="flex items-center gap-2 shrink-0">
        {/* Revoke acceptance — only renders when the family is
            accepted. Approve / Reject / Archive all live inside
            the Scholarship Determination card's footer (per the
            decision flow that lives there); the page header just
            keeps the post-acceptance reversal affordance. */}
        {accepted ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => setPending("revoke")}
            className="bg-white"
          >
            <XCircle className="size-4 mr-1.5" />
            Revoke acceptance
          </Button>
        ) : null}
      </div>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setPending(null);
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
                void patchProgress({ isAccepted: false });
                toast.success(
                  `Acceptance revoked for ${familyName || "family"}.`
                );
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
