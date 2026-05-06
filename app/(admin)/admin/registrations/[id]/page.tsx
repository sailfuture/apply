"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Pencil,
  SquarePen,
  Undo2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
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
import { FamilyNotesSheet } from "@/components/admin/family-notes-sheet";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import { formatNoteTimestamp } from "@/lib/format-note-time";
import type {
  AdminFamilyRegistrationResponse,
  AdminFamilyRegistrationStudentRow,
} from "@/app/api/admin/registrations/[id]/route";
import type { XanoEmergencyContact } from "@/lib/xano";

const xanoBase =
  process.env.NEXT_PUBLIC_XANO_BASE ?? "https://xsc3-mvx7-r86m.n7e.xano.io";

/**
 * Admin family-focused registration detail page.
 *
 * Mirrors the visual rhythm of the apply-flow family detail page at
 * `/admin/families/[id]`:
 *
 *   - Sticky left side nav with green/amber section dots
 *   - SectionShell cards with Notes + per-section action buttons
 *   - Disabled-input "view-only summary" for every parent-facing field
 *   - Section anchors so admin can deep-link or smooth-scroll
 *
 * Sections (in left-nav / page order):
 *   1. Tuition — printed name + signature on file + monthly snapshot
 *   2. Enrollment Agreement — PandaDoc status, inline PDF preview
 *      when signed, printed name input
 *   3. Registration Packet — one sub-card per active student with the
 *      full packet contents (sizes, medical, file uploads, emergency
 *      contacts, liability waiver) + per-student `registrationConfirmed`
 *      toggle
 *   4. Volunteer Hours — printed name + signature on file
 *
 * Admin can flip the four section booleans on the family-progress
 * row, plus the per-student `registrationConfirmed` flag.
 */
