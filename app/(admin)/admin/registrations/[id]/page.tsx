"use client";

import { Fragment, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  Archive as ArchiveIcon,
  Check,
  CheckCircle2,
  Circle,
  ExternalLink,
  FileText,
  FileUp,
  HelpCircle,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  SquarePen,
  Undo2,
  X,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
} from "@/components/ui/file-upload";
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
import { FamilyNotesSheet } from "@/components/admin/family-notes-sheet";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import {
  formatNoteTimestamp,
  formatRelativeShort,
} from "@/lib/format-note-time";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  AdminFamilyRegistrationResponse,
  AdminFamilyRegistrationStudentRow,
} from "@/app/api/admin/registrations/[id]/route";
import type {
  XanoEmergencyContact,
  XanoFamilyPayment,
  XanoStudentRegistration,
  XanoStudentRegistrationProgress,
} from "@/lib/xano";

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

  // Family-payment row — the canonical source for the Tuition
  // card values (monthly_tuition_payment, annual_fee_total,
  // transportation_total, sufs_total, printed name, signature).
  // Fetched separately because it lives on the apply-flow side of
  // the data model (one row per family-year, written when admin
  // accepts), while the registration-progress row above carries
  // its own legacy copies that were drifting from the source. The
  // fetch is parallel to the main detail SWR so the page doesn't
  // wait sequentially.
  const familyPaymentKey =
    Number.isFinite(familyId) && yearId
      ? `/api/admin/registration-families-payment-by-family?familyId=${familyId}&yearId=${yearId}`
      : null;
  const { data: familyPayment, mutate: mutateFamilyPayment } =
    useSWR<XanoFamilyPayment | null>(familyPaymentKey, adminFetcher);

  // Tracks which section is mid-PATCH so the spinner inside that
  // section's verify footer is scoped — clicking Verify on Tuition
  // doesn't gray out Enrollment's button.
  const [savingSection, setSavingSection] = useState<
    | "tuition"
    | "enrollment"
    | "registration"
    | "volunteer"
    | "emergency_contacts"
    | null
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

  const {
    family,
    primary,
    school_year,
    progress,
    students,
    emergency_contacts,
  } = data;
  // `scholarship` is a newer addition to the response shape, so
  // tolerate a cached payload that was fetched before the API
  // update landed (dev hot-reload, stale SWR cache from an open
  // tab). Default to the all-false shape — equivalent to "no
  // scholarship row on file," which is the conservative read.
  const scholarship: AdminFamilyRegistrationResponse["scholarship"] =
    data.scholarship ?? {
      isOpportunityScholarship: false,
      isSNAPBenefits: false,
      isNotParticipating: false,
      is_snap_confirmed: false,
    };
  const familyName =
    family?.family_name?.trim() || `Family #${family?.id ?? familyId}`;

  const refresh = () => {
    void mutate();
    // Pull the family-payment row alongside the main detail
    // refetch — admin actions that touch tuition / fees re-emit
    // both SWR caches in one shot so the Tuition card never lags
    // the rest of the page.
    void mutateFamilyPayment();
  };

  // Page-level registration-confirmed latch. Once admin has flipped
  // `isRegistrationConfirmed` from the Family Registration
  // Confirmation card, every section's Undo affordance freezes —
  // admin has to revoke the registration confirmation first before
  // they can step back into any section to amend its verification.
  // Mirrors the acceptance-gate pattern on the apply-flow detail
  // page.
  const pageRegistrationConfirmed =
    progress?.isRegistrationConfirmed === true;
  const unverifyLockedConfig = pageRegistrationConfirmed
    ? {
        unverifyLocked: true as const,
        unverifyLockedReason:
          "Revoke registration confirmation above before undoing.",
      }
    : {};

  // Builder for the per-section editor route. Mirrors the
  // `sectionHref` helper on the apply-flow page so the Edit button
  // on each registration section card opens the matching editor at
  // `/admin/registrations/[familyId]/[section]?yearId=X`.
  const regSectionHref = (slug: string) =>
    `/admin/registrations/${family?.id ?? familyId}/${slug}${
      yearId ? `?yearId=${yearId}` : ""
    }`;

  // Per-section completion state — drives the green/amber dot in
  // the side nav AND the colored status dot in each `SectionShell`
  // header. `completed` is the parent-side "section done" signal;
  // `verified` is the admin-confirm rollup. The side nav renders
  // BOTH independently — main circle for parent state, trailing
  // checkmark for admin verify — so admin can scan two signals at
  // a glance the same way the apply-flow page nav does.
  const sectionStatus = {
    tuition: {
      completed: !!progress?.isTuition,
      verified: progress?.tuition_admin_confirm === true,
    },
    enrollment: {
      completed: !!progress?.isEnrollment,
      verified: progress?.enrollment_admin_confirm === true,
    },
    // Registration completion = every active student has a packet
    // started. Admin verify = the family-level
    // `is_registration_admin_confirm` flag is set — distinct from
    // the per-student `registrationConfirmed` flags below, which
    // each track their own verify state on the per-student card.
    // The family-level verify is admin's "I've reviewed the whole
    // section" pin; the per-student verifies are the deeper "this
    // student's packet specifically is good" stamps. Both signals
    // surface independently in the nav.
    registration: {
      completed:
        students.length > 0 && students.every((s) => !!s.packet),
      verified: progress?.is_registration_admin_confirm === true,
    },
    // Emergency contacts has no parent-completion bool — it's
    // evergreen family data. Treat "completed" as "at least one
    // contact on file" so the parent's side has something
    // meaningful to flip green. Admin verify is the separate
    // signal.
    emergency_contacts: {
      completed: emergency_contacts.length > 0,
      verified: progress?.emergency_contacts_admin_confirm === true,
    },
    volunteer: {
      completed: !!progress?.isVolunteerHours,
      verified: progress?.volunteer_admin_confirm === true,
    },
    // Family-level Confirmation card status — green once the
    // family-level latch is flipped via the Confirm Registration
    // button on the card. Admin-only row, so there's no separate
    // verify trailing check (the main circle IS the verify state).
    confirmation: {
      completed: progress?.isRegistrationConfirmed === true,
      verified: null as boolean | null,
    },
  };

  // Per-section verify state — wraps the admin registration-progress
  // PATCH so each section's footer can flip its bool with one call.
  // Tracks the in-flight section locally so the spinner is scoped to
  // whichever section admin clicked. The audit name lives directly
  // on the row's `*_admin_confirm_admin` string column — no lookup
  // needed.
  const verifyToggle = (
    field:
      | "tuition_admin_confirm"
      | "enrollment_admin_confirm"
      | "is_registration_admin_confirm"
      | "volunteer_admin_confirm"
      | "emergency_contacts_admin_confirm",
    next: boolean,
    section:
      | "tuition"
      | "enrollment"
      | "registration"
      | "volunteer"
      | "emergency_contacts"
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
            {/* Header carries the cross-surface jump (View
                application) + Notes. View application sits to the
                left so admin's left-to-right reading order goes
                "look back at the apply-flow" → "log a note." The
                destructive Revoke acceptance + Archive affordances
                live on the Confirmation card's footer below
                rather than up here, since they're rarer and
                belong with the rest of the family-level decision
                actions. */}
            <Button asChild variant="outline" size="sm" className="bg-white">
              <Link
                href={`/admin/families/${family?.id ?? familyId}?yearId=${yearId}`}
              >
                <ExternalLink className="size-3.5 mr-1.5" />
                View application
              </Link>
            </Button>
            {/* Page-header notes drawer is phase-scoped — hits the
                dedicated `..._by_registration` Xano query so admin
                only sees registration-phase comms by default, not
                the full apply-phase backlog. */}
            <FamilyNotesSheet
              familyId={Number(family?.id ?? familyId)}
              defaultYearId={Number(yearId)}
              phase="registration"
            />
          </div>
        </div>

        {/* Family Registration Confirmation — the rollup latch.
            Sits at the TOP of the page (same pattern as Acceptance
            on the apply-flow detail) so admin lands on the
            family's status + the per-student roster + the family-
            level actions (Revoke / View / Archive / Confirm)
            before scrolling into the per-section work below. */}
        <FamilyRegistrationConfirmationCard
          familyId={Number(family?.id ?? familyId)}
          yearId={Number(yearId)}
          familyName={familyName}
          progress={progress}
          students={students}
          onConfirmed={refresh}
        />

        <section id="section-tuition" className="scroll-mt-20">
          <SectionShell
            title="Tuition"
            status={sectionStatus.tuition.completed ? "complete" : "in_progress"}
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
              ...unverifyLockedConfig,
            }}
          >
            <TuitionBlock
              progress={progress}
              schoolYear={school_year}
              familyPayment={familyPayment ?? null}
              tuitionVerified={
                progress?.tuition_admin_confirm === true
              }
              onChanged={refresh}
            />
            {/* Per-student breakdown table — mirrors the same view the
                parent sees on `/dashboard/tuition`. No inputs; pure
                read-only summary so admin can scan exactly what the
                family signed for at the per-student level. SNAP-
                confirmed families get a computed Opportunity
                Scholarship coverage instead of the literal column
                (which is null for them on purpose). */}
            <TuitionBreakdownTable
              students={students}
              schoolYear={school_year}
              scholarship={scholarship}
            />
          </SectionShell>
        </section>

        <section id="section-enrollment" className="scroll-mt-20">
          {/* No Edit affordance — Enrollment Agreement is owned end-
              to-end by PandaDoc (template, signing, returned PDF).
              Editing fields out from under the document workflow
              would desync the PDF on file from the page state, so
              the section stays read-only here. Admin re-sends the
              PandaDoc envelope through its own surface if a
              correction is needed. */}
          <SectionShell
            title="Enrollment Agreement"
            status={sectionStatus.enrollment.completed ? "complete" : "in_progress"}
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
              ...unverifyLockedConfig,
            }}
          >
            <EnrollmentAgreementBlock progress={progress} />
          </SectionShell>
        </section>

        <section id="section-registration" className="scroll-mt-20">
          {/* Two-tier verify on this card:
              - Per-student footer toggle on each `StudentPacketBlock`
                flips `registrationConfirmed` on the packet row
              - Family-level footer toggle here flips
                `is_registration_admin_confirm` — admin's "I've
                reviewed the whole packet section" pin. The
                family-level cascade flips `isRegistration=true` on
                verify so the parent's sidenav reflects the section
                as done. */}
          <SectionShell
            title="Registration Packet"
            status={sectionStatus.registration.completed ? "complete" : "in_progress"}
            notes={{
              familyId: Number(family?.id ?? familyId),
              yearId: Number(yearId),
              section: "section-registration",
              title: "Notes — Registration Packet",
            }}
            verify={{
              sectionLabel: "Registration Packet",
              verified:
                progress?.is_registration_admin_confirm === true,
              parentCompleted:
                sectionStatus.registration.completed,
              verifiedTime:
                progress?.is_registration_admin_confirm_time ?? null,
              verifiedByName:
                progress?.is_registration_admin_confirm_admin?.trim() ||
                null,
              saving: savingSection === "registration",
              onToggle: (next) =>
                verifyToggle(
                  "is_registration_admin_confirm",
                  next,
                  "registration"
                ),
              ...unverifyLockedConfig,
            }}
          >
            <RegistrationPacketBlock
              students={students}
              emergencyContacts={emergency_contacts}
              yearId={Number(yearId)}
              onChanged={refresh}
            />
          </SectionShell>
        </section>

        {/* Emergency contacts get their own SectionShell now — the
            parent column lives in `registration_student_registration_progress`
            as a verify triplet (no parent-completion bool, since
            emergency contacts are evergreen "exists or doesn't"
            data with no in-progress state). Status dot derives
            purely from contact count: green when at least one
            contact exists, red when the family has none on file. */}
        <section id="section-emergency-contacts" className="scroll-mt-20">
          <SectionShell
            title="Emergency Contacts"
            status={
              emergency_contacts.length > 0 ? "complete" : "not_started"
            }
            notes={{
              familyId: Number(family?.id ?? familyId),
              yearId: Number(yearId),
              section: "section-emergency-contacts",
              title: "Notes — Emergency Contacts",
            }}
            verify={{
              sectionLabel: "Emergency Contacts",
              verified:
                progress?.emergency_contacts_admin_confirm === true,
              // No matching `is_*` parent-completion bool exists
              // for this section — admin verify is the only state
              // we track, so `parentCompleted` is always false.
              parentCompleted: false,
              verifiedTime:
                progress?.emergency_contacts_admin_confirm_time ?? null,
              verifiedByName:
                progress?.emergency_contacts_admin_confirm_admin?.trim() ||
                null,
              saving: savingSection === "emergency_contacts",
              onToggle: (next) =>
                verifyToggle(
                  "emergency_contacts_admin_confirm",
                  next,
                  "emergency_contacts"
                ),
              ...unverifyLockedConfig,
            }}
          >
            <EmergencyContactsBlock
              contacts={emergency_contacts}
              familyId={Number(family?.id ?? familyId)}
              onChanged={refresh}
            />
          </SectionShell>
        </section>

        <section id="section-volunteer" className="scroll-mt-20">
          {/* No Edit affordance — Volunteer Hours captures the
              parent's acknowledgment of the volunteer policy via a
              printed name + signature, both written by the parent
              flow's /volunteer-hours page. Admin override would
              defeat the audit (the signature is supposed to be
              the parent's). Verify on the footer is the admin
              affordance here. */}
          <SectionShell
            title="Volunteer Hours"
            status={sectionStatus.volunteer.completed ? "complete" : "in_progress"}
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
              ...unverifyLockedConfig,
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
    tuition: { completed: boolean; verified: boolean };
    enrollment: { completed: boolean; verified: boolean };
    registration: { completed: boolean; verified: boolean };
    emergency_contacts: { completed: boolean; verified: boolean };
    volunteer: { completed: boolean; verified: boolean };
    confirmation: { completed: boolean; verified: boolean | null };
  };
}) {
  const items: Array<{
    key: string;
    label: string;
    href: string;
    complete: boolean;
    /** Trailing admin-verify checkmark state. `null` skips the
     *  indicator entirely (used for admin-only rows where the
     *  main circle IS the verify state — Confirmation today). */
    verified: boolean | null;
    /** When true, the row uses the muted gray-check variant
     *  regardless of `complete`. Used for admin-only rows
     *  (Confirmation) where the parent has no editing role. */
    isAdmin?: boolean;
  }> = [
    {
      // Confirmation moved to the top so admin lands on the
      // family's rollup status first — same spirit as the apply-
      // flow page where Acceptance leads the side nav. Marked
      // `isAdmin` so the circle renders as the muted gray check
      // (no amber square-pen for "parent in progress" — admin
      // owns this section). `verified: null` drops the trailing
      // check since the main circle already conveys this row's
      // state on its own.
      key: "confirmation",
      label: "Confirmation",
      href: "#section-confirmation",
      complete: sectionStatus.confirmation.completed,
      verified: null,
      isAdmin: true,
    },
    {
      key: "tuition",
      label: "Tuition",
      href: "#section-tuition",
      complete: sectionStatus.tuition.completed,
      verified: sectionStatus.tuition.verified,
    },
    {
      key: "enrollment",
      label: "Enrollment Agreement",
      href: "#section-enrollment",
      complete: sectionStatus.enrollment.completed,
      verified: sectionStatus.enrollment.verified,
    },
    {
      key: "registration",
      label: "Registration",
      href: "#section-registration",
      complete: sectionStatus.registration.completed,
      verified: sectionStatus.registration.verified,
    },
    {
      key: "emergency_contacts",
      label: "Emergency Contacts",
      href: "#section-emergency-contacts",
      complete: sectionStatus.emergency_contacts.completed,
      verified: sectionStatus.emergency_contacts.verified,
    },
    {
      key: "volunteer",
      label: "Volunteer Hours",
      href: "#section-volunteer",
      complete: sectionStatus.volunteer.completed,
      verified: sectionStatus.volunteer.verified,
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
              <NavCircle complete={item.complete} isAdmin={item.isAdmin} />
              <span
                className={cn(
                  "flex-1 truncate",
                  // Admin rows render in the muted color regardless
                  // of completion — the gray circle + gray label
                  // matches the "admin-owned chrome" visual the
                  // apply-flow nav uses for Acceptance / Scholarship.
                  item.isAdmin
                    ? "font-medium text-muted-foreground"
                    : item.complete
                      ? "font-semibold text-foreground"
                      : "font-medium text-muted-foreground"
                )}
              >
                {item.label}
              </span>
              {/* Trailing admin-verify check — rendered when the
                  row carries a `verified` bool (parent-facing
                  sections). Admin-only rows pass `null` and the
                  indicator drops out so the row stays clean.
                  Pixel-aligned with the apply-flow nav so admin
                  sees the same "is this verified" signal on both
                  surfaces. */}
              {item.verified !== null ? (
                <CheckCircle2
                  className={cn(
                    "size-4 shrink-0",
                    item.verified
                      ? "text-emerald-600"
                      : "text-muted-foreground/30"
                  )}
                  aria-label={
                    item.verified
                      ? "Admin verified"
                      : "Awaiting admin verification"
                  }
                />
              ) : null}
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
 *
 * `isAdmin` flips the not-yet-complete state from the amber
 * square-pen ("parent has work to do") to a muted gray check
 * ("admin hasn't acted yet"). Used for admin-owned rows like
 * Confirmation where the parent isn't actively editing anything —
 * the amber square-pen would imply edit-in-progress, which doesn't
 * apply. The same muted gray check applies to the resolved state
 * too: the row stays understated even after admin acts, since the
 * Confirmation card is the page's chrome rather than its primary
 * work surface.
 */
function NavCircle({
  complete,
  isAdmin,
}: {
  complete: boolean;
  isAdmin?: boolean;
}) {
  if (isAdmin) {
    return (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground/60 border border-muted-foreground/20">
        <Check className="size-4" />
      </div>
    );
  }
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
  // Mute kicks in only when admin has *verified* the section. The
  // parent flipping their completion bool isn't enough — that's
  // still pending review on our side, and a premature gray-out
  // reads as "this is settled" before admin has actually looked.
  //
  // Opacity is scoped to the *body* only — the header (Notes /
  // Edit / status pill) and footer (Verified pill + Undo button)
  // stay at full opacity so the verified-state controls remain
  // clearly readable and clickable. Mirrors the apply-flow
  // SectionShell.
  const fullyDone = verified;
  // Parent-completion is still surfaced via the status dot so
  // admin can see in-progress vs done at a glance; reference it
  // here to keep the prop on the API even though we no longer
  // mute on it.
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
              `/admin/registrations/[id]/[section]`. Once the
              section is verified, both are disabled — same audit
              treatment as the apply-flow SectionShell. */}
          <div className="flex items-center gap-2 shrink-0">
            {notes ? (
              <FamilyNotesSheet
                familyId={notes.familyId}
                section={notes.section}
                title={notes.title}
                phase="registration"
                defaultYearId={notes.yearId}
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
  /** When true, the Undo affordance on the verified-state footer is
   *  disabled — admin can't unverify the section until they revoke
   *  the family's registration confirmation first. Mirrors the
   *  acceptance-gate pattern on the apply-flow detail page. */
  unverifyLocked?: boolean;
  unverifyLockedReason?: string;
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
    unverifyLocked,
    unverifyLockedReason,
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
              {/* Lock caption — appended to the audit line when
                  admin can't currently Undo (typically because the
                  family is registration-confirmed and must be
                  revoked first). */}
              {unverifyLocked && unverifyLockedReason ? (
                <span> · {unverifyLockedReason}</span>
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
          // Bump to h-10 so DisabledField, FilePreviewRow, and
          // FilePreviewGroup all sit on the same baseline height.
          // Shadcn's default Input is h-9 which sat ~4px shorter
          // than the file boxes, making the form read as
          // mismatched.
          "h-10 disabled:opacity-100 disabled:bg-white disabled:cursor-default",
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

/* ─────────────────────── Inline-edit primitives ─────────────────────── */

/**
 * Editable counterparts to `DisabledField` / `DisabledTextarea`.
 * Used inside the per-student packet edit mode so the layout grid
 * doesn't shift when admin toggles between read and edit — same
 * label rhythm, same input height, just swapping in real input /
 * textarea / select controls.
 *
 * Kept small and local to this page (rather than promoting to
 * `components/ui/`) because they share the field-label conventions
 * specific to this admin surface. If a third surface picks up the
 * same pattern, hoist them then.
 */
function PacketEditInput({
  label,
  value,
  onChange,
  type = "text",
  disabled,
  required,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  type?: string;
  disabled?: boolean;
  required?: boolean;
}) {
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
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-10"
      />
    </Field>
  );
}

function PacketEditSelect({
  label,
  value,
  onChange,
  options,
  disabled,
  required,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly string[];
  disabled?: boolean;
  required?: boolean;
}) {
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
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-full h-10">
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function PacketEditTextarea({
  label,
  value,
  onChange,
  disabled,
  required,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  required?: boolean;
}) {
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
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="min-h-[80px]"
      />
    </Field>
  );
}

/* ─────────────────────── Tuition block ─────────────────────── */

/**
 * Draft shape for the inline tuition editor — string-typed mirror
 * of the four editable amount columns on the family-payment row.
 * Empty string means "admin cleared the field"; we coerce back to
 * `null` (transport, sufs) or `0` (monthly, admin fee) on save
 * depending on the column's semantics. School Year and Family
 * Accepted stay read-only — School Year is a derived display
 * value, and Family Accepted has its own latch path through the
 * Acceptance card on the apply-flow page.
 */
type TuitionDraft = {
  monthly_tuition_payment: string;
  annual_fee_total: string;
  transportation_total: string;
  sufs_total: string;
};

function paymentToTuitionDraft(
  p: XanoFamilyPayment | null
): TuitionDraft {
  const fmt = (n: number | null | undefined): string =>
    n === null || n === undefined ? "" : String(n);
  return {
    monthly_tuition_payment: fmt(p?.monthly_tuition_payment),
    annual_fee_total: fmt(p?.annual_fee_total),
    transportation_total: fmt(p?.transportation_total),
    sufs_total: fmt(p?.sufs_total),
  };
}

function TuitionBlock({
  progress,
  schoolYear,
  familyPayment,
  tuitionVerified,
  onChanged,
}: {
  progress: AdminFamilyRegistrationResponse["progress"];
  schoolYear: AdminFamilyRegistrationResponse["school_year"];
  /** Canonical family-payment row for the (family, year). All
   *  dollar figures + the printed name + the captured signature
   *  read from here so the Tuition card reflects what admin
   *  approved on the apply-flow Acceptance card. `null` when no
   *  row has been snapshotted yet (pre-acceptance families) — the
   *  card falls back to em dashes / `$0` in that case. */
  familyPayment: XanoFamilyPayment | null;
  /** When true, admin has verified the Tuition section. The Edit
   *  button is disabled — same audit treatment the SectionShell
   *  uses for the verified-state Edit affordance: admin Undoes the
   *  verify on the footer before amending the snapshot. */
  tuitionVerified?: boolean;
  /** Re-fetches the surrounding registration detail so the saved
   *  amounts and the per-student breakdown table below refresh
   *  together. */
  onChanged?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<TuitionDraft>(() =>
    paymentToTuitionDraft(familyPayment)
  );

  // Defensive lock: if the section flips to verified while admin
  // is in edit mode (e.g. another tab verified, or the page
  // refetches in the middle of an edit), force-exit the editor
  // and discard the draft. Prevents the inputs from staying live
  // when the section is supposed to be settled.
  useEffect(() => {
    if (tuitionVerified && editing) {
      setEditing(false);
      setDraft(paymentToTuitionDraft(familyPayment));
    }
  }, [tuitionVerified, editing, familyPayment]);

  // All numeric values come from the family-payment row. Legacy
  // copies on the progress row (`monthly_tuition_payment`, etc.)
  // were drifting from the apply-flow source, so we read the
  // apply-flow row directly to keep both surfaces consistent.
  const monthlyTuition = familyPayment?.monthly_tuition_payment ?? 0;
  const annualFeeTotal = familyPayment?.annual_fee_total ?? 0;
  const transportationTotal = familyPayment?.transportation_total ?? 0;
  const sufsTotal = familyPayment?.sufs_total ?? 0;
  // Printed name + signature also live on the family-payment row.
  // Fall back to the progress row for ancient packets that signed
  // before the migration; new packets only write to the
  // family-payment row.
  const printedName = familyPayment?.name ?? progress?.name ?? "";
  const signature =
    familyPayment?.signature_data ??
    progress?.tuition_scholarship_signature ??
    progress?.signature_data ??
    null;

  // Helper — render the column value as `$X,XXX.XX` so the four
  // tuition fields all line up; falls back to `—` when there's no
  // family-payment row (pre-acceptance state).
  const fmt$ = (n: number) =>
    familyPayment === null
      ? "—"
      : `$${n.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;

  // Only families with an existing payment row can be edited — the
  // PATCH route writes by id. Pre-acceptance families have to go
  // through the apply-flow Acceptance card first to create the
  // initial row (that's where the printed name + signature also
  // land), so this guard rails admin to the right surface.
  const editable = familyPayment !== null;

  function enterEdit() {
    setDraft(paymentToTuitionDraft(familyPayment));
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(paymentToTuitionDraft(familyPayment));
    setEditing(false);
  }

  /** Diff the draft against the live row, coerce string inputs
   *  back to the column's native type (`number` or explicit `null`
   *  to clear), and PATCH only what changed. Empty string maps to
   *  `null` for transport / sufs (those columns are nullable and
   *  carry semantics — null = waived / not on file) and `0` for
   *  monthly / admin fee (which are always numbers). */
  async function runSave() {
    if (!familyPayment) return;
    const patch: Record<string, number | null> = {};
    const parse = (raw: string): number | null => {
      const trimmed = raw.trim().replace(/,/g, "");
      if (trimmed === "") return null;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    };
    const fields = [
      {
        key: "monthly_tuition_payment" as const,
        prev: familyPayment.monthly_tuition_payment ?? null,
        // monthly + admin fee aren't conceptually nullable —
        // empty input clears to 0 so the receipt still reads as
        // "approved, just $0/mo" rather than "not yet approved."
        emptyAs: 0 as number | null,
      },
      {
        key: "annual_fee_total" as const,
        prev: familyPayment.annual_fee_total ?? null,
        emptyAs: 0 as number | null,
      },
      {
        key: "transportation_total" as const,
        prev: familyPayment.transportation_total ?? null,
        // transport stays nullable — clearing it means
        // "transport waived" (SNAP families), distinct from $0.
        emptyAs: null as number | null,
      },
      {
        key: "sufs_total" as const,
        prev: familyPayment.sufs_total ?? null,
        // SUFS stays nullable — null means "no SUFS on file";
        // $0 would imply "applied but awarded nothing."
        emptyAs: null as number | null,
      },
    ];
    for (const f of fields) {
      const parsed = parse(draft[f.key]);
      const next = parsed === null ? f.emptyAs : parsed;
      if (next !== f.prev) {
        patch[f.key] = next;
      }
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/family-payment/${familyPayment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${res.status})`);
      }
      toast.success("Tuition snapshot saved.");
      setEditing(false);
      onChanged?.();
    } catch (err) {
      console.error("[TuitionBlock.runSave]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border bg-muted/10 p-4 space-y-5">
      {/* Sub-header — title + Edit/Save/Cancel cluster docked
          right. Mirrors the per-student packet card affordance
          pair so the two inline-edit surfaces feel of-a-piece. */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Tuition Snapshot
        </p>
        {editable ? (
          <div className="flex items-center gap-2">
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
                disabled={!!tuitionVerified}
                title={
                  tuitionVerified
                    ? "Undo the Tuition verification below to edit."
                    : "Edit the tuition snapshot"
                }
                className="bg-white"
              >
                <Pencil className="size-3.5 mr-1.5" />
                Edit
              </Button>
            )}
          </div>
        ) : null}
      </div>
      <div>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <DisabledField
            label="School Year"
            value={schoolYear.year_name || ""}
            placeholder="—"
          />
          {editing ? (
            <>
              <PacketEditInput
                label="Monthly Tuition"
                value={draft.monthly_tuition_payment}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, monthly_tuition_payment: v }))
                }
                disabled={saving || !!tuitionVerified}
              />
              <PacketEditInput
                label="Annual Admin Fee"
                value={draft.annual_fee_total}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, annual_fee_total: v }))
                }
                disabled={saving || !!tuitionVerified}
              />
              <PacketEditInput
                label="Transportation Total"
                value={draft.transportation_total}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, transportation_total: v }))
                }
                disabled={saving || !!tuitionVerified}
              />
            </>
          ) : (
            <>
              <DisabledField
                label="Monthly Tuition"
                value={fmt$(monthlyTuition)}
              />
              <DisabledField
                label="Annual Admin Fee"
                value={fmt$(annualFeeTotal)}
              />
              <DisabledField
                label="Transportation Total"
                value={fmt$(transportationTotal)}
              />
            </>
          )}
        </div>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mt-3">
          {editing ? (
            <PacketEditInput
              label="SUFS Scholarship Total"
              value={draft.sufs_total}
              onChange={(v) =>
                setDraft((d) => ({ ...d, sufs_total: v }))
              }
              disabled={saving || !!tuitionVerified}
            />
          ) : (
            <DisabledField
              label="SUFS Scholarship Total"
              value={fmt$(sufsTotal)}
            />
          )}
          <DisabledField
            label="Family Accepted"
            value={
              familyPayment?.isFamilyAccepted === true
                ? "Yes"
                : familyPayment
                  ? "No"
                  : ""
            }
            placeholder="—"
          />
        </div>
        {editing ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Leave Transportation or SUFS blank to clear (transport
            blank = waived for SNAP families; SUFS blank = no SUFS on
            file). Monthly and Admin Fee blank reads as $0.
          </p>
        ) : null}
      </div>
      <SectionGroup title="Acknowledgement">
        <div className="grid gap-4 grid-cols-1">
          <DisabledField
            label="Printed name"
            value={printedName}
            placeholder="—"
            required
          />
          <SignaturePreview label="Signature" signature={signature} />
        </div>
      </SectionGroup>
    </div>
  );
}

