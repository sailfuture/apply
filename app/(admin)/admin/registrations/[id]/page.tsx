"use client";

import { useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Undo2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FamilyNotesSheet } from "@/components/admin/family-notes-sheet";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import type { AdminFamilyRegistrationResponse } from "@/app/api/admin/registrations/[id]/route";

/**
 * Admin family-focused registration detail page.
 *
 * URL: `/admin/registrations/[id]?yearId=X` (the dynamic segment is
 * the family id — same shape as `/admin/families/[id]` so admin can
 * tab between an apply-flow view and a registration-flow view of the
 * same family).
 *
 * Renders four packet section cards stacked vertically:
 *
 *   1. Tuition — family-level signature + monthly payment snapshot
 *   2. Enrollment Agreement — PandaDoc status + signed PDF link
 *   3. Registration Packet — per-student rows with `registrationConfirmed`
 *      toggle. The packet content itself (medical forms, file uploads)
 *      lives on the parent flow; admin sees the rollup state and
 *      flips the confirm bit when review is complete.
 *   4. Volunteer Hours — printed name + signature acknowledgment
 *
 * All four section cards read from the family-level
 * `registration_student_registration_progress` row except the
 * Registration Packet table, which joins the per-student
 * `registration_student_registration` packets.
 *
 * Admin actions are minimal on purpose: each card has a single
 * "Mark Confirmed / Reset" toggle that flips the corresponding
 * boolean on the family-progress row, plus a per-student confirm
 * toggle inside the Registration Packet card. Anything more invasive
 * (re-send PandaDoc, void signature, etc.) lives behind future
 * affordances we'll add as the workflow demands them.
 */
export default function FamilyRegistrationDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const yearId = searchParams.get("yearId");
  const familyId = Number(params.id);

  const swrKey =
    Number.isFinite(familyId) && yearId
      ? `/api/admin/registrations/${familyId}?yearId=${yearId}`
      : null;
  const { data, isLoading, error, mutate } =
    useSWR<AdminFamilyRegistrationResponse>(swrKey, adminFetcher);

  const backHref = yearId
    ? `/admin/registrations?yearId=${yearId}`
    : "/admin/registrations";

  if (!yearId) {
    return (
      <div className="p-6 space-y-4">
        <BackLink href={backHref} />
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view the family&rsquo;s registration.
        </div>
      </div>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="p-6 space-y-4">
        <BackLink href={backHref} />
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 space-y-4">
        <BackLink href={backHref} />
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          {error instanceof Error
            ? error.message
            : "Couldn’t load this family’s registration."}
        </div>
      </div>
    );
  }

  const { family, primary, school_year, progress, students } = data;
  const familyName =
    family?.family_name?.trim() || `Family #${family?.id ?? familyId}`;

  /**
   * Refetch helper. Each card-level admin action revalidates this
   * SWR key so the section pill + table state reflect the latest
   * Xano truth without a full reload.
   */
  const refresh = () => {
    void mutate();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <BackLink href={backHref} />
          <h1 className="mt-2 text-2xl font-semibold truncate">
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
          <FamilyNotesSheet
            familyId={Number(family?.id ?? familyId)}
            defaultYearId={Number(yearId)}
          />
          {/* Quick jump back to the apply-flow detail page — useful
              when admin needs to reference scholarship state or
              parent records mid-registration review. */}
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

      <div className="space-y-6">
        <section id="section-tuition" className="scroll-mt-20">
          <TuitionCard
            familyId={Number(family?.id ?? familyId)}
            yearId={Number(yearId)}
            progress={progress}
            schoolYear={school_year}
            onChanged={refresh}
          />
        </section>

        <section id="section-enrollment" className="scroll-mt-20">
          <EnrollmentAgreementCard
            familyId={Number(family?.id ?? familyId)}
            yearId={Number(yearId)}
            progress={progress}
            onChanged={refresh}
          />
        </section>

        <section id="section-registration" className="scroll-mt-20">
          <RegistrationPacketCard
            familyId={Number(family?.id ?? familyId)}
            yearId={Number(yearId)}
            progress={progress}
            students={students}
            onChanged={refresh}
          />
        </section>

        <section id="section-volunteer" className="scroll-mt-20">
          <VolunteerHoursCard
            familyId={Number(family?.id ?? familyId)}
            yearId={Number(yearId)}
            progress={progress}
            onChanged={refresh}
          />
        </section>
      </div>
    </div>
  );
}

function BackLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      <ArrowLeft className="size-3" />
      Back to registrations
    </Link>
  );
}