export default function FamilyRegistrationDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const familyId = Number(params.id);

  const swrKey =
    Number.isFinite(familyId) && yearId
      ? `/api/admin/registrations/${familyId}?yearId=${yearId}`
      : null;
  const { data, isLoading, error, mutate } =
    useSWR<AdminFamilyRegistrationResponse>(swrKey, adminFetcher);

  // Tracks which section is mid-PATCH so the spinner inside that
  // section's verify footer is scoped — clicking Verify on Tuition
  // doesn't gray out Enrollment's button.
  const [savingSection, setSavingSection] = useState<
    "tuition" | "enrollment" | "volunteer" | null
  >(null);

  const backHref = yearId
    ? `/admin/registrations?yearId=${yearId}`
    : "/admin/registrations";

  if (!yearId) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view the family&rsquo;s registration.
        </div>
      </div>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-4">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          {error instanceof Error
            ? error.message
            : "Couldn’t load this family’s registration."}
        </div>
      </div>
    );
  }

  const { family, primary, school_year, progress, students, emergency_contacts } =
    data;
  const familyName =
    family?.family_name?.trim() || `Family #${family?.id ?? familyId}`;

  const refresh = () => {
    void mutate();
  };

  // Builder for the per-section editor route. Mirrors the
  // `sectionHref` helper on the apply-flow page so the Edit button
  // on each registration section card opens the matching editor at
  // `/admin/registrations/[familyId]/[section]?yearId=X`.
  const regSectionHref = (slug: string) =>
    `/admin/registrations/${family?.id ?? familyId}/${slug}${
      yearId ? `?yearId=${yearId}` : ""
    }`;

  // Per-section completion state — drives the green/amber dot in the
  // side nav AND the colored status dot in each `SectionShell` header.
  const sectionStatus = {
    tuition: !!progress?.isTuition,
    enrollment: !!progress?.isEnrollment,
    // Registration completion is derived purely from per-student
    // `registrationConfirmed` — there's no section-level verify
    // button on this card. A section is complete when there's at
    // least one student AND every active student's packet has been
    // confirmed.
    registration:
      students.length > 0 &&
      students.every((s) => !!s.packet?.registrationConfirmed),
    volunteer: !!progress?.isVolunteerHours,
  };

  // Per-section verify state — wraps the admin registration-progress
  // PATCH so each section's footer can flip its bool with one call.
  // Tracks the in-flight section locally so the spinner is scoped to
  // whichever section admin clicked. The audit name lives directly
  // on the row's `*_admin_confirm_admin` string column — no lookup
  // needed.
  const verifyToggle = (
    field: "tuition_admin_confirm" | "enrollment_admin_confirm" | "volunteer_admin_confirm",
    next: boolean,
    section: "tuition" | "enrollment" | "volunteer"
  ) => {
    setSavingSection(section);
    void (async () => {
      try {
        const res = await fetch(`/api/admin/registration-progress`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            familyId: Number(family?.id ?? familyId),
            yearId: Number(yearId),
            [field]: next,
          }),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => null);
          throw new Error(errBody?.error ?? `Update failed (${res.status})`);
        }
        toast.success(next ? "Section verified." : "Verification cleared.");
        refresh();
      } catch (err) {
        console.error(`[verifyToggle.${section}]`, err);
        toast.error(err instanceof Error ? err.message : "Couldn't update.");
      } finally {
        setSavingSection(null);
      }
    })();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto flex gap-6">
      {/* Sticky left side nav. Same `position: fixed` workaround the
          family detail page uses so Radix scroll-locking doesn't
          jump it to the top of the document when a Select/Dialog
          opens. */}
      <aside className="hidden xl:block w-[220px] shrink-0">
        <div
          className="fixed top-20 w-[220px]"
          style={{ left: "max(1.5rem, calc(50vw - 616px))" }}
        >
          <RegistrationSideNav
            backHref={backHref}
            sectionStatus={sectionStatus}
          />
        </div>
      </aside>

      <main className="flex-1 min-w-0 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold truncate">
              {familyName}
              {school_year?.year_name ? (
                <span className="ml-2 text-base font-normal text-muted-foreground">
                  · {school_year.year_name}
                </span>
              ) : null}
            </h1>
            {primary ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {`${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim() ||
                  "—"}
                {primary.email ? ` · ${primary.email}` : ""}
                {primary.phone ? ` · ${primary.phone}` : ""}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Page-header notes drawer is phase-scoped too — hits
                the dedicated `..._by_registration` Xano query so
                admin only sees registration-phase comms by default,
                not the full apply-phase backlog. */}
            <FamilyNotesSheet
              familyId={Number(family?.id ?? familyId)}
              defaultYearId={Number(yearId)}
              phase="registration"
            />
            <Button asChild variant="outline" size="sm" className="bg-white">
              <Link
                href={`/admin/families/${family?.id ?? familyId}?yearId=${yearId}`}
              >
                View application
                <ExternalLink className="size-3.5 ml-1.5" />
              </Link>
            </Button>
          </div>
        </div>

        <section id="section-tuition" className="scroll-mt-20">
          <SectionShell
            title="Tuition"
            status={sectionStatus.tuition ? "complete" : "in_progress"}
            editHref={regSectionHref("tuition")}
            notes={{
              familyId: Number(family?.id ?? familyId),
              yearId: Number(yearId),
              section: "section-tuition",
              title: "Notes — Tuition",
            }}
            verify={{
              sectionLabel: "Tuition",
              verified: progress?.tuition_admin_confirm === true,
              parentCompleted: progress?.isTuition === true,
              verifiedTime: progress?.tuition_admin_confirm_time ?? null,
              verifiedByName:
                progress?.tuition_admin_confirm_admin?.trim() || null,
              saving: savingSection === "tuition",
              onToggle: (next) =>
                verifyToggle("tuition_admin_confirm", next, "tuition"),
            }}
          >
            <TuitionBlock
              progress={progress}
              schoolYear={school_year}
            />
          </SectionShell>
        </section>

        <section id="section-enrollment" className="scroll-mt-20">
          <SectionShell
            title="Enrollment Agreement"
            status={sectionStatus.enrollment ? "complete" : "in_progress"}
            editHref={regSectionHref("enrollment")}
            notes={{
              familyId: Number(family?.id ?? familyId),
              yearId: Number(yearId),
              section: "section-enrollment",
              title: "Notes — Enrollment Agreement",
            }}
            verify={{
              sectionLabel: "Enrollment",
              verified: progress?.enrollment_admin_confirm === true,
              parentCompleted: progress?.isEnrollment === true,
              verifiedTime: progress?.enrollment_admin_confirm_time ?? null,
              verifiedByName:
                progress?.enrollment_admin_confirm_admin?.trim() || null,
              saving: savingSection === "enrollment",
              onToggle: (next) =>
                verifyToggle("enrollment_admin_confirm", next, "enrollment"),
            }}
          >
            <EnrollmentAgreementBlock progress={progress} />
          </SectionShell>
        </section>

        <section id="section-registration" className="scroll-mt-20">
          {/* No section-level Mark Confirmed button on this card —
              registration packet review is per-student (each row in
              `RegistrationPacketBlock` owns its own Mark Confirmed
              toggle that flips `registrationConfirmed` on the
              packet). The family-level `isRegistration` flag isn't
              flipped from this UI; section completion derives from
              the per-student flags below. */}
          <SectionShell
            title="Registration Packet"
            status={sectionStatus.registration ? "complete" : "in_progress"}
            editHref={regSectionHref("registration")}
            notes={{
              familyId: Number(family?.id ?? familyId),
              yearId: Number(yearId),
              section: "section-registration",
              title: "Notes — Registration Packet",
            }}
          >
            <RegistrationPacketBlock
              students={students}
              emergencyContacts={emergency_contacts}
              onChanged={refresh}
            />
          </SectionShell>
        </section>

        <section id="section-volunteer" className="scroll-mt-20">
          <SectionShell
            title="Volunteer Hours"
            status={sectionStatus.volunteer ? "complete" : "in_progress"}
            editHref={regSectionHref("volunteer")}
            notes={{
              familyId: Number(family?.id ?? familyId),
              yearId: Number(yearId),
              section: "section-volunteer",
              title: "Notes — Volunteer Hours",
            }}
            verify={{
              sectionLabel: "Volunteer Hours",
              verified: progress?.volunteer_admin_confirm === true,
              parentCompleted: progress?.isVolunteerHours === true,
              verifiedTime: progress?.volunteer_admin_confirm_time ?? null,
              verifiedByName:
                progress?.volunteer_admin_confirm_admin?.trim() || null,
              saving: savingSection === "volunteer",
              onToggle: (next) =>
                verifyToggle("volunteer_admin_confirm", next, "volunteer"),
            }}
          >
            <VolunteerHoursBlock progress={progress} />
          </SectionShell>
        </section>
      </main>
    </div>
  );
}

/* ─────────────────────── Side nav ─────────────────────── */

/**
 * Sticky left nav — pixel-aligned with the apply-flow's
 * `FamilyDetailNav` so admin sees the same vocabulary on both
 * surfaces. Green check = complete; amber square-pen = in progress.
 */
function RegistrationSideNav({
  backHref,
  sectionStatus,
}: {
  backHref: string;
  sectionStatus: {
    tuition: boolean;
    enrollment: boolean;
    registration: boolean;
    volunteer: boolean;
  };
}) {
  const items: Array<{
    key: string;
    label: string;
    href: string;
    complete: boolean;
  }> = [
    {
      key: "tuition",
      label: "Tuition",
      href: "#section-tuition",
      complete: sectionStatus.tuition,
    },
    {
      key: "enrollment",
      label: "Enrollment Agreement",
      href: "#section-enrollment",
      complete: sectionStatus.enrollment,
    },
    {
      key: "registration",
      label: "Registration",
      href: "#section-registration",
      complete: sectionStatus.registration,
    },
    {
      key: "volunteer",
      label: "Volunteer Hours",
      href: "#section-volunteer",
      complete: sectionStatus.volunteer,
    },
  ];

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
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", href);
    }
  }

  return (
    <div className="rounded-xl bg-background p-1.5 shadow-sm border">
      <div className="overflow-hidden rounded-lg border">
        <div className="divide-y">
          <Link
            href={backHref}
            className="flex w-full items-center gap-3 px-3 py-3 text-left text-sm transition-colors hover:bg-muted/30"
          >
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/30 text-muted-foreground">
              <ArrowLeft className="size-3" />
            </div>
            <span className="truncate font-medium text-muted-foreground">
              Registrations
            </span>
          </Link>
          {items.map((item) => (
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
 * Status circle for a sidebar nav row — pixel-aligned with
 * `FamilyDetailNav.NavCircle` from the apply-flow page so both
 * admin surfaces use the same visual vocabulary.
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

/* ─────────────────────── Section shell ─────────────────────── */

type SectionStatus = "complete" | "in_progress" | "not_started";

const STATUS_DOT_CLASS: Record<SectionStatus, string> = {
  complete: "bg-green-500",
  in_progress: "bg-yellow-500",
  not_started: "bg-red-500",
};

const STATUS_LABEL: Record<SectionStatus, string> = {
  complete: "Complete",
  in_progress: "In progress",
  not_started: "Not started",
};

/**
 * Shared section card chrome — title + status dot, optional Notes
 * drawer trigger, optional verify-section footer with audit caption
 * + Undo warning modal. Visual rhythm matches the apply-flow
 * `SectionShell` so the two admin surfaces feel like the same page.
 *
 * Verify footer (when `verify` is passed) renders below content with
 * a horizontal divider; the audit caption ("Verified by Mr.
 * Thompson · 2 hr ago") sits on the left, the Confirmed pill +
 * Undo button on the right when verified, or just a single Verify
 * button when unverified.
 */
function SectionShell({
  title,
  status,
  notes,
  editHref,
  verify,
  children,
}: {
  title: string;
  status?: SectionStatus;
  /**
   * Notes drawer config. `yearId` + `phase="registration"` are
   * baked in here (rather than per-call) because every section
   * card on this page belongs to the same registration phase, so
   * threading them through every call site would just be
   * boilerplate. The drawer hits the dedicated
   * `registration_admin_notes_by_registration` Xano query and
   * stamps the matching FK on writes.
   */
  notes?: {
    familyId: number;
    yearId: number;
    section: string;
    title: string;
  };
  /**
   * Optional admin Edit link. When set, an Edit button renders in
   * the header next to Notes — same affordance the apply-flow
   * `SectionShell` exposes — so admin can jump into a per-section
   * editor route to amend the registration packet data on behalf
   * of the family.
   */
  editHref?: string;
  /**
   * Optional admin section-verify footer config. Same shape as the
   * apply-flow's `SectionConfirmConfig` but renamed to "Verify" for
   * the registration phase to match the user's chosen vocabulary
   * (admin "verifies" registration sections; admin "confirms"
   * application sections).
   */
  verify?: SectionVerifyConfig;
  children: React.ReactNode;
}) {
  const verified = !!verify?.verified;
  const parentCompleted = !!verify?.parentCompleted;
  // Whole-card mute when the family has marked the section
  // complete. Drops opacity on the entire `<Card>` (header + body
  // + footer) rather than only the body so the title / status
  // badge / Edit button all read as part of the same settled
  // state. Mirrors the apply-flow `SectionShell` and the parent
  // flow's "Section Completed" treatment.
  const fullyDone = parentCompleted;
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
            {/* Title status badge — three-state pill mirroring the
                section's verify state at a glance. Same pattern as
                the apply-flow page so admin can scan both surfaces
                identically. */}
            {verify ? (
              verified ? (
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
          {/* Notes + Edit pair docked right of the header — same
              affordance pair the apply-flow SectionShell exposes.
              Notes opens a section-filtered drawer; Edit jumps to
              a per-section editor route under
              `/admin/registrations/[id]/[section]`. */}
          <div className="flex items-center gap-2 shrink-0">
            {notes ? (
              <FamilyNotesSheet
                familyId={notes.familyId}
                section={notes.section}
                title={notes.title}
                phase="registration"
                defaultYearId={notes.yearId}
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
      {verify ? <SectionVerifyFooter verify={verify} /> : null}
    </Card>
  );
}

/**
 * Config for the optional verify footer on `SectionShell`. Mirrors
 * the apply-flow `SectionConfirmConfig` — different verb ("Verify"
 * vs "Confirm") but same audit-pair semantics underneath.
 */
interface SectionVerifyConfig {
  /** Short label used in the action button ("Verify Tuition",
   *  "Verify Enrollment", "Verify Volunteer Hours"). */
  sectionLabel: string;
  verified: boolean;
  /** Whether the parent has marked this section complete on their
   *  side (`isTuition` / `isEnrollment` / `isVolunteerHours`).
   *  Drives the card-body gray-out: we only mute the section when
   *  BOTH the parent has completed it AND admin has verified —
   *  otherwise the gray reads as a premature lock-in. */
  parentCompleted: boolean;
  verifiedTime: number | null;
  verifiedByName: string | null;
  /** Mid-PATCH spinner gate. */
  saving: boolean;
  /** Called with the next desired bool (true → verify, false → undo). */
  onToggle: (next: boolean) => void;
}

/**
 * Footer for `SectionShell` rendering the verify/undo action +
 * audit caption. Two states:
 *   - unverified → single primary "Verify <Section>" button
 *   - verified → muted "Verified" pill + Undo button that opens a
 *     warning modal before clearing the audit. Modal prevents an
 *     accidental click from wiping who/when verified.
 */
function SectionVerifyFooter({ verify }: { verify: SectionVerifyConfig }) {
  const {
    sectionLabel,
    verified,
    verifiedTime,
    verifiedByName,
    saving,
    onToggle,
  } = verify;
  const [undoOpen, setUndoOpen] = useState(false);

  return (
    <div className="border-t bg-white px-5 py-3 flex items-center justify-between gap-3">
      {/* Audit caption slot — skeleton during save so the actual
          "Verified by X · 2 hr ago" text slides in smoothly
          instead of popping on/off across the round-trip. Same
          three-state pattern as the apply-flow footer. */}
      {saving ? (
        <Skeleton className="h-3 w-48" />
      ) : (
        <span className="text-xs text-muted-foreground truncate">
          {verified ? (
            <>
              {verifiedByName ? (
                <>
                  Verified by{" "}
                  <span className="font-medium text-foreground">
                    {verifiedByName}
                  </span>
                </>
              ) : (
                "Verified"
              )}
              {verifiedTime ? (
                <span> · {formatNoteTimestamp(verifiedTime)}</span>
              ) : null}
            </>
          ) : null}
        </span>
      )}
      {verified ? (
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
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={() => onToggle(true)}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="size-3.5 mr-1.5 animate-spin" />
          ) : (
            <CheckCircle2 className="size-3.5 mr-1.5" />
          )}
          Verify {sectionLabel}
        </Button>
      )}
    </div>
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

/* ─────────────────────── Disabled-field primitives ─────────────────────── */

function valueIsEmpty(v: string | number | null | undefined): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return v === 0;
  const s = v.trim();
  return s === "" || s === "—" || s === "0" || s === "$0" || s === "$0.00";
}

/**
 * Read-only `<Input>` rendered as a real form field — same affordance
 * the apply-flow detail page uses, so admin sees consistent UI on
 * both surfaces. `required` flags missing data with a red border so
 * an in-progress packet is glance-able.
 */
function DisabledField({
  label,
  value,
  type = "text",
  placeholder,
  required,
}: {
  label?: string;
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
            <span className="ml-1 text-red-500" aria-label="required">
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
      <FieldLabel className="text-xs">
        {label}
        {required ? (
          <span className="ml-1 text-red-500" aria-label="required">
            *
          </span>
        ) : null}
      </FieldLabel>
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

/* ─────────────────────── Tuition block ─────────────────────── */

function TuitionBlock({
  progress,
  schoolYear,
}: {
  progress: AdminFamilyRegistrationResponse["progress"];
  schoolYear: AdminFamilyRegistrationResponse["school_year"];
}) {
  const monthlyTuition = progress?.monthly_tuition_payment ?? 0;
  const monthlyTransport = progress?.monthly_transportation_payment ?? 0;
  const printedName = progress?.name ?? "";

  return (
    <div className="rounded-md border bg-muted/10 p-4 space-y-5">
      <SectionGroup title="Monthly Snapshot">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          <DisabledField
            label="School Year"
            value={schoolYear.year_name || ""}
            placeholder="—"
          />
          <DisabledField
            label="Monthly Tuition"
            value={`$${monthlyTuition.toLocaleString()}`}
          />
          <DisabledField
            label="Monthly Transportation"
            value={`$${monthlyTransport.toLocaleString()}`}
          />
        </div>
      </SectionGroup>
      <SectionGroup title="Acknowledgement">
        <div className="grid gap-4 grid-cols-1">
          <DisabledField
            label="Printed name"
            value={printedName}
            placeholder="—"
            required
          />
          <SignaturePreview
            label="Signature"
            signature={
              progress?.tuition_scholarship_signature ?? progress?.signature_data ?? null
            }
          />
        </div>
      </SectionGroup>
    </div>
  );
}

/* ─────────────────────── Enrollment Agreement block ─────────────────────── */

function EnrollmentAgreementBlock({
  progress,
}: {
  progress: AdminFamilyRegistrationResponse["progress"];
}) {
  const pdId = progress?.enrollment_agreement_pandadoc_id ?? "";
  const pdStatus = progress?.enrollment_agreement_status ?? "";
  const pdSent = progress?.enrollment_agreement_sent;
  const pdfUrl = progress?.enrollment_agreement_pdf_url ?? "";
  const isSigned = !!progress?.is_enrollment_agreement_signed;
  // Printed name on the enrollment agreement reuses the family-level
  // `name` field on the progress row; the parent flow writes both
  // simultaneously when they sign on /enrollment-signing.
  const printedName = progress?.name ?? "";

  return (
    <div className="rounded-md border bg-muted/10 p-4 space-y-5">
      <SectionGroup title="PandaDoc">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          <DisabledField
            label="Status"
            value={
              isSigned
                ? "Signed"
                : pdStatus
                  ? formatPdStatus(pdStatus)
                  : ""
            }
            placeholder="Not sent"
          />
          <DisabledField label="Sent" value={formatTimestamp(pdSent)} />
          <DisabledField
            label="Document ID"
            value={pdId}
            placeholder="—"
          />
        </div>
      </SectionGroup>
      <SectionGroup title="Acknowledgement">
        <div className="grid gap-4 grid-cols-1">
          <DisabledField
            label="Printed name"
            value={printedName}
            placeholder="—"
            required={isSigned}
          />
          <SignaturePreview
            label="Signature"
            signature={progress?.signature_data ?? null}
          />
        </div>
      </SectionGroup>
      {/* Inline PDF preview when signed — admin can scan the
          completed agreement without leaving the page. We embed
          via `<iframe>` (rather than `<object>` / `<embed>`) so the
          browser's built-in PDF viewer renders consistently across
          Chromium and Safari. Falls back to a simple link when the
          URL isn't yet populated. */}
      {pdfUrl ? (
        <SectionGroup title="Signed PDF">
          <div className="space-y-2">
            <div className="rounded-md border bg-white overflow-hidden">
              <iframe
                src={pdfUrl}
                className="w-full h-[640px]"
                title="Enrollment agreement"
              />
            </div>
            <div className="flex justify-end">
              <Button asChild variant="outline" size="sm" className="bg-white">
                <a href={pdfUrl} target="_blank" rel="noreferrer">
                  Open in new tab
                  <ExternalLink className="size-3.5 ml-1.5" />
                </a>
              </Button>
            </div>
          </div>
        </SectionGroup>
      ) : null}
    </div>
  );
}

/* ─────────────────────── Registration Packet block ─────────────────────── */

function RegistrationPacketBlock({
  students,
  emergencyContacts,
  onChanged,
}: {
  students: AdminFamilyRegistrationStudentRow[];
  emergencyContacts: XanoEmergencyContact[];
  onChanged: () => void;
}) {
  if (students.length === 0) {
    return (
      <div className="rounded-md border bg-muted/10 p-4 text-sm text-muted-foreground">
        No active students for this year.
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {students.map((row) => (
        <StudentPacketBlock
          key={row.student_id}
          row={row}
          onChanged={onChanged}
        />
      ))}
      {/* Emergency contacts are family-scoped, not per-student, so
          they live in their own block beneath the student cards
          rather than being duplicated under each one. */}
      <EmergencyContactsBlock contacts={emergencyContacts} />
    </div>
  );
}

const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const SWIM_LEVELS = ["None", "Beginner", "Intermediate", "Advanced"];

function StudentPacketBlock({
  row,
  onChanged,
}: {
  row: AdminFamilyRegistrationStudentRow;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const packet = row.packet;
  const hasPacket = packet != null;
  // Admin verification lives on the per-packet
  // `registration_student_registration` row — `registrationConfirmed`
  // bool plus the audit pair `registration_confirmed_admin_time` and
  // `regisration_admin_confirmed_admin` (typo on the column name
  // intentional, matches Xano). Re-enrolling students get a fresh
  // verify state per year since each year creates its own packet.
  // The detail API surfaces these on the row's `is_verified*` fields
  // so the UI can stay agnostic about which table they live in.
  const verified = row.is_verified === true;
  const verifiedTime = row.is_admin_verified_time ?? null;
  const verifiedByName = row.is_admin_verified_admin?.trim() || null;

  async function toggleVerified(next: boolean) {
    if (!packet) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/student-registration/${packet.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationConfirmed: next }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Update failed (${res.status})`);
      }
      toast.success(
        next
          ? `${row.student_full_name} verified.`
          : `${row.student_full_name} verification cleared.`
      );
      onChanged();
    } catch (err) {
      console.error("[StudentPacketBlock.toggleVerified]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't update.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-md border bg-muted/10 overflow-hidden transition-opacity",
        // Whole-card mute when admin has verified AND the packet
        // exists. Drops opacity on the entire student block — header
        // + body + footer — so the verified state reads as one
        // settled unit. Footer Undo button stays clickable; opacity
        // dims it visually but doesn't disable.
        verified && hasPacket && "opacity-60"
      )}
    >
      <div className="p-4 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold truncate">
            {row.student_full_name}
          </p>
          {/* Three-state title badge mirroring the section cards
              elsewhere — green Verified pill when verified, amber
              Needs Verification pill otherwise. Gives admin a
              skim-the-page sense of which students are still
              pending. */}
          {verified ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800">
              <CheckCircle2 className="size-2.5" />
              Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-800">
              Needs Verification
            </span>
          )}
        </div>
        {!hasPacket ? (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground shrink-0">
            Not started
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {row.student_grade ? `Grade ${row.student_grade}` : "—"}
        {row.student_date_of_birth
          ? ` · DOB ${row.student_date_of_birth}`
          : ""}
      </p>

      {!hasPacket ? (
        <p className="text-sm text-muted-foreground">
          The family hasn&rsquo;t opened this packet yet. Check back once
          they&rsquo;ve started filling out the registration page.
        </p>
      ) : (
        <>
          {/* ── Uniform & Activities ──────────────────────────────
              Mirrors the parent flow's `Uniform & Activities`
              section header + 3-col grid so the admin view reads
              as the same form the parent filled out. */}
          <SectionGroup title="Uniform & Activities">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
              <DisabledField
                label="Shirt Size"
                value={packet ? formatChoice(packet.shirt_size, SHIRT_SIZES) : ""}
                required
              />
              <DisabledField
                label="Pant Size"
                value={packet?.pant_size ?? ""}
                required
              />
              <DisabledField
                label="Swim Level"
                value={packet ? formatChoice(packet.swim_level, SWIM_LEVELS) : ""}
                required
              />
            </div>
          </SectionGroup>

          <Separator />

          {/* ── Required Documents ──────────────────────────────── */}
          <SectionGroup title="Required Documents *">
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <FilePreviewRow
                label="Birth Certificate"
                file={packet?.birth_certificate}
                required
              />
              <FilePreviewRow
                label="School Health Form"
                file={packet?.school_health_form}
                required
              />
              <FilePreviewRow
                label="Transcripts"
                file={packet?.transcripts}
                required
              />
              <FilePreviewRow
                label="Immunization Forms"
                file={packet?.immunization_forms}
                required
              />
            </div>
          </SectionGroup>

          <Separator />

          {/* ── Optional Documents ──────────────────────────────── */}
          <SectionGroup title="Optional Documents">
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <FilePreviewRow label="IEP" file={packet?.iep} />
              <FilePreviewRow label="SSN Card" file={packet?.ssn_card} />
              <FilePreviewRow label="Passport" file={packet?.passport} />
              <FilePreviewRow
                label="Student State ID"
                file={packet?.student_state_id}
              />
            </div>
          </SectionGroup>

          <Separator />

          {/* ── Health & Medical ────────────────────────────────── */}
          <SectionGroup title="Health & Medical">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <DisabledField
                label="On Medicaid"
                value={
                  packet?.is_student_on_medicaid === true ? "Yes" : "No"
                }
              />
              <DisabledField
                label="Medicaid Provider"
                value={packet?.medicaid_provider ?? ""}
              />
              <DisabledField
                label="Medicaid #"
                value={
                  packet?.medicaid_number ? String(packet.medicaid_number) : ""
                }
              />
              <DisabledField
                label="Carries EpiPen"
                value={packet?.carry_epi_pen === true ? "Yes" : "No"}
              />
            </div>
            {/* Medical narrative fields — 2-col on sm+ so the
                textareas don't stack into a single tall column.
                Most fields read as "none" / short notes in
                practice, so two-up scans cleanly. */}
            <div className="mt-3 grid gap-4 grid-cols-1 sm:grid-cols-2">
              <DisabledTextarea
                label="Allergies"
                value={packet?.allergies ?? ""}
              />
              <DisabledTextarea
                label="Dietary restrictions"
                value={packet?.dietary_restrictions ?? ""}
              />
              <DisabledTextarea
                label="Prescription medications"
                value={packet?.prescription_medications ?? ""}
              />
              <DisabledTextarea
                label="Health conditions"
                value={packet?.health_conditions ?? ""}
              />
              <DisabledTextarea
                label="Vision impairments"
                value={packet?.vision_impairments ?? ""}
              />
              <DisabledTextarea
                label="Hearing impairments"
                value={packet?.hearing_impairments ?? ""}
              />
              <DisabledTextarea
                label="EpiPen explainer"
                value={packet?.epipen_explainer ?? ""}
              />
              <DisabledTextarea
                label="Permission for acetaminophen"
                value={packet?.permission_for_acetaminophen ?? ""}
              />
              <DisabledTextarea
                label="Additional health information"
                value={packet?.additional_health_information ?? ""}
              />
              <DisabledTextarea
                label="Interested in counseling services"
                value={packet?.interested_in_counseling_services ?? ""}
              />
              <DisabledTextarea
                label="IEP description"
                value={packet?.iep_description ?? ""}
              />
            </div>
          </SectionGroup>

          <Separator />

          {/* ── Pickup Permissions ──────────────────────────────── */}
          <SectionGroup title="Pickup Permissions">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <DisabledTextarea
                label="Other adults approved for pickup"
                value={packet?.other_adults_approved_for_pickup ?? ""}
              />
              <DisabledTextarea
                label="Prohibited adults"
                value={packet?.prohibited_adults ?? ""}
              />
            </div>
          </SectionGroup>

          <Separator />

          <SectionGroup title="Liability Waiver">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
              <DisabledField
                label="Status"
                value={
                  packet?.liability_waiver_status
                    ? formatPdStatus(packet.liability_waiver_status)
                    : ""
                }
                placeholder="Not sent"
              />
              <DisabledField
                label="Sent"
                value={
                  packet?.liability_waiver_sent_at
                    ? formatTimestamp(packet.liability_waiver_sent_at)
                    : "—"
                }
              />
              <DisabledField
                label="Document ID"
                value={packet?.liability_waiver_pandadoc_id ?? ""}
                placeholder="—"
              />
            </div>
            {packet?.liability_waiver_pdf_url ? (
              <div className="mt-3 space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Signed PDF
                </p>
                <div className="rounded-md border bg-white overflow-hidden">
                  <iframe
                    src={packet.liability_waiver_pdf_url}
                    className="w-full h-[480px]"
                    title={`Liability waiver — ${row.student_full_name}`}
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="bg-white"
                  >
                    <a
                      href={packet.liability_waiver_pdf_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open in new tab
                      <ExternalLink className="size-3.5 ml-1.5" />
                    </a>
                  </Button>
                </div>
              </div>
            ) : null}
          </SectionGroup>
        </>
      )}
      </div>

      {/* Verify footer — divider + audit caption on left, action
          on right. Mirrors the SectionShell verify footer pattern
          so per-student review reads identically to per-section
          review. Wired to the new `is_verified` flag on the student
          row (not the per-packet `registrationConfirmed` flag).
          The Undo button opens a warning modal so the audit stamp
          can't be wiped accidentally. */}
      <div className="border-t bg-white px-4 py-3 flex items-center justify-between gap-3">
        {/* Audit caption slot — skeleton during save so the
            "Verified by X · 2 hr ago" line doesn't pop on/off as
            the per-student verify PATCH round-trips. Same pattern
            as the section-shell footers above. */}
        {saving ? (
          <Skeleton className="h-3 w-48" />
        ) : (
          <span className="text-xs text-muted-foreground truncate">
            {verified ? (
              <>
                {verifiedByName ? (
                  <>
                    Verified by{" "}
                    <span className="font-medium text-foreground">
                      {verifiedByName}
                    </span>
                  </>
                ) : (
                  "Verified"
                )}
                {verifiedTime ? (
                  <span> · {formatNoteTimestamp(verifiedTime)}</span>
                ) : null}
              </>
            ) : null}
          </span>
        )}
        {verified ? (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled
              className="bg-muted text-muted-foreground cursor-default disabled:opacity-100"
            >
              <CheckCircle2 className="size-3.5 mr-1.5" />
              {row.student_full_name} Verified
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
              Undo
            </Button>
            <AlertDialog open={undoOpen} onOpenChange={setUndoOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Undo verification for {row.student_full_name}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This clears the admin verification on{" "}
                    {row.student_full_name}&rsquo;s registration. The
                    audit stamp (who and when) will be removed and
                    the student drops back to pending review. You
                    can re-verify at any time.
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
                      toggleVerified(false);
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
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => toggleVerified(true)}
            disabled={saving || !hasPacket}
            title={
              hasPacket
                ? `Verify ${row.student_full_name}'s registration`
                : "The family hasn't started this student's packet yet."
            }
          >
            {saving ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5 mr-1.5" />
            )}
            Verify {row.student_full_name} Registration
          </Button>
        )}
      </div>
    </div>
  );
}