/* ─────────────────────── Tuition breakdown table ─────────────────────── */

/**
 * SUFS award-tier identifier → school-year column the per-student
 * scholarship amount lives on. Keep this map in sync with the
 * parent-facing `/dashboard/tuition` and `/apply/year/.../tuition`
 * pages so admin and parent computations stay byte-for-byte identical.
 */
const SUFS_FIELDS: Record<string, keyof TuitionBreakdownSchoolYear> = {
  fes_eo_8: "fes_eo_8",
  fes_eo_9: "fes_eo_9",
  ftc_8: "ftc_8",
  ftc_9: "ftc_9",
  fes_ua_8_ese_1_3: "fes_ua_8_ese_1_3",
  fes_ua_9_ese_1_3: "fes_ua_9_ese_1_3",
  fes_ua_ese_4: "fes_ua_ese_4",
  fes_ua_ese_5: "fes_ua_ese_5",
};

/** Human label for each SUFS tier — same set the parent dashboard uses. */
const SUFS_LABELS: Record<string, string> = {
  fes_eo_8: "FES-EO (Grade 8)",
  fes_eo_9: "FES-EO (Grade 9)",
  ftc_8: "FTC (Grade 8)",
  ftc_9: "FTC (Grade 9)",
  fes_ua_8_ese_1_3: "FES-UA ESE 1-3 (Grade 8)",
  fes_ua_9_ese_1_3: "FES-UA ESE 1-3 (Grade 9)",
  fes_ua_ese_4: "FES-UA ESE 4",
  fes_ua_ese_5: "FES-UA ESE 5",
};