/**
 * Status pill rendered at the top-right of each section card.
 * Confirmed = filled green; Pending = neutral outline. Visually
 * cheap, consistent across all four cards so admin can scan
 * "what's left to confirm" by skimming the right edge of the page.
 */
function StatusPill({ confirmed }: { confirmed: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider",
        confirmed
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-border bg-muted text-muted-foreground"
      )}
    >
      {confirmed ? (
        <CheckCircle2 className="size-3" />
      ) : null}
      {confirmed ? "Confirmed" : "Pending"}
    </span>
  );
}

/**
 * Generic confirm/reset action button for the family-level booleans
 * (`isTuition`, `isEnrollment`, `isVolunteerHours`). The Registration
 * Packet card has per-student logic so it doesn't use this — it
 * computes its own rollup state.
 */
function SectionConfirmButton({
  familyId,
  yearId,
  field,
  confirmed,
  onChanged,
}: {
  familyId: number;
  yearId: number;
  field: "isTuition" | "isEnrollment" | "isRegistration" | "isVolunteerHours";
  confirmed: boolean;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);

  async function run() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/registration-progress", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyId,
          yearId,
          [field]: !confirmed,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Update failed (${res.status})`);
      }
      toast.success(confirmed ? "Marked pending." : "Marked confirmed.");
      onChanged();
    } catch (err) {
      console.error(`[SectionConfirmButton.${field}]`, err);
      toast.error(err instanceof Error ? err.message : "Couldn't update.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Button
      variant={confirmed ? "outline" : "default"}
      size="sm"
      onClick={run}
      disabled={saving}
      className={cn(confirmed && "bg-white")}
    >
      {saving ? (
        <Loader2 className="size-3.5 mr-1.5 animate-spin" />
      ) : confirmed ? (
        <Undo2 className="size-3.5 mr-1.5" />
      ) : (
        <CheckCircle2 className="size-3.5 mr-1.5" />
      )}
      {confirmed ? "Reset" : "Mark Confirmed"}
    </Button>
  );
}

/**
 * One row of `<dt>/<dd>` styled metadata. Used in every section card
 * for the read-only fact list (printed name, signed timestamp, etc.).
 * `value` falls back to an em-dash so empty fields still align in
 * the grid.
 */
function FactRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b last:border-0">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm text-foreground text-right truncate">
        {value || "—"}
      </span>
    </div>
  );
}

interface TuitionCardProps {
  familyId: number;
  yearId: number;
  progress: AdminFamilyRegistrationResponse["progress"];
  schoolYear: AdminFamilyRegistrationResponse["school_year"];
  onChanged: () => void;
}
function TuitionCard({
  familyId,
  yearId,
  progress,
  schoolYear,
  onChanged,
}: TuitionCardProps) {
  const confirmed = !!progress?.isTuition;
  const monthlyTuition = progress?.monthly_tuition_payment ?? 0;
  const monthlyTransport = progress?.monthly_transportation_payment ?? 0;
  const printedName = progress?.name?.trim() ?? "";
  const signed = !!progress?.tuition_scholarship_signature;

  return (
    <Card className="bg-white py-0 gap-0 overflow-hidden">
      <CardHeader className="py-4 border-b bg-muted/20">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Tuition</CardTitle>
          <StatusPill confirmed={confirmed} />
        </div>
        <p className="text-xs text-muted-foreground">
          Family acknowledged the tuition + scholarship breakdown for{" "}
          {schoolYear.year_name || "the year"}.
        </p>
      </CardHeader>
      <CardContent className="p-5 space-y-4">
        <div className="space-y-0.5">
          <FactRow
            label="Monthly Tuition"
            value={`$${monthlyTuition.toLocaleString()}`}
          />
          <FactRow
            label="Monthly Transportation"
            value={`$${monthlyTransport.toLocaleString()}`}
          />
          <FactRow label="Printed Name" value={printedName} />
          <FactRow
            label="Signature"
            value={signed ? "On file" : "Not signed"}
          />
        </div>
        <div className="flex justify-end pt-2">
          <SectionConfirmButton
            familyId={familyId}
            yearId={yearId}
            field="isTuition"
            confirmed={confirmed}
            onChanged={onChanged}
          />
        </div>
      </CardContent>
    </Card>
  );
}

interface EnrollmentAgreementCardProps {
  familyId: number;
  yearId: number;
  progress: AdminFamilyRegistrationResponse["progress"];
  onChanged: () => void;
}
function EnrollmentAgreementCard({
  familyId,
  yearId,
  progress,
  onChanged,
}: EnrollmentAgreementCardProps) {
  const confirmed = !!progress?.isEnrollment;
  const pdId = progress?.enrollment_agreement_pandadoc_id ?? "";
  const pdStatus = progress?.enrollment_agreement_status ?? "";
  const pdSent = progress?.enrollment_agreement_sent;
  const pdfUrl = progress?.enrollment_agreement_pdf_url ?? "";
  const isSigned = !!progress?.is_enrollment_agreement_signed;

  return (
    <Card className="bg-white py-0 gap-0 overflow-hidden">
      <CardHeader className="py-4 border-b bg-muted/20">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Enrollment Agreement</CardTitle>
          <StatusPill confirmed={confirmed} />
        </div>
        <p className="text-xs text-muted-foreground">
          Tuition contract sent through PandaDoc. Mirror state shown
          here once the family signs.
        </p>
      </CardHeader>
      <CardContent className="p-5 space-y-4">
        <div className="space-y-0.5">
          <FactRow
            label="PandaDoc Status"
            value={
              isSigned
                ? "Signed"
                : pdStatus
                  ? formatPdStatus(pdStatus)
                  : "Not sent"
            }
          />
          <FactRow
            label="Sent"
            value={formatTimestamp(pdSent)}
          />
          <FactRow
            label="PandaDoc ID"
            value={pdId ? <span className="font-mono text-xs">{pdId}</span> : ""}
          />
          <FactRow
            label="Signed PDF"
            value={
              pdfUrl ? (
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                >
                  Open
                  <ExternalLink className="size-3" />
                </a>
              ) : (
                ""
              )
            }
          />
        </div>
        <div className="flex justify-end pt-2">
          <SectionConfirmButton
            familyId={familyId}
            yearId={yearId}
            field="isEnrollment"
            confirmed={confirmed}
            onChanged={onChanged}
          />
        </div>
      </CardContent>
    </Card>
  );
}

interface RegistrationPacketCardProps {
  familyId: number;
  yearId: number;
  progress: AdminFamilyRegistrationResponse["progress"];
  students: AdminFamilyRegistrationResponse["students"];
  onChanged: () => void;
}
function RegistrationPacketCard({
  familyId,
  yearId,
  progress,
  students,
  onChanged,
}: RegistrationPacketCardProps) {
  // Family-level packet boolean still gates the parent flow even
  // though confirmation now happens per student. We surface it
  // alongside the per-student rollup so admin can see both axes.
  const familyConfirmed = !!progress?.isRegistration;
  const total = students.length;
  const confirmedCount = students.filter(
    (s) => s.registrationConfirmed
  ).length;
  const allStudentsConfirmed = total > 0 && confirmedCount === total;

  return (
    <Card className="bg-white py-0 gap-0 overflow-hidden">
      <CardHeader className="py-4 border-b bg-muted/20">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Registration Packet</CardTitle>
          <StatusPill confirmed={familyConfirmed && allStudentsConfirmed} />
        </div>
        <p className="text-xs text-muted-foreground">
          Per-student packet review. Flip{" "}
          <span className="font-medium">Confirmed</span> on each row once
          the medical forms, emergency contacts, and uploads have been
          reviewed.
        </p>
      </CardHeader>
      <CardContent className="p-5 space-y-4">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active students for this year.
          </p>
        ) : (
          <div className="rounded-md border bg-white">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs">Student</TableHead>
                  <TableHead className="text-xs w-[70px]">Grade</TableHead>
                  <TableHead className="text-xs">Liability Waiver</TableHead>
                  <TableHead className="text-xs w-[140px]">Status</TableHead>
                  <TableHead className="text-xs text-right w-[170px]">
                    Action
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s) => (
                  <StudentPacketRow
                    key={s.student_id}
                    row={s}
                    onChanged={onChanged}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {confirmedCount} of {total} students confirmed
          </span>
          <SectionConfirmButton
            familyId={familyId}
            yearId={yearId}
            field="isRegistration"
            confirmed={familyConfirmed}
            onChanged={onChanged}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Per-student row inside the Registration Packet card. The Confirm
 * toggle here writes `registrationConfirmed` on the
 * `registration_student_registration` packet — the field that gates
 * the Enrolled Students list. Rows where the parent hasn't started
 * a packet yet show a disabled placeholder (we can't confirm
 * something that doesn't exist), with copy that nudges admin to wait
 * on the family.
 */
function StudentPacketRow({
  row,
  onChanged,
}: {
  row: AdminFamilyRegistrationResponse["students"][number];
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const hasPacket = row.packet_id != null;

  async function toggleConfirmed() {
    if (!hasPacket || row.packet_id == null) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/student-registration/${row.packet_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            registrationConfirmed: !row.registrationConfirmed,
          }),
        }
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Update failed (${res.status})`);
      }
      toast.success(
        row.registrationConfirmed
          ? `${row.student_full_name} marked pending.`
          : `${row.student_full_name} marked confirmed.`
      );
      onChanged();
    } catch (err) {
      console.error("[StudentPacketRow.toggleConfirmed]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't update.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableRow>
      <TableCell className="text-sm font-medium align-middle truncate">
        {row.student_full_name}
      </TableCell>
      <TableCell className="text-sm align-middle">
        {row.student_grade || "—"}
      </TableCell>
      <TableCell className="text-sm align-middle">
        {row.liability_waiver_pdf_url ? (
          <a
            href={row.liability_waiver_pdf_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-blue-600 hover:underline"
          >
            Open
            <ExternalLink className="size-3" />
          </a>
        ) : row.liability_waiver_status ? (
          <span className="text-xs text-muted-foreground">
            {formatPdStatus(row.liability_waiver_status)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="align-middle">
        {!hasPacket ? (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Not started
          </span>
        ) : row.registrationConfirmed ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800">
            <CheckCircle2 className="size-2.5" />
            Confirmed
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Pending
          </span>
        )}
      </TableCell>
      <TableCell className="text-right align-middle">
        <Button
          variant={row.registrationConfirmed ? "outline" : "default"}
          size="sm"
          onClick={toggleConfirmed}
          disabled={!hasPacket || saving}
          className={cn(
            "min-w-[140px]",
            row.registrationConfirmed && "bg-white"
          )}
        >
          {saving ? (
            <Loader2 className="size-3.5 mr-1.5 animate-spin" />
          ) : row.registrationConfirmed ? (
            <Undo2 className="size-3.5 mr-1.5" />
          ) : (
            <CheckCircle2 className="size-3.5 mr-1.5" />
          )}
          {row.registrationConfirmed ? "Reset" : "Mark Confirmed"}
        </Button>
      </TableCell>
    </TableRow>
  );
}

interface VolunteerHoursCardProps {
  familyId: number;
  yearId: number;
  progress: AdminFamilyRegistrationResponse["progress"];
  onChanged: () => void;
}
function VolunteerHoursCard({
  familyId,
  yearId,
  progress,
  onChanged,
}: VolunteerHoursCardProps) {
  const confirmed = !!progress?.isVolunteerHours;
  const printedName = progress?.name_volunteer?.trim() ?? "";
  const hasSignature =
    !!progress?.signature_data_volunteer ||
    !!progress?.volunteer_signature_data;

  return (
    <Card className="bg-white py-0 gap-0 overflow-hidden">
      <CardHeader className="py-4 border-b bg-muted/20">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Volunteer Hours</CardTitle>
          <StatusPill confirmed={confirmed} />
        </div>
        <p className="text-xs text-muted-foreground">
          Family acknowledged the 40 hour / year volunteer commitment
          (8 hours per academic term).
        </p>
      </CardHeader>
      <CardContent className="p-5 space-y-4">
        <div className="space-y-0.5">
          <FactRow label="Printed Name" value={printedName} />
          <FactRow
            label="Signature"
            value={hasSignature ? "On file" : "Not signed"}
          />
        </div>
        <div className="flex justify-end pt-2">
          <SectionConfirmButton
            familyId={familyId}
            yearId={yearId}
            field="isVolunteerHours"
            confirmed={confirmed}
            onChanged={onChanged}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Render PandaDoc statuses in a friendlier form. Status strings come
 * straight from the webhook ("document.sent", "document.completed",
 * etc.) — the leading "document." prefix is noise, and the
 * underscore-separated tail reads better Title Cased.
 */
function formatPdStatus(status: string): string {
  const cleaned = status.replace(/^document\./, "").replace(/_/g, " ");
  if (!cleaned) return status;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Render the enrollment-agreement `sent` timestamp. Xano stores it
 * as either an ISO string or epoch ms (the field is typed
 * `string | number | null` upstream); we accept both and fall
 * through to "—" on null/empty.
 */
function formatTimestamp(value: string | number | null | undefined): string {
  if (!value) return "—";
  const ts =
    typeof value === "number"
      ? value
      : Date.parse(value);
  if (!Number.isFinite(ts)) return "—";
  return new Date(ts).toLocaleString();
}