function EmergencyContactsBlock({
  contacts,
}: {
  contacts: XanoEmergencyContact[];
}) {
  return (
    <div className="rounded-md border bg-muted/10 p-4 space-y-4">
      <p className="text-sm font-semibold">Emergency Contacts</p>
      {contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No emergency contacts on file for this family.
        </p>
      ) : (
        <div className="space-y-4">
          {contacts.map((c) => (
            <div
              key={c.id}
              className="rounded-md border bg-white p-3 space-y-3"
            >
              <p className="text-sm font-medium">
                {`${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() ||
                  `Contact #${c.id}`}
                {c.relationship ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    · {c.relationship}
                  </span>
                ) : null}
              </p>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                <DisabledField label="Email" value={c.email} type="email" />
                <DisabledField label="Phone" value={c.phone} />
              </div>
              <div className="grid gap-3 grid-cols-1">
                <DisabledField
                  label="Street address"
                  value={c.address_line_1}
                />
                {c.address_line_2 ? (
                  <DisabledField label="Apt / suite" value={c.address_line_2} />
                ) : null}
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                  <DisabledField label="City" value={c.city} />
                  <DisabledField label="State" value={c.state} />
                  <DisabledField label="Zip" value={c.zipcode} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── Volunteer Hours block ─────────────────────── */

function VolunteerHoursBlock({
  progress,
}: {
  progress: AdminFamilyRegistrationResponse["progress"];
}) {
  const printedName = progress?.name_volunteer ?? "";
  const sig =
    progress?.signature_data_volunteer ??
    progress?.volunteer_signature_data ??
    null;
  return (
    <div className="rounded-md border bg-muted/10 p-4 space-y-5">
      <SectionGroup title="Acknowledgement">
        <div className="grid gap-4 grid-cols-1">
          <DisabledField
            label="Printed name"
            value={printedName}
            placeholder="—"
            required
          />
          <SignaturePreview label="Signature" signature={sig} />
        </div>
      </SectionGroup>
    </div>
  );
}

/* ─────────────────────── File / signature primitives ─────────────────────── */

interface XanoFileMetadata {
  url?: string;
  path?: string;
  mime?: string;
  name?: string;
}

/**
 * Resolve a viewable URL for a Xano file metadata blob. Prefers the
 * explicit `url` Xano sometimes emits; falls back to building one
 * from the `path`. Mirrors the helper in
 * `documents-to-review-block.tsx` so file behavior is consistent
 * across admin surfaces.
 */
function fileViewUrl(file: unknown): string | null {
  if (!file || typeof file !== "object") return null;
  const f = file as XanoFileMetadata;
  if (typeof f.url === "string" && f.url.length > 0) return f.url;
  if (typeof f.path === "string" && f.path.startsWith("/")) {
    return `${xanoBase}${f.path}`;
  }
  return null;
}

function FilePreviewRow({
  label,
  file,
  required,
}: {
  label: string;
  file: unknown;
  required?: boolean;
}) {
  const url = fileViewUrl(file);
  const isMissing = required && !url;
  return (
    <div className="space-y-1">
      <p className="text-xs">
        {label}
        {required ? (
          <span className="ml-1 text-red-500" aria-label="required">
            *
          </span>
        ) : null}
      </p>
      <div
        className={cn(
          "flex items-center justify-between gap-2 rounded-md border bg-white px-3 py-2 text-xs",
          isMissing ? "border-red-500" : "border-input"
        )}
      >
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-blue-600 hover:underline truncate"
          >
            View file
            <ExternalLink className="size-3" />
          </a>
        ) : (
          <span className="text-muted-foreground">Not uploaded</span>
        )}
      </div>
    </div>
  );
}

/**
 * Inline signature preview — renders the image when Xano stores it as
 * a vault file (most common shape: `{ url, path, mime, ... }`),
 * otherwise drops to a textual "On file" / "Not signed" indicator
 * inside a `DisabledField`. Either way, the field is labeled the
 * same way as the rest of the form so admin can scan straight down
 * the page.
 */
function SignaturePreview({
  label,
  signature,
}: {
  label: string;
  signature: Record<string, unknown> | null | undefined;
}) {
  const url = fileViewUrl(signature);
  if (url) {
    return (
      <Field>
        <FieldLabel className="text-xs">{label}</FieldLabel>
        <div className="rounded-md border bg-white p-3">
          {/* `<img>` rather than `next/image` because Xano vault URLs
              aren't on the configured remote-image whitelist. The
              signature is small + already cached behind the vault
              CDN, so the loss of next/image optimization is fine. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`${label} preview`}
            className="max-h-24 object-contain"
          />
        </div>
      </Field>
    );
  }
  return (
    <DisabledField
      label={label}
      value={signature ? "On file" : ""}
      placeholder="Not signed"
    />
  );
}

/* ─────────────────────── Format helpers ─────────────────────── */

function formatPdStatus(status: string): string {
  const cleaned = status.replace(/^document\./, "").replace(/_/g, " ");
  if (!cleaned) return status;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatTimestamp(value: string | number | null | undefined): string {
  if (!value) return "—";
  const ts = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ts)) return "—";
  return new Date(ts).toLocaleString();
}

/**
 * Display helper — Xano stores choice fields as raw strings (the
 * lower-case key the parent form posted). When the canonical option
 * list uses Title Case (e.g. "Beginner") we surface the canonical
 * spelling; otherwise pass through whatever's stored. Unknown values
 * still render so admin can spot data drift instead of swallowing
 * it.
 */
function formatChoice(
  value: string | null | undefined,
  options: readonly string[]
): string {
  if (!value) return "";
  const exact = options.find((o) => o === value);
  if (exact) return exact;
  const ci = options.find((o) => o.toLowerCase() === value.toLowerCase());
  return ci ?? value;
}