type TuitionBreakdownSchoolYear =
  AdminFamilyRegistrationResponse["school_year"];

function formatTuitionCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Render a colored status pill for the Step Up status column.
 *  Mirrors the same color mapping the parent-facing tuition table
 *  uses (Approved/Verified → green, Pending → amber, Denied → red,
 *  other → neutral). */
function tuitionStatusBadge(status: string) {
  if (!status) return null;
  const lower = status.toLowerCase();
  if (lower === "verified" || lower === "approved") {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
        {status}
      </span>
    );
  }
  if (lower === "pending") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
        {status}
      </span>
    );
  }
  if (lower === "denied" || lower === "rejected") {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
        {status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
      {status}
    </span>
  );
}

/**
 * Read-only per-student tuition breakdown — same table the parent
 * sees on `/dashboard/tuition`, dropped under the Tuition card on
 * the registration detail page so admin can scan exactly what the
 * family signed for. Pure presentational: no inputs, no editor
 * jump-offs. The Tuition card already has its own admin Edit /
 * Verify affordances above; this block is just the receipt.
 *
 * Math mirrors `/dashboard/tuition` line-for-line — admin's view
 * has to agree with the parent's view to the penny, so we
 * deliberately re-implement the same formula here rather than
 * importing partial fragments and risking drift.
 *
 * Transportation is no longer a separate line item — it's been
 * rolled into the annual tuition figure. SNAP families still get
 * full OS coverage; their `opportunity_scholarship_award_amount`
 * is just 0, so the subtotal naturally collapses to the admin fee.
 */
function TuitionBreakdownTable({
  students,
  schoolYear,
  scholarship,
}: {
  students: AdminFamilyRegistrationStudentRow[];
  schoolYear: TuitionBreakdownSchoolYear;
  /** Family-level scholarship summary. When the family is on the
   *  confirmed SNAP path, the per-app
   *  `opportunity_scholarship_award_amount` is null on purpose
   *  (admin doesn't enter a number — the Opportunity Scholarship
   *  covers whatever's left after SUFS). This block then renders
   *  the COMPUTED coverage (`tuition - SUFS`) on the
   *  Opportunity Scholarship Award line instead of "—". The
   *  per-student Cost Per Student line is gated on the family
   *  being on the OS path (`isOpportunityScholarship`). */
  scholarship: AdminFamilyRegistrationResponse["scholarship"];
}) {
  if (students.length === 0) {
    return null;
  }
  const tuition = schoolYear.tuition ?? 0;
  const adminFees = schoolYear.annual_fees ?? 0;
  // SNAP families with the SNAP award letter admin-confirmed get
  // the auto-coverage treatment. Pre-confirm SNAP families still
  // read the raw column so a half-set-up row doesn't get a
  // computed coverage that admin hasn't actually approved.
  const isSnapAutoCover =
    scholarship.isSNAPBenefits && scholarship.is_snap_confirmed;

  const rows = students.map((s) => {
    const sufsField = SUFS_FIELDS[s.sufs_type];
    const stepUpAmount = sufsField
      ? (schoolYear[sufsField] as number | undefined) ?? 0
      : 0;
    // Opportunity Scholarship Award = the coverage the scholarship
    // pays. Always computed as `tuition - SUFS - familyPays` (not
    // read straight off `opportunity_scholarship_award_amount` —
    // that field stores what the FAMILY pays, not what the
    // scholarship covers). Mirrors the apply-flow Tuition Breakdown
    // exactly. SNAP families have `familyPays === 0`, so the
    // coverage collapses to `tuition - SUFS` automatically. The
    // separate `null` sentinel below distinguishes "no scholarship
    // determination at all" from "$0 award" so the rendered row
    // can show `—` instead of $0 for opted-out families.
    const familyPaysForTuition =
      s.opportunity_scholarship_award_amount ?? 0;
    const hasOSDetermination =
      isSnapAutoCover ||
      scholarship.isOpportunityScholarship === true ||
      s.opportunity_scholarship_award_amount != null;
    const scholarshipAmount: number | null = hasOSDetermination
      ? Math.max(0, tuition - stepUpAmount - familyPaysForTuition)
      : null;
    const subtotal = familyPaysForTuition + adminFees;
    return {
      studentName: s.student_full_name,
      tuition,
      stepUpStatus: s.sufs_status,
      stepUpType: s.sufs_type,
      stepUpAmount,
      scholarshipAmount,
      adminFees,
      familyPaysForTuition,
      hasOSDetermination,
      subtotal,
    };
  });
  const grandTotal = rows.reduce((sum, r) => sum + r.subtotal, 0);
  const yearName = schoolYear.year_name ?? "";

  return (
    <div className="rounded-md border bg-white overflow-hidden">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row, idx) => (
            <Fragment key={idx}>
              {/* Student group header */}
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

              {/* Annual Tuition */}
              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Annual Tuition
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  ${formatTuitionCurrency(row.tuition)}
                </td>
              </tr>

              {/* Annual Admin Fee */}
              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Annual Admin Fee
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  ${formatTuitionCurrency(row.adminFees)}
                </td>
              </tr>

              {/* Step Up Status */}
              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Step Up for Students Award Status
                </td>
                <td className="px-4 py-3 text-right">
                  {row.stepUpStatus ? (
                    tuitionStatusBadge(row.stepUpStatus)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>

              {/* Step Up Type */}
              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Step Up for Students Award Type
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  {row.stepUpType && SUFS_LABELS[row.stepUpType] ? (
                    SUFS_LABELS[row.stepUpType]
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>

              {/* Step Up Amount */}
              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Step Up for Students Award Amount
                </td>
                <td className="px-4 py-3 text-right font-medium text-green-600">
                  {row.stepUpAmount > 0
                    ? `-$${formatTuitionCurrency(row.stepUpAmount)}`
                    : "$0.00"}
                </td>
              </tr>

              {/* Opportunity Scholarship */}
              <tr className="border-t">
                <td className="px-4 py-3 text-muted-foreground">
                  Opportunity Scholarship Award
                </td>
                <td className="px-4 py-3 text-right font-medium text-green-600">
                  {row.scholarshipAmount != null &&
                  row.scholarshipAmount > 0 ? (
                    `-$${formatTuitionCurrency(row.scholarshipAmount)}`
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>

              {/* Remaining Tuition Amount — the per-student tuition
                  the family still owes after the Opportunity
                  Scholarship has been applied. Same value baked into
                  the subtotal below, broken out as its own row.
                  Renders whenever the row has a determination
                  (admin entered a per-student amount, OR family is
                  flagged on OS, OR family is on SNAP) — covers the
                  common case where admin has entered the amount but
                  hasn't yet explicitly set the scholarship path flag. */}
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
                          {scholarship.isSNAPBenefits ? (
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
                  <td className="px-4 py-3 text-right font-medium">
                    ${formatTuitionCurrency(row.familyPaysForTuition)}
                  </td>
                </tr>
              ) : null}

              {/* Student subtotal */}
              <tr className="border-t bg-muted/20">
                <td className="px-4 py-3 font-medium">
                  Subtotal — {row.studentName}
                </td>
                <td className="px-4 py-3 text-right font-semibold">
                  ${formatTuitionCurrency(row.subtotal)}
                </td>
              </tr>
            </Fragment>
          ))}

          {/* Grand total — title carries the school year in parens
              so admin always knows which year's receipt they're
              looking at without scrolling back to the page header.
              Same pattern as the parent dashboard's tuition table. */}
          <tr className="border-t-2 bg-white">
            <td className="px-4 py-3 font-bold">
              Total Annual Due
              {yearName ? (
                <span className="ml-1.5 font-normal text-muted-foreground">
                  — School Year ({yearName})
                </span>
              ) : null}
            </td>
            <td className="px-4 py-3 text-right font-bold">
              ${formatTuitionCurrency(grandTotal)}
            </td>
          </tr>
          <tr className="border-t bg-white">
            <td className="px-4 py-3 font-bold">
              Monthly Payment (Aug – Jul, 12 months)
            </td>
            <td className="px-4 py-3 text-right font-bold">
              ${formatTuitionCurrency(grandTotal / 12)}/mo
            </td>
          </tr>
        </tbody>
      </table>
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
      {/* Signed PDF download. Previously rendered an inline
          `<iframe src={pdfUrl}>` preview, but the stored
          `enrollment_agreement_pdf_url` points at
          `api.pandadoc.com/public/v1/documents/{id}/download` —
          which requires the PandaDoc API key in the request header.
          The admin's browser doesn't have that, so the iframe
          rendered an `authentication_error` JSON payload instead of
          the PDF. The proxy at `/api/admin/pandadoc/download` fetches
          server-side with our API key and streams the bytes back, so
          a plain download link points there instead. */}
      {isSigned && pdId ? (
        <SectionGroup title="Signed PDF">
          <div className="flex justify-end">
            <Button asChild variant="outline" size="sm" className="bg-white">
              <a
                href={`/api/admin/pandadoc/download?documentId=${pdId}`}
                target="_blank"
                rel="noreferrer"
                download={`enrollment-agreement-${pdId}.pdf`}
              >
                <FileText className="size-3.5 mr-1.5" />
                Download PDF
              </a>
            </Button>
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
  yearId,
  onChanged,
}: {
  students: AdminFamilyRegistrationStudentRow[];
  emergencyContacts: XanoEmergencyContact[];
  /** Active school year — required so the "Create registration
   *  packet" button on missing-packet students can bootstrap a row
   *  scoped to the right year. */
  yearId: number;
  onChanged: () => void;
}) {
  if (students.length === 0) {
    return (
      <div className="rounded-md border bg-muted/10 p-4 text-sm text-muted-foreground">
        No active students for this year.
      </div>
    );
  }
  // Emergency contacts get their own SectionShell now (rendered by
  // the parent layout), so this block only stacks the per-student
  // packet cards. The `emergencyContacts` prop is intentionally
  // unused here; kept on the signature so the parent can keep
  // passing them as a single bag of family-scoped data without
  // having to refactor adjacent surfaces.
  void emergencyContacts;
  return (
    <div className="space-y-5">
      {students.map((row) => (
        <StudentPacketBlock
          key={row.student_id}
          row={row}
          yearId={yearId}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const SWIM_LEVELS = ["None", "Beginner", "Intermediate", "Advanced"];
const YES_NO = ["Yes", "No"] as const;

/**
 * Draft shape for the packet inline editor — string-typed mirror of
 * the editable fields on `XanoStudentRegistration`. Booleans render
 * as "Yes" / "No" / "" selects (empty = unset); numbers and text
 * all flow through as plain strings until save, where we coerce
 * back to the column's native type for the PATCH body.
 *
 * Read-only columns (file uploads, liability-waiver metadata,
 * registrationConfirmed + audit pair) deliberately aren't on the
 * draft — those flow through their own surfaces (per-doc verify,
 * PandaDoc webhook, verify footer below).
 */
type PacketDraft = {
  shirt_size: string;
  pant_size: string;
  swim_level: string;
  // Health & Medical — booleans + scalars
  is_student_on_medicaid: "" | "Yes" | "No";
  medicaid_number: string;
  medicaid_provider: string;
  carry_epi_pen: "" | "Yes" | "No";
  // Health & Medical — narrative text
  allergies: string;
  dietary_restrictions: string;
  prescription_medications: string;
  health_conditions: string;
  vision_impairments: string;
  hearing_impairments: string;
  epipen_explainer: string;
  permission_for_acetaminophen: string;
  additional_health_information: string;
  interested_in_counseling_services: string;
  iep_description: string;
  // Pickup permissions
  other_adults_approved_for_pickup: string;
  prohibited_adults: string;
};

/** Project a packet row to the editor draft shape. Used to (re)seed
 *  the draft when admin enters edit mode so canceling discards
 *  pending changes cleanly. */
function packetToDraft(p: XanoStudentRegistration | null | undefined): PacketDraft {
  return {
    shirt_size: p?.shirt_size ?? "",
    pant_size: p?.pant_size ?? "",
    swim_level: p?.swim_level ?? "",
    is_student_on_medicaid:
      p?.is_student_on_medicaid === true
        ? "Yes"
        : p?.is_student_on_medicaid === false
          ? "No"
          : "",
    medicaid_number:
      p?.medicaid_number === undefined || p?.medicaid_number === null
        ? ""
        : String(p.medicaid_number),
    medicaid_provider: p?.medicaid_provider ?? "",
    carry_epi_pen:
      p?.carry_epi_pen === true
        ? "Yes"
        : p?.carry_epi_pen === false
          ? "No"
          : "",
    allergies: p?.allergies ?? "",
    dietary_restrictions: p?.dietary_restrictions ?? "",
    prescription_medications: p?.prescription_medications ?? "",
    health_conditions: p?.health_conditions ?? "",
    vision_impairments: p?.vision_impairments ?? "",
    hearing_impairments: p?.hearing_impairments ?? "",
    epipen_explainer: p?.epipen_explainer ?? "",
    permission_for_acetaminophen: p?.permission_for_acetaminophen ?? "",
    additional_health_information: p?.additional_health_information ?? "",
    interested_in_counseling_services:
      p?.interested_in_counseling_services ?? "",
    iep_description: p?.iep_description ?? "",
    other_adults_approved_for_pickup:
      p?.other_adults_approved_for_pickup ?? "",
    prohibited_adults: p?.prohibited_adults ?? "",
  };
}

function StudentPacketBlock({
  row,
  yearId,
  onChanged,
}: {
  row: AdminFamilyRegistrationStudentRow;
  /** Active school year id — needed to bootstrap a packet from
   *  admin when the parent hasn't started the registration flow
   *  themselves yet. */
  yearId: number;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  // Inline edit state for the packet. Lives at the block level so
  // every editable sub-section (Uniform & Activities, Health &
  // Medical, Pickup Permissions) swaps into edit mode together —
  // admin's flow is "open this student's packet, edit, save" not
  // "edit each sub-section individually."
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PacketDraft>(() => packetToDraft(row.packet));
  const packet = row.packet;
  const hasPacket = packet != null;

  /** Bootstrap a packet row when a student is missing one. Hits
   *  the admin POST route which delegates to
   *  `xano.studentRegistration.resolve()` — fetch-or-create with
   *  empty-row defaults, so re-clicking after a successful create
   *  is a no-op rather than a duplicate insert. Refreshes the
   *  registration detail SWR so the just-created packet's fields
   *  render in place of the "Not started" pill. */
  async function createPacket() {
    if (creating || hasPacket) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/admin/student-registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: row.student_id,
          yearId,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Create failed (${res.status})`);
      }
      toast.success(`Registration packet created for ${row.student_full_name}.`);
      onChanged();
    } catch (err) {
      console.error("[StudentPacketBlock.createPacket]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't create packet."
      );
    } finally {
      setCreating(false);
    }
  }
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

  function enterEdit() {
    // Reseed the draft from the latest row data each time we open
    // the editor so the form doesn't carry stale values from a prior
    // canceled edit.
    setDraft(packetToDraft(packet));
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(packetToDraft(packet));
    setEditing(false);
  }

  /** Diff the draft against the current packet, coerce types back to
   *  the column's native shape, and PATCH only what changed. Keeps the
   *  request body minimal so concurrent admin edits don't trample
   *  each other on untouched columns. */
  async function runSave() {
    if (!packet) return;
    const patch: Partial<XanoStudentRegistration> = {};
    // Strings — trim before compare so trailing whitespace doesn't
    // count as a change.
    const trimEq = (a: string, b: string) => a.trim() === (b ?? "").trim();
    if (!trimEq(draft.shirt_size, packet.shirt_size ?? ""))
      patch.shirt_size = draft.shirt_size.trim();
    if (!trimEq(draft.pant_size, packet.pant_size ?? ""))
      patch.pant_size = draft.pant_size.trim();
    if (!trimEq(draft.swim_level, packet.swim_level ?? ""))
      patch.swim_level = draft.swim_level.trim();
    if (!trimEq(draft.medicaid_provider, packet.medicaid_provider ?? ""))
      patch.medicaid_provider = draft.medicaid_provider.trim();
    // Narrative fields — same trimmed-compare treatment.
    const narrative = [
      "allergies",
      "dietary_restrictions",
      "prescription_medications",
      "health_conditions",
      "vision_impairments",
      "hearing_impairments",
      "epipen_explainer",
      "permission_for_acetaminophen",
      "additional_health_information",
      "interested_in_counseling_services",
      "iep_description",
      "other_adults_approved_for_pickup",
      "prohibited_adults",
    ] as const;
    for (const key of narrative) {
      const next = draft[key].trim();
      const prev = (packet[key] ?? "").trim();
      if (next !== prev) {
        (patch as Record<string, unknown>)[key] = next;
      }
    }
    // Booleans — "" maps back to false (Xano column is non-null
    // boolean). Empty string in the draft means "admin didn't pick"
    // — we don't change the value in that case.
    if (
      draft.is_student_on_medicaid !== "" &&
      (draft.is_student_on_medicaid === "Yes") !==
        (packet.is_student_on_medicaid === true)
    ) {
      patch.is_student_on_medicaid = draft.is_student_on_medicaid === "Yes";
    }
    if (
      draft.carry_epi_pen !== "" &&
      (draft.carry_epi_pen === "Yes") !== (packet.carry_epi_pen === true)
    ) {
      patch.carry_epi_pen = draft.carry_epi_pen === "Yes";
    }
    // Medicaid number — Xano column is numeric. Empty input means
    // "clear it" → 0 (matches the parent-side flow's behavior).
    const draftMedNum = draft.medicaid_number.trim();
    const nextMedNum = draftMedNum === "" ? 0 : Number(draftMedNum);
    if (
      Number.isFinite(nextMedNum) &&
      nextMedNum !== (packet.medicaid_number ?? 0)
    ) {
      patch.medicaid_number = nextMedNum;
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/student-registration/${packet.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${res.status})`);
      }
      toast.success(`${row.student_full_name}'s packet saved.`);
      setEditing(false);
      onChanged();
    } catch (err) {
      console.error("[StudentPacketBlock.runSave]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    // Outer wrapper stays at full opacity — the verified-state body
    // fade is applied to the inner body container below so the
    // header buttons and verify footer remain clearly legible. Edit
    // mode short-circuits the body fade so admin isn't editing
    // through a half-opacity grid.
    <div className="rounded-md border bg-muted/10 overflow-hidden">
      {/* Header strip — name + status pill on the left, Edit / Save
          / Cancel on the right. Always at full opacity so the
          verified-state controls (and the Edit affordance once
          unverified) stay clearly readable even when the body
          fades. Same affordance pair the apply-flow
          `StudentApplicationBlock` exposes — admin's eye lands on
          the same control in the same spot on every per-student
          card across the two admin surfaces. */}
      <div className="p-4 pb-0 flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate">
              {row.student_full_name}
            </p>
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
            {!hasPacket ? (
              <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
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
        </div>
        {/* Edit / Save / Cancel cluster — only renders when a packet
            exists (no point editing a row that hasn't been created
            yet; admin uses Create Packet below in that case).
            Disabled while verified so the per-student verify state
            stays the single source of truth — admin can Undo the
            verification first if they need to amend the packet. */}
        {hasPacket ? (
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
                disabled={verified}
                title={
                  verified
                    ? "Undo verification below to amend this packet."
                    : `Edit ${row.student_full_name}'s packet`
                }
                className="bg-white"
              >
                <Pencil className="size-3.5 mr-1.5" />
                Edit
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {/* Body — opacity fades when verified so the form reads as
          settled, but the header above and footer below stay at
          full opacity. Edit mode forces full opacity regardless of
          verify state (the verify Edit button is already disabled
          when verified, so this only matters during an in-flight
          PATCH from a stale render). */}
      <div
        className={cn(
          "p-4 space-y-5 transition-opacity",
          verified && hasPacket && !editing && "opacity-60"
        )}
      >

      {!hasPacket ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The family hasn&rsquo;t opened this packet yet. You can
            create an empty packet now so admin work (waivers, doc
            uploads, manual edits) can land before the parent opens
            the registration flow.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={creating}
            onClick={() => void createPacket()}
            className="bg-white"
          >
            {creating ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : (
              <Pencil className="size-3.5 mr-1.5" />
            )}
            Create registration packet
          </Button>
        </div>
      ) : (
        <>
          {/* ── Uniform & Activities ──────────────────────────────
              Mirrors the parent flow's `Uniform & Activities`
              section header + 3-col grid so the admin view reads
              as the same form the parent filled out. */}
          <SectionGroup title="Uniform & Activities">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
              {editing ? (
                <>
                  <PacketEditSelect
                    label="Shirt Size"
                    value={draft.shirt_size}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, shirt_size: v }))
                    }
                    options={SHIRT_SIZES}
                    disabled={saving}
                    required
                  />
                  <PacketEditInput
                    label="Pant Size"
                    value={draft.pant_size}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, pant_size: v }))
                    }
                    disabled={saving}
                    required
                  />
                  <PacketEditSelect
                    label="Swim Level"
                    value={draft.swim_level}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, swim_level: v }))
                    }
                    options={SWIM_LEVELS}
                    disabled={saving}
                    required
                  />
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          </SectionGroup>

          <Separator />

          {/* ── Required Documents ──────────────────────────────── */}
          {/* Document-verification table. Each row shows the doc's
              uploaded files + a per-doc Mark confirmed + Undo
              affordance that flips the admin-confirm bool on the
              student row. The admin route auto-stamps the audit
              pair so the "Confirmed by X · 4d" caption can render
              without the client managing it. Pixel-aligned with
              the apply-flow Documents-to-Review block on the
              Financial Aid card. The block ships its own header
              strip, so we skip the SectionGroup wrapper here. */}
          <RequiredDocumentsTable row={row} onChanged={onChanged} />

          <Separator />

          {/* ── Optional Documents ──────────────────────────────── */}
          {/* Each FilePreviewGroup ships an inline Upload affordance
              so admin can attach pages on the family's behalf — useful
              for paper records being digitized post-acceptance or for
              additional pages the parent didn't initially submit. */}
          <SectionGroup title="Optional Documents">
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <FilePreviewGroup
                label="IEP"
                files={row.student_documents.iep}
                upload={{
                  studentId: row.student_id,
                  fieldKey: "iep",
                  onChanged,
                }}
              />
              <FilePreviewGroup
                label="SSN Card"
                files={row.student_documents.ssn_card}
                upload={{
                  studentId: row.student_id,
                  fieldKey: "ssn_card",
                  onChanged,
                }}
              />
              <FilePreviewGroup
                label="Passport"
                files={row.student_documents.passport}
                upload={{
                  studentId: row.student_id,
                  fieldKey: "passport",
                  onChanged,
                }}
              />
              <FilePreviewGroup
                label="Student State ID"
                files={row.student_documents.student_state_id}
                upload={{
                  studentId: row.student_id,
                  fieldKey: "student_state_id",
                  onChanged,
                }}
              />
            </div>
          </SectionGroup>

          <Separator />

          {/* ── Health & Medical ────────────────────────────────── */}
          <SectionGroup title="Health & Medical">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              {editing ? (
                <>
                  <PacketEditSelect
                    label="On Medicaid"
                    value={draft.is_student_on_medicaid}
                    onChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        is_student_on_medicaid: v as "" | "Yes" | "No",
                      }))
                    }
                    options={YES_NO}
                    disabled={saving}
                  />
                  <PacketEditInput
                    label="Medicaid Provider"
                    value={draft.medicaid_provider}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, medicaid_provider: v }))
                    }
                    disabled={saving}
                  />
                  <PacketEditInput
                    label="Medicaid #"
                    value={draft.medicaid_number}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, medicaid_number: v }))
                    }
                    disabled={saving}
                    type="text"
                  />
                  <PacketEditSelect
                    label="Carries EpiPen"
                    value={draft.carry_epi_pen}
                    onChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        carry_epi_pen: v as "" | "Yes" | "No",
                      }))
                    }
                    options={YES_NO}
                    disabled={saving}
                  />
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
            {/* Medical narrative fields — 2-col on sm+ so the
                textareas don't stack into a single tall column.
                Most fields read as "none" / short notes in
                practice, so two-up scans cleanly. */}
            <div className="mt-3 grid gap-4 grid-cols-1 sm:grid-cols-2">
              {editing ? (
                <>
                  <PacketEditTextarea
                    label="Allergies"
                    value={draft.allergies}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, allergies: v }))
                    }
                    disabled={saving}
                  />
                  <PacketEditTextarea
                    label="Dietary restrictions"
                    value={draft.dietary_restrictions}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, dietary_restrictions: v }))
                    }
                    disabled={saving}
                  />
                  <PacketEditTextarea
                    label="Prescription medications"
                    value={draft.prescription_medications}
                    onChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        prescription_medications: v,
                      }))
                    }
                    disabled={saving}
                  />
                  <PacketEditTextarea
                    label="Health conditions"
                    value={draft.health_conditions}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, health_conditions: v }))
                    }
                    disabled={saving}
                  />
                  <PacketEditTextarea
                    label="Vision impairments"
                    value={draft.vision_impairments}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, vision_impairments: v }))
                    }
                    disabled={saving}
                  />
                  <PacketEditTextarea
                    label="Hearing impairments"
                    value={draft.hearing_impairments}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, hearing_impairments: v }))
                    }
                    disabled={saving}
                  />
                  <PacketEditTextarea
                    label="EpiPen explainer"
                    value={draft.epipen_explainer}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, epipen_explainer: v }))
                    }
                    disabled={saving}
                  />
                  <PacketEditTextarea
                    label="Permission for acetaminophen"
                    value={draft.permission_for_acetaminophen}
                    onChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        permission_for_acetaminophen: v,
                      }))
                    }
                    disabled={saving}
                  />
                  <PacketEditTextarea
                    label="Additional health information"
                    value={draft.additional_health_information}
                    onChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        additional_health_information: v,
                      }))
                    }
                    disabled={saving}
                  />
                  <PacketEditTextarea
                    label="Interested in counseling services"
                    value={draft.interested_in_counseling_services}
                    onChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        interested_in_counseling_services: v,
                      }))
                    }
                    disabled={saving}
                  />
                  <PacketEditTextarea
                    label="IEP description"
                    value={draft.iep_description}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, iep_description: v }))
                    }
                    disabled={saving}
                  />
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          </SectionGroup>

          <Separator />

          {/* ── Pickup Permissions ──────────────────────────────── */}
          <SectionGroup title="Pickup Permissions">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              {editing ? (
                <>
                  <PacketEditTextarea
                    label="Other adults approved for pickup"
                    value={draft.other_adults_approved_for_pickup}
                    onChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        other_adults_approved_for_pickup: v,
                      }))
                    }
                    disabled={saving}
                  />
                  <PacketEditTextarea
                    label="Prohibited adults"
                    value={draft.prohibited_adults}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, prohibited_adults: v }))
                    }
                    disabled={saving}
                  />
                </>
              ) : (
                <>
                  <DisabledTextarea
                    label="Other adults approved for pickup"
                    value={packet?.other_adults_approved_for_pickup ?? ""}
                  />
                  <DisabledTextarea
                    label="Prohibited adults"
                    value={packet?.prohibited_adults ?? ""}
                  />
                </>
              )}
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
            {packet?.liability_waiver_status === "completed" &&
            packet?.liability_waiver_pandadoc_id ? (
              <div className="mt-3 flex justify-end">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="bg-white"
                >
                  <a
                    href={`/api/admin/pandadoc/download?documentId=${packet.liability_waiver_pandadoc_id}`}
                    target="_blank"
                    rel="noreferrer"
                    download={`liability-waiver-${row.student_full_name.replace(/\s+/g, "-")}.pdf`}
                  >
                    <FileText className="size-3.5 mr-1.5" />
                    Download PDF
                  </a>
                </Button>
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
  familyId,
  onChanged,
}: {
  contacts: XanoEmergencyContact[];
  familyId: number;
  onChanged: () => void;
}) {
  // Tracks which existing contact is open for edit (null = closed,
  // contact id = the row being edited). Lives at the block level
  // — rather than per-contact-card state — so reopening across
  // different contacts cleanly discards prior form values.
  const [editTarget, setEditTarget] = useState<XanoEmergencyContact | null>(
    null
  );
  return (
    <div className="rounded-md border bg-muted/10 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">Emergency Contacts</p>
        {/* Admin-side "Add emergency contact" affordance. Opens a
            small Dialog with the same fields the parent flow uses;
            POSTs to the admin emergency-contacts route which
            creates the row on behalf of `familyId`. Lives at the
            top of the block (instead of below the list) so admin
            doesn't have to scroll past existing contacts to add a
            new one. */}
        <EmergencyContactDialogButton
          mode="add"
          familyId={familyId}
          onSaved={onChanged}
        />
      </div>
      {/* Single page-level edit dialog. Trash-style trigger lives
          in each contact row; clicking sets `editTarget`, which
          opens the dialog with the row's values pre-populated.
          Mirroring the page-level delete dialog pattern keeps a
          single Dialog instance in the DOM rather than one per
          contact. */}
      {editTarget ? (
        <EmergencyContactDialogButton
          mode="edit"
          familyId={familyId}
          existing={editTarget}
          open
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            onChanged();
          }}
        />
      ) : null}
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
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">
                  {`${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() ||
                    `Contact #${c.id}`}
                  {c.relationship ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      · {c.relationship}
                    </span>
                  ) : null}
                </p>
                {/* Per-row edit affordance — opens the shared
                    Dialog in edit mode with this row's values
                    pre-populated. Pencil icon (no label) keeps the
                    card compact; the click-target is wide enough
                    to be easy to hit without a label. */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditTarget(c)}
                  className="bg-white shrink-0"
                  aria-label={`Edit ${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Edit contact"}
                >
                  <Pencil className="size-3.5" />
                  <span className="ml-1.5">Edit</span>
                </Button>
              </div>
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
          // `h-10` matches the bumped DisabledField input so single-
          // file boxes line up flush with the disabled inputs in the
          // same row. text-sm + px-3 keeps the file link weight close
          // to the disabled input text without pushing it into bold.
          "flex h-10 items-center justify-between gap-2 rounded-md border bg-white px-3 text-sm",
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
 * Multi-file variant of `FilePreviewRow` — renders the same labeled
 * box but with one row per uploaded file (truncated filename + Open
 * link). Used for the document categories that live on the student
 * row (birth certificate, transcripts, IEP, etc.) where parents can
 * upload multiple files per category.
 *
 * Behavior:
 *   - Empty array → "Not uploaded" (red border when `required`),
 *     identical to the empty state of `FilePreviewRow` so the form
 *     reads consistently.
 *   - Any files present → red border drops (a required category is
 *     considered satisfied as soon as one file is on the row), then
 *     each file renders as a row inside the box with its (truncated)
 *     filename.
 *
 * Filenames truncate via CSS so the full name is always available
 * via the `title` tooltip and reflows on resize.
 */
/* ─────────────────────── Admin document upload ─────────────────────── */

/**
 * Admin-side document upload — POSTs each selected file to
 * `/api/upload` (which proxies Xano's `/upload/attachment`),
 * then PATCHes the student row with the appended metadata array.
 * Mirrors the enrolled-detail page's component byte-for-byte;
 * kept inline here so the registration page stays self-contained
 * rather than importing across admin surfaces.
 *
 * `fieldKey` is the Xano column on `registration_students` — the
 * `/api/admin/students/[id]` allowlist gates which columns are
 * writable here, so a typo defaults to a 400 rather than silently
 * writing the wrong column.
 *
 * `compact` switches to a small inline button trigger suitable
 * for the tight Documents-to-Review table cells; the default
 * full dropzone is used for the Optional Documents grid where
 * vertical space isn't constrained.
 *
 * File removal isn't exposed yet — admin asks the family to
 * remove via the parent flow, matching the deferred approach on
 * the enrolled detail page.
 */
function AdminDocumentUpload({
  studentId,
  fieldKey,
  files,
  label,
  compact,
  onChanged,
}: {
  studentId: number;
  fieldKey:
    | "birth_certificate"
    | "school_health_form"
    | "transcripts"
    | "immunization_forms"
    | "iep"
    | "ssn_card"
    | "passport"
    | "student_state_id";
  files: Record<string, unknown>[];
  label: string;
  compact?: boolean;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patchFiles(next: Record<string, unknown>[]) {
    const res = await fetch(`/api/admin/students/${studentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [fieldKey]: next }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      throw new Error(errBody?.error ?? `Save failed (${res.status})`);
    }
  }

  async function handleFilesChange(newFiles: File[]) {
    setPending(newFiles);
    setError(null);
    if (newFiles.length === 0) return;
    setUploading(true);
    try {
      let acc = files.slice();
      for (const f of newFiles) {
        const formData = new FormData();
        formData.append("file", f);
        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Upload failed (${res.status})`);
        }
        const metadata = (await res.json()) as Record<string, unknown>;
        acc = [...acc, metadata];
        await patchFiles(acc);
      }
      toast.success(
        newFiles.length === 1
          ? `${label} uploaded.`
          : `${newFiles.length} files uploaded.`
      );
      setPending([]);
      onChanged();
    } catch (err) {
      console.error("[AdminDocumentUpload.handleFilesChange]", err);
      const message =
        err instanceof Error ? err.message : "Upload failed.";
      setError(message);
      toast.error(message);
    } finally {
      setUploading(false);
    }
  }

  if (compact) {
    return (
      <>
        <FileUpload
          maxFiles={5}
          maxSize={10 * 1024 * 1024}
          accept=".pdf,.jpg,.jpeg,.png"
          value={pending}
          onValueChange={handleFilesChange}
          disabled={uploading}
        >
          <FileUploadDropzone className="border-0 p-0 cursor-pointer hover:bg-transparent w-fit min-h-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs leading-none bg-white"
              disabled={uploading}
              asChild
            >
              <span>
                {uploading ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <FileUp className="size-3" />
                )}
                <span className="ml-1">
                  {uploading
                    ? "Uploading…"
                    : files.length === 0
                      ? "Upload"
                      : "Add file"}
                </span>
              </span>
            </Button>
          </FileUploadDropzone>
          <FileUploadList>
            {pending.map((f, i) => (
              <FileUploadItem key={i} value={f}>
                <FileUploadItemPreview />
                <FileUploadItemMetadata />
                <FileUploadItemDelete asChild>
                  <Button variant="ghost" size="icon" className="size-7">
                    <X className="size-4" />
                  </Button>
                </FileUploadItemDelete>
              </FileUploadItem>
            ))}
          </FileUploadList>
        </FileUpload>
        {error ? (
          <p className="text-[11px] text-red-600 mt-1">{error}</p>
        ) : null}
      </>
    );
  }

  return (
    <div className="space-y-2">
      <FileUpload
        maxFiles={5}
        maxSize={10 * 1024 * 1024}
        accept=".pdf,.jpg,.jpeg,.png"
        value={pending}
        onValueChange={handleFilesChange}
        disabled={uploading}
      >
        <FileUploadDropzone className="flex-row gap-3 px-4 py-3 cursor-pointer">
          {uploading ? (
            <Loader2 className="size-5 text-muted-foreground animate-spin" />
          ) : (
            <FileUp className="size-5 text-muted-foreground" />
          )}
          <div className="flex-1 text-left">
            <p className="text-sm font-medium">
              {uploading
                ? "Uploading…"
                : files.length === 0
                  ? `Upload ${label}`
                  : `Add another ${label.toLowerCase()}`}
            </p>
            <p className="text-xs text-muted-foreground">
              PDF, JPG, or PNG (max 10MB each, up to 5)
            </p>
          </div>
        </FileUploadDropzone>
        <FileUploadList>
          {pending.map((f, i) => (
            <FileUploadItem key={i} value={f}>
              <FileUploadItemPreview />
              <FileUploadItemMetadata />
              <FileUploadItemDelete asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <X className="size-4" />
                </Button>
              </FileUploadItemDelete>
            </FileUploadItem>
          ))}
        </FileUploadList>
      </FileUpload>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

/**
 * Document-verification table for the four required documents on a
 * student row. One row per document with the uploaded files +
 * status + a per-doc Verify/Undo button. The button PATCHes the
 * student row via `/api/admin/students/[id]` with the matching
 * `*_admin_confirm` bool; the route auto-stamps the audit pair
 * (`*_admin_confirm_time` / `*_admin_confirm_admin`).
 *
 * Mirrors the apply-flow Documents-to-Review block in shape: each
 * doc lives in its own row with the same Verify-then-Undo
 * affordance pattern admin already knows from financial-aid doc
 * verification.
 *
 * The Verify button is disabled when no files are uploaded — admin
 * shouldn't be able to mark a doc verified that doesn't exist on
 * file. Undo flow is a single click (no AlertDialog) because
 * un-verifying a single doc is low-stakes — admin can re-verify
 * immediately if it was a mistake.
 */
function RequiredDocumentsTable({
  row,
  onChanged,
}: {
  row: AdminFamilyRegistrationStudentRow;
  onChanged: () => void;
}) {
  // Inline state for which document is mid-PATCH so the spinner
  // shows on just the affected row's button. Keyed by the doc
  // bool's column name so the switch below stays mechanical.
  const [savingDoc, setSavingDoc] = useState<
    | "birth_certificate_admin_confirm"
    | "school_health_form_admin_confirm"
    | "transcripts_admin_confirm"
    | "immunization_admin_confirm"
    | null
  >(null);

  type DocSpec = {
    /** Display name in the table. */
    label: string;
    /** Files attached on the student row. */
    files: Record<string, unknown>[];
    /** Current confirm state + audit. */
    confirm: {
      confirmed: boolean;
      confirmed_time: number | null;
      confirmed_admin: string;
    };
    /** Bool column on the student row that the Verify button flips. */
    confirmKey:
      | "birth_certificate_admin_confirm"
      | "school_health_form_admin_confirm"
      | "transcripts_admin_confirm"
      | "immunization_admin_confirm";
    /** File array column on the student row — drives the per-row
     *  Upload affordance. Separate from `confirmKey` because the
     *  upload PATCHes a different column (the metadata array) than
     *  the confirm toggle (the bool). */
    fieldKey:
      | "birth_certificate"
      | "school_health_form"
      | "transcripts"
      | "immunization_forms";
  };

  const docs: DocSpec[] = [
    {
      label: "Birth Certificate",
      files: row.student_documents.birth_certificate,
      confirm: row.document_confirms.birth_certificate,
      confirmKey: "birth_certificate_admin_confirm",
      fieldKey: "birth_certificate",
    },
    {
      label: "School Health Form",
      files: row.student_documents.school_health_form,
      confirm: row.document_confirms.school_health_form,
      confirmKey: "school_health_form_admin_confirm",
      fieldKey: "school_health_form",
    },
    {
      label: "Transcripts",
      files: row.student_documents.transcripts,
      confirm: row.document_confirms.transcripts,
      confirmKey: "transcripts_admin_confirm",
      fieldKey: "transcripts",
    },
    {
      label: "Immunization Forms",
      files: row.student_documents.immunization_forms,
      confirm: row.document_confirms.immunization_forms,
      confirmKey: "immunization_admin_confirm",
      fieldKey: "immunization_forms",
    },
  ];

  async function toggleDoc(doc: DocSpec, next: boolean) {
    setSavingDoc(doc.confirmKey);
    try {
      const res = await fetch(`/api/admin/students/${row.student_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [doc.confirmKey]: next }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Update failed (${res.status})`);
      }
      toast.success(
        next
          ? `${doc.label} confirmed.`
          : `${doc.label} confirmation cleared.`
      );
      onChanged();
    } catch (err) {
      console.error("[RequiredDocumentsTable.toggleDoc]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't update.");
    } finally {
      setSavingDoc(null);
    }
  }

  // X/Y CONFIRMED counter in the header strip — only counts docs
  // that have files (a doc without files isn't "confirmable", so
  // excluding them keeps the denominator honest).
  const confirmableDocs = docs.filter((d) => d.files.length > 0);
  const confirmedCount = confirmableDocs.filter(
    (d) => d.confirm.confirmed
  ).length;

  return (
    <div className="rounded-md border bg-muted/20 overflow-hidden">
      {/* Header strip — pixel-aligned with the financial-aid
          DocumentsToReviewBlock so admin reads both surfaces with
          the same visual vocabulary. Counter on the right tracks
          confirmed / total uploaded. */}
      <div className="px-4 py-2 border-b bg-muted/40 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Documents to Review
        </p>
        {confirmableDocs.length > 0 ? (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {confirmedCount}/{confirmableDocs.length} confirmed
          </span>
        ) : null}
      </div>
      <Table className="text-sm table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[28%] text-[10px] uppercase tracking-wider text-muted-foreground">
              Document
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              File(s)
            </TableHead>
            <TableHead className="w-[15%] text-[10px] uppercase tracking-wider text-muted-foreground">
              Confirmed by
            </TableHead>
            <TableHead className="w-[80px] text-[10px] uppercase tracking-wider text-muted-foreground">
              Time
            </TableHead>
            <TableHead className="w-[170px] text-right text-[10px] uppercase tracking-wider text-muted-foreground">
              Confirmation
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.map((doc) => {
            const hasFiles = doc.files.length > 0;
            const confirmed = doc.confirm.confirmed;
            const saving = savingDoc === doc.confirmKey;
            // Confirmed-by string. Treat "0" as the unset sentinel
            // — Xano left the original int default behind when the
            // text column was added, so legacy rows come back as
            // the literal string "0" rather than "".
            const confirmedByName = (() => {
              if (!confirmed) return null;
              const name = doc.confirm.confirmed_admin?.trim();
              if (!name || name === "0") return null;
              return name;
            })();
            const confirmedWhen = confirmed && doc.confirm.confirmed_time
              ? formatRelativeShort(doc.confirm.confirmed_time)
              : null;
            const confirmedWhenLong =
              confirmed && doc.confirm.confirmed_time
                ? formatNoteTimestamp(doc.confirm.confirmed_time)
                : null;
            return (
              <TableRow
                key={doc.confirmKey}
                className={cn(
                  confirmed ? "bg-emerald-50/40 hover:bg-emerald-50/60" : ""
                )}
              >
                <TableCell className="align-middle">
                  <p
                    className="text-sm font-medium truncate"
                    title={doc.label}
                  >
                    {doc.label}
                  </p>
                </TableCell>
                <TableCell className="align-middle">
                  <div className="space-y-1.5">
                    {hasFiles ? (
                      <ul className="space-y-1">
                        {doc.files.map((f, idx) => (
                          <RequiredDocFileLink
                            key={`${doc.confirmKey}-${idx}`}
                            file={f}
                            fallbackIndex={idx}
                          />
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] italic text-muted-foreground">
                        No file uploaded.
                      </p>
                    )}
                    {/* Compact upload trigger — sits below the file
                        list so admin can attach pages on the
                        family's behalf without leaving the table.
                        The Verify button's `hasFiles` gate still
                        applies, so admin can upload then confirm in
                        the same pass. */}
                    <AdminDocumentUpload
                      studentId={row.student_id}
                      fieldKey={doc.fieldKey}
                      files={doc.files}
                      label={doc.label}
                      onChanged={onChanged}
                      compact
                    />
                  </div>
                </TableCell>
                <TableCell className="align-middle">
                  {confirmedByName ? (
                    <p
                      className="text-sm text-muted-foreground truncate"
                      title={confirmedByName}
                    >
                      {confirmedByName}
                    </p>
                  ) : (
                    <span className="text-xs text-muted-foreground/70">
                      —
                    </span>
                  )}
                </TableCell>
                <TableCell className="align-middle">
                  {confirmedWhen ? (
                    <p
                      className="text-sm text-muted-foreground truncate tabular-nums"
                      title={confirmedWhenLong ?? confirmedWhen}
                    >
                      {confirmedWhen}
                    </p>
                  ) : (
                    <span className="text-xs text-muted-foreground/70">
                      —
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right align-middle">
                  {/* Mark Confirmed (primary, becomes emerald-filled
                      once confirmed) + Undo icon button. Same pair
                      the financial-aid table uses so admin doesn't
                      have to learn a new affordance shape here. */}
                  <div className="inline-flex items-center gap-1">
                    <Button
                      type="button"
                      variant={confirmed ? "default" : "outline"}
                      size="sm"
                      disabled={saving || confirmed || !hasFiles}
                      onClick={() => void toggleDoc(doc, true)}
                      className={cn(
                        "h-7 text-xs leading-none",
                        confirmed &&
                          "bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-100",
                        !confirmed && "bg-white"
                      )}
                      title={
                        confirmed
                          ? "Already confirmed — use the Undo button to clear"
                          : hasFiles
                            ? `Mark ${doc.label} as reviewed`
                            : "Upload the document before confirming"
                      }
                    >
                      {saving && !confirmed ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : confirmed ? (
                        <CheckCircle2 className="size-3" />
                      ) : (
                        <Circle className="size-3" />
                      )}
                      <span>{confirmed ? "Confirmed" : "Mark confirmed"}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-7 bg-white"
                      disabled={saving || !confirmed}
                      onClick={() => void toggleDoc(doc, false)}
                      title={
                        confirmed ? "Undo this confirmation" : "Nothing to undo"
                      }
                      aria-label={
                        confirmed
                          ? "Undo confirmation"
                          : "Undo (disabled — nothing to undo)"
                      }
                    >
                      {saving && confirmed ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="size-3.5" />
                      )}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** Single file-link list item for the required-documents table.
 *  Inline because this page already has `fileViewUrl` defined; we
 *  just render the filename with an external-link icon + size
 *  suffix so the cell matches the financial-aid Documents to
 *  Review row exactly. */
function RequiredDocFileLink({
  file,
  fallbackIndex,
}: {
  file: Record<string, unknown>;
  fallbackIndex: number;
}) {
  const name =
    typeof (file as { name?: unknown }).name === "string"
      ? (file as { name: string }).name
      : typeof (file as { path?: unknown }).path === "string"
        ? (file as { path: string }).path
        : `File ${fallbackIndex + 1}`;
  const size = (file as { size?: unknown }).size;
  const sizeKb =
    typeof size === "number" ? `${(size / 1024).toFixed(0)} KB` : null;
  const href = fileViewUrl(file);
  return (
    <li className="flex items-center gap-2 text-sm min-w-0">
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={name}
          className="text-foreground underline-offset-2 hover:underline inline-flex items-center gap-1 min-w-0 flex-1"
        >
          <span className="truncate min-w-0">{name}</span>
          <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
        </a>
      ) : (
        <span className="truncate min-w-0 flex-1" title={name}>
          {name}
        </span>
      )}
      {sizeKb ? (
        <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
          · {sizeKb}
        </span>
      ) : null}
    </li>
  );
}

function FilePreviewGroup({
  label,
  files,
  required,
  upload,
}: {
  label: string;
  files: Record<string, unknown>[] | null | undefined;
  required?: boolean;
  /** Optional upload affordance. When set, an inline Upload / Add
   *  file button renders next to the label and writes back through
   *  `/api/admin/students/[studentId]` with the named `fieldKey`
   *  column. Used by the per-student packet on the registration
   *  detail page so admin can attach optional docs (IEP, SSN,
   *  Passport, State ID) on the family's behalf. */
  upload?: {
    studentId: number;
    fieldKey:
      | "iep"
      | "ssn_card"
      | "passport"
      | "student_state_id";
    onChanged: () => void;
  };
}) {
  const entries = Array.isArray(files) ? files : [];
  const hasAny = entries.length > 0;
  const isMissing = required && !hasAny;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs">
          {label}
          {required ? (
            <span className="ml-1 text-red-500" aria-label="required">
              *
            </span>
          ) : null}
          {hasAny && entries.length > 1 ? (
            <span className="ml-1.5 text-muted-foreground/70">
              ({entries.length})
            </span>
          ) : null}
        </p>
        {upload ? (
          <AdminDocumentUpload
            studentId={upload.studentId}
            fieldKey={upload.fieldKey}
            files={entries}
            label={label}
            onChanged={upload.onChanged}
            compact
          />
        ) : null}
      </div>
      <div
        className={cn(
          // Empty / single-file: render as a 40px tall row so the
          // box matches the bumped DisabledField input height. Multi-
          // file: drop the fixed height so the list grows naturally;
          // `py-2` stands in to keep top/bottom breathing room.
          "rounded-md border bg-white px-3 text-sm",
          entries.length <= 1 ? "flex h-10 items-center" : "py-2 space-y-1",
          isMissing ? "border-red-500" : "border-input"
        )}
      >
        {!hasAny ? (
          <span className="text-muted-foreground">Not uploaded</span>
        ) : (
          entries.map((f, idx) => {
            const url = fileViewUrl(f);
            const name =
              typeof (f as { name?: unknown }).name === "string"
                ? (f as { name: string }).name
                : `File ${idx + 1}`;
            // `path` is unique per file in the Xano vault, so it
            // disambiguates re-uploads of the same filename.
            const path =
              typeof (f as { path?: unknown }).path === "string"
                ? (f as { path: string }).path
                : `idx-${idx}`;
            return (
              <div
                key={path}
                className="flex items-center justify-between gap-2 min-w-0"
              >
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline min-w-0"
                    title={name}
                  >
                    <span className="truncate max-w-[14rem]">{name}</span>
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                ) : (
                  <span className="text-muted-foreground italic truncate">
                    {name} · unavailable
                  </span>
                )}
              </div>
            );
          })
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

/* ─────────────────────── Emergency contact dialog ─────────────────────── */

/**
 * Shared Dialog for both adding and editing an emergency contact.
 * Two modes:
 *   - `mode="add"` — renders a trigger button ("Add contact") that
 *     opens the dialog with empty fields. POSTs to
 *     `/api/admin/emergency-contacts` on save.
 *   - `mode="edit"` — controlled by the parent (no trigger button
 *     rendered). Parent passes `existing` for the pre-populated
 *     fields and `onClose` to dismiss. PATCHes
 *     `/api/admin/emergency-contacts/[id]` on save.
 *
 * Splitting modes into a single component keeps the form layout in
 * one place — the only difference is the initial state + the
 * endpoint hit on submit.
 */
type EmergencyContactDialogProps = {
  familyId: number;
  onSaved: () => void;
} & (
  | { mode: "add"; existing?: undefined; open?: undefined; onClose?: undefined }
  | {
      mode: "edit";
      existing: XanoEmergencyContact;
      open: boolean;
      onClose: () => void;
    }
);
function EmergencyContactDialogButton(props: EmergencyContactDialogProps) {
  const { mode, familyId, onSaved } = props;
  // Add mode owns its own open state (the trigger button toggles
  // it). Edit mode is controlled by the parent — when `props.open`
  // is true the dialog is mounted, when the parent calls `onClose`
  // it dismisses.
  const [addOpen, setAddOpen] = useState(false);
  const open = mode === "edit" ? props.open : addOpen;
  const setOpen = (next: boolean) => {
    if (mode === "edit") {
      if (!next) props.onClose();
    } else {
      setAddOpen(next);
    }
  };

  const [saving, setSaving] = useState(false);
  const initial =
    mode === "edit" && props.existing
      ? {
          firstName: props.existing.first_name ?? "",
          lastName: props.existing.last_name ?? "",
          relationship: props.existing.relationship ?? "",
          email: props.existing.email ?? "",
          phone: props.existing.phone ?? "",
          address1: props.existing.address_line_1 ?? "",
          city: props.existing.city ?? "",
          state: props.existing.state ?? "",
          zip: props.existing.zipcode ?? "",
        }
      : {
          firstName: "",
          lastName: "",
          relationship: "",
          email: "",
          phone: "",
          address1: "",
          city: "",
          state: "",
          zip: "",
        };
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [relationship, setRelationship] = useState(initial.relationship);
  const [email, setEmail] = useState(initial.email);
  const [phone, setPhone] = useState(initial.phone);
  const [address1, setAddress1] = useState(initial.address1);
  const [city, setCity] = useState(initial.city);
  const [state, setState] = useState(initial.state);
  const [zip, setZip] = useState(initial.zip);

  function resetForm() {
    setFirstName("");
    setLastName("");
    setRelationship("");
    setEmail("");
    setPhone("");
    setAddress1("");
    setCity("");
    setState("");
    setZip("");
  }

  async function runSave() {
    setSaving(true);
    try {
      const payload = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        relationship: relationship.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address_line_1: address1.trim(),
        city: city.trim(),
        state: state.trim(),
        zipcode: zip.trim(),
      };
      const url =
        mode === "edit"
          ? `/api/admin/emergency-contacts/${props.existing.id}`
          : `/api/admin/emergency-contacts`;
      const method = mode === "edit" ? "PATCH" : "POST";
      const body =
        mode === "edit"
          ? JSON.stringify(payload)
          : JSON.stringify({ ...payload, familyId });
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(
          errBody?.error ??
            `${mode === "edit" ? "Couldn't save contact" : "Couldn't add contact"} (${res.status})`
        );
      }
      toast.success(
        mode === "edit"
          ? "Emergency contact updated."
          : "Emergency contact added."
      );
      if (mode === "add") {
        setAddOpen(false);
        resetForm();
      }
      onSaved();
    } catch (err) {
      console.error("[EmergencyContactDialogButton.runSave] failed:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {mode === "add" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAddOpen(true)}
          className="bg-white shrink-0"
        >
          <Plus className="size-3.5 mr-1.5" />
          Add contact
        </Button>
      ) : null}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !saving) {
            setOpen(false);
            if (mode === "add") resetForm();
          } else if (next) {
            setOpen(true);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mode === "edit"
                ? "Edit emergency contact"
                : "Add emergency contact"}
            </DialogTitle>
            <DialogDescription>
              {mode === "edit"
                ? "Saves directly to the family."
                : "Saves directly to the family. Fields you leave blank can be filled in later by the parent."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <Field>
                <FieldLabel>First name</FieldLabel>
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Jane"
                />
              </Field>
              <Field>
                <FieldLabel>Last name</FieldLabel>
                <Input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel>Relationship</FieldLabel>
              <Input
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                placeholder="Aunt, Grandparent, Family friend…"
              />
            </Field>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <Field>
                <FieldLabel>Email</FieldLabel>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </Field>
              <Field>
                <FieldLabel>Phone</FieldLabel>
                <PhoneInput value={phone} onChange={setPhone} />
              </Field>
            </div>
            <Field>
              <FieldLabel>Street address</FieldLabel>
              <Input
                value={address1}
                onChange={(e) => setAddress1(e.target.value)}
                placeholder="123 Main St"
              />
            </Field>
            <div className="grid gap-3 grid-cols-3">
              <Field>
                <FieldLabel>City</FieldLabel>
                <Input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>State</FieldLabel>
                <Input
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  maxLength={2}
                />
              </Field>
              <Field>
                <FieldLabel>Zip</FieldLabel>
                <Input value={zip} onChange={(e) => setZip(e.target.value)} />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => {
                setOpen(false);
                if (mode === "add") resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => void runSave()}
            >
              {saving ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : mode === "edit" ? (
                <Pencil className="size-3.5 mr-1.5" />
              ) : (
                <Plus className="size-3.5 mr-1.5" />
              )}
              {mode === "edit" ? "Save changes" : "Add contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ─────────────────────── Revoke acceptance ─────────────────────── */

/**
 * Header-mounted "Revoke acceptance" affordance — wraps the
 * destructive PATCH (`isAccepted = false` on the apply-flow's
 * `family_application_progress` row) behind a warning modal so admin
 * can't blow away an acceptance with a stray click.
 *
 * Lives on the registration detail page (rather than the apply-flow
 * detail page where Acceptance lives) because admin reviewing the
 * post-acceptance packets is the audience most likely to discover
 * "this family should NOT be enrolled after all" — easier to action
 * from the page they're already on than to bounce them back to the
 * apply view to revoke. The apply-flow Acceptance card also ships
 * the same affordance; both call the same underlying PATCH.
 *
 * The PATCH targets `/api/admin/family-progress` which already
 * supports `isAccepted: false` on its allowlist. Side-effects:
 *   - The family drops out of the Accepted bucket on the
 *     Applications list
 *   - `isSubmitted` stays true (we don't auto-flip it back; the
 *     application was still submitted, just not approved)
 *   - The registration-side `isRegistrationConfirmed` is cleared
 *     by the family-progress route's cascade (so admin can step
 *     back through downstream sections)
 *
 * Gated when registration is already confirmed (`registrationConfirmed`
 * prop) — admin has to undo that downstream rollup first before
 * unwinding the upstream acceptance. Keeps the lifecycle linear:
 * you can't strip away the foundation while the roof is still
 * locked in place.
 *
 * `acceptedAtAll` decides whether to render the button: families
 * who were never accepted (no progress row) don't need the
 * affordance.
 */
function RevokeAcceptanceButton({
  familyId,
  yearId,
  familyName,
  acceptedAtAll,
  registrationConfirmed,
  onRevoked,
}: {
  familyId: number;
  yearId: number;
  familyName: string;
  /** Whether there's any apply-flow progress row for this (family,
   *  year) at all. The PATCH route resolves-or-creates a row, so the
   *  call would technically succeed for any family, but rendering
   *  the button on a never-accepted family is just visual noise. */
  acceptedAtAll: boolean;
  /** When true, admin can't revoke acceptance — the registration's
   *  downstream confirmation has to be undone first. Reason rides
   *  on the button's title tooltip so admin sees why it's locked
   *  without leaving the page. */
  registrationConfirmed: boolean;
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
        throw new Error(errBody?.error ?? `Revoke failed (${res.status})`);
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

  if (!acceptedAtAll) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={saving || registrationConfirmed}
        title={
          registrationConfirmed
            ? "Undo registration confirmation above before revoking acceptance."
            : undefined
        }
        onClick={() => setOpen(true)}
        className="bg-white w-full"
      >
        {/* ArrowLeft reads as "send this family back to the
            apply-flow" — they were accepted, this returns them to
            the queue. Same neutral outline as the apply-flow
            Reject button on the Acceptance card so the two
            "step backward" affordances share the same visual
            weight. */}
        <ArrowLeft className="size-4 mr-1.5" />
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
              The family drops out of the Accepted queue and loses
              access to tuition, enrollment, and registration until
              you approve them again. Any section verifies already
              recorded on this registration packet stay intact in case
              this revoke is temporary; the family&rsquo;s underlying
              application data is preserved.
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
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : null}
              Yes, revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ─────────────────────── Family registration confirmation ─────────────────────── */

/**
 * Family Registration Confirmation card — pinned to the TOP of the
 * registration page. Mirrors the Acceptance card on the apply-flow
 * family detail page in spirit: it's the final "this family is
 * fully registered for the year" rollup, distinct from the parent-
 * side `isSubmitted` flag (parent's own submit click) and from the
 * per-section verifies / per-student packet confirmations below.
 *
 * Body is a table view of every active student in the family —
 * admin sees the cohort + packet-confirmation state at a glance
 * without having to scroll into the per-student packet section
 * below. The earlier two-column "Sections Verified / Student
 * Packets Confirmed" checklist was removed because it duplicated
 * the per-section dot rendering downstream; the gate-reason
 * caption in the header carries the same information for blocked
 * states.
 *
 * Footer is a single inline action row: Revoke acceptance, View
 * application, Archive, Confirm Family Registration. Buttons share
 * the row so admin's family-level actions all live in one place.
 * Truncates text when the row gets cramped. Once the family is
 * confirmed, Confirm collapses to a Confirmed pill + Undo button.
 *
 * Two PATCH targets:
 *   - `/api/admin/family-progress` — `isAccepted: false` for
 *     Revoke (lives on the apply-flow progress row)
 *   - `/api/admin/registration-progress` —
 *     `isRegistrationConfirmed` / `isArchived` (registration-side
 *     progress row)
 */
function FamilyRegistrationConfirmationCard({
  familyId,
  yearId,
  familyName,
  progress,
  students,
  onConfirmed,
}: {
  familyId: number;
  yearId: number;
  familyName: string;
  progress: XanoStudentRegistrationProgress | null;
  students: AdminFamilyRegistrationStudentRow[];
  onConfirmed: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);

  const confirmed = progress?.isRegistrationConfirmed === true;
  const archived = progress?.isArchived === true;
  // `registration_confirmed_time` + `registration_confirmed_admin`
  // still live on the row for audit; the footer caption that used
  // to surface them was removed since the "Registration Confirmed"
  // pill in the button row already conveys the state.

  // Section-verify checklist drives the gate-reason caption only
  // (the visual checklist is gone — its information is duplicated
  // by the dots on each section card below). Same shape as before
  // so the gate reason logic doesn't have to change.
  const sectionChecklist: Array<{ label: string; verified: boolean }> = [
    {
      label: "Tuition",
      verified: progress?.tuition_admin_confirm === true,
    },
    {
      label: "Enrollment Agreement",
      verified: progress?.enrollment_admin_confirm === true,
    },
    {
      label: "Volunteer Hours",
      verified: progress?.volunteer_admin_confirm === true,
    },
    {
      label: "Emergency Contacts",
      verified: progress?.emergency_contacts_admin_confirm === true,
    },
  ];

  // Per-student packet checklist — each active student must have a
  // packet AND it must be `registrationConfirmed`.
  const studentChecklist = students.map((s) => ({
    name: s.student_full_name || `Student #${s.student_id}`,
    confirmed: s.packet?.registrationConfirmed === true,
  }));

  const allSectionsVerified = sectionChecklist.every((s) => s.verified);
  const allStudentsConfirmed =
    studentChecklist.length > 0 &&
    studentChecklist.every((s) => s.confirmed);
  const canConfirm = allSectionsVerified && allStudentsConfirmed;

  // Reason string for the gated state — admin sees what's blocking
  // the confirm without having to hover or scroll up.
  const gateReason = (() => {
    if (canConfirm) return null;
    const missingSections = sectionChecklist
      .filter((s) => !s.verified)
      .map((s) => s.label);
    const missingStudents = studentChecklist
      .filter((s) => !s.confirmed)
      .map((s) => s.name);
    if (studentChecklist.length === 0) {
      return "No active students for this year.";
    }
    if (missingSections.length > 0 && missingStudents.length > 0) {
      return `Verify ${missingSections.join(", ")} and confirm packets for ${missingStudents.join(", ")} first.`;
    }
    if (missingSections.length > 0) {
      return `Verify ${missingSections.join(", ")} first.`;
    }
    if (missingStudents.length > 0) {
      return `Confirm packets for ${missingStudents.join(", ")} first.`;
    }
    return null;
  })();

  async function patchConfirmed(next: boolean) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/registration-progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyId,
          yearId,
          isRegistrationConfirmed: next,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Update failed (${res.status})`);
      }
      toast.success(
        next
          ? `${familyName || "Family"} registration confirmed.`
          : "Confirmation cleared."
      );
      if (!next) setUndoOpen(false);
      onConfirmed();
    } catch (err) {
      console.error("[FamilyRegistrationConfirmationCard.patch] failed:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't update.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      id="section-confirmation"
      className="overflow-hidden gap-0 py-0 bg-white scroll-mt-20"
    >
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={cn(
                "inline-block size-2.5 rounded-full shrink-0",
                confirmed
                  ? "bg-green-500"
                  : canConfirm
                    ? "bg-amber-500"
                    : "bg-muted-foreground/30"
              )}
              aria-label={
                confirmed
                  ? "Confirmed"
                  : canConfirm
                    ? "Ready to confirm"
                    : "Awaiting prerequisites"
              }
              title={
                confirmed
                  ? "Confirmed"
                  : canConfirm
                    ? "Ready to confirm"
                    : "Awaiting prerequisites"
              }
            />
            <CardTitle className="text-base truncate">
              Family Registration Confirmation
            </CardTitle>
            {confirmed ? (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800">
                <CheckCircle2 className="size-2.5" />
                Confirmed
              </span>
            ) : null}
            {archived ? (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-600">
                Archived
              </span>
            ) : null}
          </div>
          {/* Gate-reason caption pinned to the right of the header
              (same pattern as the Acceptance card). Stays out of
              the footer so the action row reads as just the
              action row. */}
          {!confirmed && gateReason ? (
            <span className="text-xs text-muted-foreground truncate text-right shrink-0">
              {gateReason}
            </span>
          ) : null}
        </div>
      </CardHeader>
      {/* Body: table view of every active student in the family.
          Replaces the prior two-column "Sections Verified / Student
          Packets Confirmed" checklist — that information lives on
          the per-section dots below, so duplicating it here was
          just noise. The table surfaces packet-confirmation state
          per student so admin doesn't have to scroll into the
          Registration Packet section to scan it. */}
      <CardContent className="py-4 bg-white">
        {students.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">
            No active students for this year.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-3 font-semibold">Student</th>
                  <th className="py-2 pr-3 font-semibold">Grade</th>
                  <th className="py-2 pr-3 font-semibold">DOB</th>
                  <th className="py-2 pr-3 font-semibold">Packet</th>
                  <th className="py-2 font-semibold">Verified by</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const packetExists = s.packet != null;
                  const packetVerified = s.is_verified === true;
                  const verifiedByName =
                    s.is_admin_verified_admin?.trim() || null;
                  return (
                    <tr key={s.student_id} className="border-b last:border-0">
                      <td className="py-2 pr-3 align-middle font-medium truncate">
                        {s.student_full_name ||
                          `${s.student_first_name} ${s.student_last_name}`.trim() ||
                          "—"}
                      </td>
                      <td className="py-2 pr-3 align-middle truncate text-muted-foreground">
                        {s.student_grade || "—"}
                      </td>
                      <td className="py-2 pr-3 align-middle truncate text-muted-foreground">
                        {s.student_date_of_birth || "—"}
                      </td>
                      <td className="py-2 pr-3 align-middle">
                        {packetVerified ? (
                          <span className="inline-flex items-center gap-1 text-green-700">
                            <CheckCircle2 className="size-3.5" />
                            Confirmed
                          </span>
                        ) : packetExists ? (
                          <span className="inline-flex items-center gap-1 text-amber-700">
                            <SquarePen className="size-3.5" />
                            Pending
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <SquarePen className="size-3.5" />
                            No packet
                          </span>
                        )}
                      </td>
                      <td className="py-2 align-middle truncate text-muted-foreground">
                        {verifiedByName ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {/* Footer — three buttons share the row equally (`flex-1`
          on each), left-to-right: Archive (the soft-delete escape
          hatch) → Revoke acceptance (the destructive "send this
          family back to the apply-flow" action, rendered with a
          back-arrow icon to read as a directional "step
          backward") → Confirm Family Registration (the primary
          forward action). Equal-width buttons make the row read
          as one decision surface — no visual hierarchy hint that
          one action is more important than another. The
          "Confirmed by …" caption that used to sit above the
          buttons was removed — the muted "Registration Confirmed"
          pill in the button row already conveys the state, and
          duplicating it as a caption made the footer feel
          stacked. */}
      <div className="border-t bg-white px-5 py-3">
        <div
          className={cn(
            "grid gap-2",
            // Pre-confirm: Archive / Revoke / Confirm. Post-confirm
            // the Confirm slot splits into a muted "Registration
            // Confirmed" pill + an Undo button, so we widen the
            // grid to 4 cells so everything keeps full-width.
            confirmed ? "grid-cols-4" : "grid-cols-3"
          )}
        >
          <ArchiveRegistrationButton
            familyId={familyId}
            yearId={yearId}
            familyName={familyName}
            archived={archived}
            onChanged={onConfirmed}
          />
          <RevokeAcceptanceButton
            familyId={familyId}
            yearId={yearId}
            familyName={familyName}
            acceptedAtAll={progress !== null}
            registrationConfirmed={confirmed}
            onRevoked={onConfirmed}
          />
          {confirmed ? (
            <>
              {/* Order in the grid (left→right) when confirmed:
                  Archive · Revoke acceptance · Undo · Registration
                  Confirmed. The Confirmed pill sits at the far
                  right so it's the last thing admin's eye lands
                  on — the headline state, not a button to
                  click. */}
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => setUndoOpen(true)}
                disabled={saving}
                className="bg-white w-full"
              >
                {saving ? (
                  <Loader2 className="size-4 mr-1.5 animate-spin shrink-0" />
                ) : (
                  <Undo2 className="size-4 mr-1.5 shrink-0" />
                )}
                <span className="truncate">Undo</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled
                className="bg-muted text-muted-foreground cursor-default disabled:opacity-100 w-full"
              >
                <CheckCircle2 className="size-4 mr-1.5 shrink-0" />
                <span className="truncate">Registration Confirmed</span>
              </Button>
              <AlertDialog open={undoOpen} onOpenChange={setUndoOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Undo {familyName || "family"} registration
                      confirmation?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This clears the family-level registration
                      latch. Per-section verifies and per-student
                      packet confirmations stay intact — only the
                      rollup audit is cleared. You can re-confirm at
                      any time.
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
                        void patchConfirmed(false);
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
          ) : (
            <Button
              type="button"
              variant="default"
              size="lg"
              onClick={() => void patchConfirmed(true)}
              disabled={saving || !canConfirm}
              title={!canConfirm && gateReason ? gateReason : undefined}
              className="bg-green-600 hover:bg-green-700 text-white w-full"
            >
              {saving ? (
                <Loader2 className="size-4 mr-1.5 animate-spin shrink-0" />
              ) : (
                <CheckCircle2 className="size-4 mr-1.5 shrink-0" />
              )}
              <span className="truncate">
                Confirm {familyName || "Family"} Registration
              </span>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ─────────────────────── Archive registration ─────────────────────── */

/**
 * Toggle the family's registration-progress `isArchived` flag.
 * Renders as either "Archive registration" (when active) or
 * "Unarchive" (when already archived) — same button, opposite
 * action — so admin has a reversible affordance for both
 * directions. Both transitions are wrapped in a warning modal
 * because archiving silently disappears the row from the active
 * Registrations queues and admin should mean to do it.
 */
function ArchiveRegistrationButton({
  familyId,
  yearId,
  familyName,
  archived,
  onChanged,
}: {
  familyId: number;
  yearId: number;
  familyName: string;
  archived: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function runArchive() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/registration-progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyId,
          yearId,
          isArchived: !archived,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Update failed (${res.status})`);
      }
      toast.success(
        archived
          ? `${familyName || "Family"} unarchived.`
          : `${familyName || "Family"} archived.`
      );
      setOpen(false);
      onChanged();
    } catch (err) {
      console.error("[ArchiveRegistrationButton.runArchive] failed:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't update.");
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
        className="bg-white w-full"
      >
        {saving ? (
          <Loader2 className="size-4 mr-1.5 animate-spin shrink-0" />
        ) : (
          <ArchiveIcon className="size-4 mr-1.5 shrink-0" />
        )}
        <span className="truncate">
          {archived ? "Unarchive" : "Archive"}
        </span>
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
              {archived
                ? `Unarchive ${familyName || "family"}?`
                : `Archive ${familyName || "family"} registration?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archived
                ? "The family returns to the active Registrations queues. No data changes — this just clears the archive flag."
                : "The family drops out of the active Registrations queues. Uploaded packet data, signatures, and verifies stay intact in case the archive is temporary. You can unarchive from this same button later."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              className={cn(
                archived
                  ? "bg-amber-600 hover:bg-amber-700"
                  : "bg-slate-600 hover:bg-slate-700",
                "text-white"
              )}
              onClick={(e) => {
                e.preventDefault();
                void runArchive();
              }}
            >
              {saving ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : null}
              {archived ? "Yes, unarchive" : "Yes, archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
