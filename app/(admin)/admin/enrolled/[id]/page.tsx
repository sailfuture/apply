"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Pencil,
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import { formatNoteTimestamp } from "@/lib/format-note-time";
import type { AdminEnrolledStudentResponse } from "@/app/api/admin/enrolled/[id]/route";

/**
 * Admin Enrolled Student detail page.
 *
 * URL: `/admin/enrolled/[id]?yearId=X`
 *   `[id]` is the student id; `yearId` scopes to the student's
 *   year-specific packet (re-enrolled students have packets across
 *   multiple years).
 *
 * Single-student view — does NOT show family-level information
 * beyond a one-line context strip at the top (family name + primary
 * contact). Everything else is the student's bio + their per-year
 * application + their registration packet.
 *
 * Read-only on most fields. The one mutation here is the
 * `registrationConfirmed` toggle on the packet — admin can revert
 * the confirmation if they need to (parent can then re-edit). Other
 * edits (medical info, file uploads) belong on the parent flow;
 * admin overrides are handled on the family registration detail
 * page if needed.
 */
export default function EnrolledStudentDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const studentId = Number(params.id);

  const swrKey =
    Number.isFinite(studentId) && yearId
      ? `/api/admin/enrolled/${studentId}?yearId=${yearId}`
      : null;
  const { data, isLoading, error, mutate } =
    useSWR<AdminEnrolledStudentResponse>(swrKey, adminFetcher);

  const backHref = yearId
    ? `/admin/enrolled?yearId=${yearId}`
    : "/admin/enrolled";

  if (!yearId) {
    return (
      <div className="p-6 space-y-4">
        <BackLink href={backHref} />
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view this student&rsquo;s details.
        </div>
      </div>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="p-6 space-y-4">
        <BackLink href={backHref} />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
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
            : "Couldn’t load this student’s details."}
        </div>
      </div>
    );
  }

  const { student, app, packet, family, primary, school_year } = data;
  const fullName =
    `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() ||
    `Student #${studentId}`;

  // Edit destination — for now we route to the family's registration
  // detail with a hash anchor that scrolls right to this student's
  // packet card, so admin lands on a writable surface without a
  // dedicated student-editor page. Easy to swap to a per-student
  // editor route later.
  const editHref = family
    ? `/admin/registrations/${family.id}?yearId=${yearId}#section-registration`
    : null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <BackLink href={backHref} />
          <h1 className="mt-2 text-2xl font-semibold truncate">
            {fullName}
            {school_year?.year_name ? (
              <span className="ml-2 text-base font-normal text-muted-foreground">
                · {school_year.year_name}
              </span>
            ) : null}
          </h1>
          {/* Family + primary contact are context only — the rest of
              this page is single-student. Click-through goes to the
              family registration detail when admin needs the broader
              view. */}
          {family || primary ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {family?.family_name ? (
                <span>{family.family_name}</span>
              ) : null}
              {family?.family_name && primary ? <span> · </span> : null}
              {primary ? (
                <span>
                  {`${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()}
                  {primary.email ? ` · ${primary.email}` : ""}
                </span>
              ) : null}
            </p>
          ) : null}
          {/* Data staleness — most recent write to either the student
              row or the per-year packet. Two timestamps because edits
              can land on either: bio + docs land on the student row,
              medical / sizing / waiver land on the packet. Showing
              both helps admin spot mismatches ("bio updated yesterday
              but packet hasn't been touched since June"). */}
          {student.last_edited_time ? (
            <p className="mt-0.5 text-xs text-muted-foreground/80">
              Student edited{" "}
              <span title={new Date(student.last_edited_time).toLocaleString()}>
                {formatNoteTimestamp(student.last_edited_time)}
              </span>
            </p>
          ) : null}
          {packet?.last_edited_time ? (
            <p className="mt-0.5 text-xs text-muted-foreground/80">
              Packet edited{" "}
              <span title={new Date(packet.last_edited_time).toLocaleString()}>
                {formatNoteTimestamp(packet.last_edited_time)}
              </span>
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Edit jumps to the family registration detail page where
              admin can mutate the registration packet + flip the
              verify state. Right next to View family registration so
              the two destinations are visually paired. */}
          {editHref ? (
            <Button asChild variant="outline" size="sm" className="bg-white">
              <Link href={editHref}>
                <Pencil className="size-3.5 mr-1.5" />
                Edit
              </Link>
            </Button>
          ) : null}
          {family ? (
            <Button asChild variant="outline" size="sm" className="bg-white">
              <Link
                href={`/admin/registrations/${family.id}?yearId=${yearId}`}
              >
                View family registration
                <ExternalLink className="size-3.5 ml-1.5" />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <StudentBioCard student={student} app={app} />

      <PacketCard
        packet={packet}
        student={student}
        onChanged={() => void mutate()}
      />

      <TestingCard app={app} />
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
      Back to enrolled students
    </Link>
  );
}

/**
 * Read-only student bio + per-year application context. Two columns
 * of `<DisabledField>` so the rhythm matches the admin family
 * detail page's `SectionShell` content.
 */
function StudentBioCard({
  student,
  app,
}: {
  student: AdminEnrolledStudentResponse["student"];
  app: AdminEnrolledStudentResponse["app"];
}) {
  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <CardTitle className="text-base">Student</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 py-5 bg-white">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <ReadField label="First name" value={student.first_name} />
          <ReadField label="Last name" value={student.last_name} />
          <ReadField label="Date of birth" value={student.date_of_birth} />
          <ReadField label="Gender" value={student.gender} />
          <ReadField label="Ethnicity" value={student.ethnicity} />
          <ReadField label="Incoming grade" value={app?.current_grade ?? ""} />
        </div>
        {app ? (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <ReadField
              label="Current grade"
              value={app.last_grade_completed}
            />
            <ReadField
              label="Previous school"
              value={app.current_previous_school}
            />
            <ReadField
              label="Bus transportation"
              value={app.is_bus_transportation ? "Yes" : "No"}
            />
            <ReadField
              label="Bus stop"
              value={
                app.is_bus_transportation && app.bus_stop ? app.bus_stop : "—"
              }
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Registration packet card — surfaces the medical / health / pickup
 * info the parent submitted, plus the file uploads on the packet.
 * The single mutation here is the `registrationConfirmed` toggle in
 * the footer, mirroring the per-student row on the family registration
 * detail page so admin can flip it from either surface.
 */
function PacketCard({
  packet,
  student,
  onChanged,
}: {
  packet: AdminEnrolledStudentResponse["packet"];
  student: AdminEnrolledStudentResponse["student"];
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);

  if (!packet) {
    return (
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Registration Packet</CardTitle>
        </CardHeader>
        <CardContent className="py-5 bg-white">
          <p className="text-sm text-muted-foreground">
            No registration packet on file for this student. The
            family hasn&rsquo;t started the post-acceptance flow yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  async function toggleConfirmed() {
    if (!packet) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/student-registration/${packet.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            registrationConfirmed: !packet.registrationConfirmed,
          }),
        }
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Update failed (${res.status})`);
      }
      toast.success(
        packet.registrationConfirmed
          ? `${student.first_name} marked pending.`
          : `${student.first_name} marked confirmed.`
      );
      onChanged();
    } catch (err) {
      console.error("[PacketCard.toggleConfirmed]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't update.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Registration Packet</CardTitle>
          <div className="flex flex-col items-end gap-0.5">
            {packet.registrationConfirmed ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800">
                <CheckCircle2 className="size-2.5" />
                Confirmed
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Pending
              </span>
            )}
            {/* Audit caption — only renders on confirmed packets that
                carry the audit pair (legacy rows predate the columns,
                so we tolerate either piece being missing). Mirrors the
                section-confirm captions on the family detail page so
                admin sees who/when across surfaces. */}
            {packet.registrationConfirmed &&
            (packet.registration_confirmed_admin_name ||
              packet.registration_confirmed_admin_time) ? (
              <span
                className="text-[10px] text-muted-foreground/80"
                title={
                  packet.registration_confirmed_admin_time
                    ? new Date(
                        packet.registration_confirmed_admin_time
                      ).toLocaleString()
                    : undefined
                }
              >
                {packet.registration_confirmed_admin_name
                  ? `by ${packet.registration_confirmed_admin_name}`
                  : ""}
                {packet.registration_confirmed_admin_name &&
                packet.registration_confirmed_admin_time
                  ? " · "
                  : ""}
                {packet.registration_confirmed_admin_time
                  ? formatNoteTimestamp(
                      packet.registration_confirmed_admin_time
                    )
                  : ""}
              </span>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent
        className={cn(
          "space-y-6 py-5 bg-white transition-colors",
          packet.registrationConfirmed && "bg-muted/30"
        )}
      >
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Sizing
          </p>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <ReadField label="Shirt size" value={packet.shirt_size} />
            <ReadField label="Pant size" value={packet.pant_size} />
            <ReadField label="Swim level" value={packet.swim_level} />
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Medical
          </p>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <ReadField label="Allergies" value={packet.allergies} />
            <ReadField
              label="Dietary restrictions"
              value={packet.dietary_restrictions}
            />
            <ReadField
              label="Prescription medications"
              value={packet.prescription_medications}
            />
            <ReadField
              label="Health conditions"
              value={packet.health_conditions}
            />
            <ReadField
              label="Vision impairments"
              value={packet.vision_impairments}
            />
            <ReadField
              label="Hearing impairments"
              value={packet.hearing_impairments}
            />
            <ReadField
              label="On Medicaid"
              value={packet.is_student_on_medicaid ? "Yes" : "No"}
            />
            <ReadField
              label="Carries EpiPen"
              value={packet.carry_epi_pen ? "Yes" : "No"}
            />
          </div>
          {packet.iep_description ? (
            <ReadField
              label="IEP description"
              value={packet.iep_description}
            />
          ) : null}
          {packet.epipen_explainer ? (
            <ReadField
              label="EpiPen details"
              value={packet.epipen_explainer}
            />
          ) : null}
          {packet.additional_health_information ? (
            <ReadField
              label="Additional health information"
              value={packet.additional_health_information}
            />
          ) : null}
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Pickup &amp; counseling
          </p>
          <div className="grid gap-4 grid-cols-1">
            <ReadField
              label="Other adults approved for pickup"
              value={packet.other_adults_approved_for_pickup}
            />
            <ReadField
              label="Prohibited adults"
              value={packet.prohibited_adults}
            />
            <ReadField
              label="Acetaminophen permission"
              value={packet.permission_for_acetaminophen}
            />
            <ReadField
              label="Counseling services interest"
              value={packet.interested_in_counseling_services}
            />
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Documents
          </p>
          {/* The waiver is per-packet (single PDF returned by PandaDoc).
              Every other document category lives on the *student* row
              as an array of file blobs — parents can upload multiple
              pages per category — so we render a separate row per
              file instead of a single "Open" link. */}
          <ul className="text-sm space-y-1.5">
            <FileLine
              label="Liability waiver (signed)"
              url={packet.liability_waiver_pdf_url}
              /* Status caption — only render on packets where the
                 waiver has been kicked off but isn't fully signed
                 yet, so admin can spot "sent 6 weeks ago, never
                 returned" rows at a glance. PandaDoc completed
                 packets carry a PDF URL and the FileLine renders
                 "Open" — no caption needed in that case. */
              caption={
                !packet.liability_waiver_pdf_url &&
                packet.liability_waiver_status &&
                packet.liability_waiver_sent_at
                  ? `${packet.liability_waiver_status} · sent ${formatNoteTimestamp(
                      new Date(packet.liability_waiver_sent_at).getTime()
                    )}`
                  : undefined
              }
            />
            <FileGroup label="Birth certificate" files={student.birth_certificate} />
            <FileGroup label="School health form" files={student.school_health_form} />
            <FileGroup label="Transcripts" files={student.transcripts} />
            <FileGroup label="IEP" files={student.iep} />
            <FileGroup label="SSN card" files={student.ssn_card} />
            <FileGroup label="Immunization forms" files={student.immunization_forms} />
            <FileGroup label="Passport" files={student.passport} />
            <FileGroup label="State ID" files={student.student_state_id} />
          </ul>
        </div>
      </CardContent>
      {/* Confirmation footer mirrors the SectionShell footer used on
          the apply-flow family detail page so admin sees the same
          "Confirm / Undo" affordance everywhere. Spinner gates the
          double-click. */}
      <div className="border-t bg-white px-5 py-3 flex items-center justify-end gap-3">
        <Button
          type="button"
          variant={packet.registrationConfirmed ? "outline" : "default"}
          size="sm"
          onClick={toggleConfirmed}
          disabled={saving}
          className={cn(packet.registrationConfirmed && "bg-white")}
        >
          {saving ? (
            <Loader2 className="size-3.5 mr-1.5 animate-spin" />
          ) : packet.registrationConfirmed ? (
            <Undo2 className="size-3.5 mr-1.5" />
          ) : (
            <CheckCircle2 className="size-3.5 mr-1.5" />
          )}
          {packet.registrationConfirmed ? "Undo Confirmation" : "Confirm Packet"}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Initial testing — read-only summary of NWEA scheduling + the
 * admin-entered RIT scores from the family detail page. Lives on
 * this surface as a sibling card so the per-student view is a
 * single self-contained page.
 */
function TestingCard({
  app,
}: {
  app: AdminEnrolledStudentResponse["app"];
}) {
  if (!app) return null;
  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <CardTitle className="text-base">Initial Testing (NWEA)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 py-5 bg-white">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <ReadField
            label="Scheduled"
            value={app.nwea_testing_scheduled ? "Yes" : "No"}
          />
          <ReadField
            label="Complete"
            value={app.nwea_testing_complete ? "Yes" : "No"}
          />
          <ReadField
            label="Math RIT score"
            value={
              app.initial_screening_nwea_math != null
                ? String(app.initial_screening_nwea_math)
                : ""
            }
          />
          <ReadField
            label="Math test date"
            value={app.initial_screening_nwea_math_date ?? ""}
          />
          <ReadField
            label="Reading RIT score"
            value={
              app.initial_screening_nwea_reading != null
                ? String(app.initial_screening_nwea_reading)
                : ""
            }
          />
          <ReadField
            label="Reading test date"
            value={app.initial_screening_nwea_reading_date ?? ""}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Read-only field — labeled disabled input. Standalone here rather
 * than imported because the family detail page's `DisabledField` is
 * not exported, and the rule for both surfaces is identical:
 * `text-xs` label, `disabled` input, em-dash for empty.
 */
function ReadField({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  const display =
    value === null || value === undefined || value === ""
      ? "—"
      : String(value);
  return (
    <Field>
      <FieldLabel className="text-xs">{label}</FieldLabel>
      <Input
        value={display}
        disabled
        className="border-input bg-white text-foreground disabled:opacity-100 disabled:cursor-default"
      />
    </Field>
  );
}

/**
 * Renders one file/url row inside the Documents list. Accepts either
 * a Xano file metadata object (`{ path, url, mime, size }`) or a
 * plain URL string (used for the liability waiver PDF). Empty values
 * collapse to a muted "Not uploaded" line.
 */
function FileLine({
  label,
  file,
  url,
  caption,
}: {
  label: string;
  /** Xano file metadata blob — could be object or array (legacy). */
  file?: Record<string, unknown> | null;
  /** Direct URL fallback (used by the liability waiver PDF). */
  url?: string;
  /** Optional muted caption rendered under the label — used to show
   *  in-progress status on the waiver row ("sent · 2 weeks ago"). */
  caption?: string;
}) {
  const resolvedUrl = url || resolveFileUrl(file);
  return (
    <li className="flex items-center justify-between gap-3 border-t first:border-t-0 py-1.5">
      <div className="min-w-0">
        <span className="text-sm text-muted-foreground">{label}</span>
        {caption ? (
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
            {caption}
          </p>
        ) : null}
      </div>
      {resolvedUrl ? (
        <a
          href={resolvedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
        >
          Open
          <ExternalLink className="size-3" />
        </a>
      ) : (
        <span className="text-xs italic text-muted-foreground/70">
          Not uploaded
        </span>
      )}
    </li>
  );
}

/**
 * Pick a usable URL out of Xano's file-metadata blob. Tries
 * `file.url` first, then prepends the public Xano base to `file.path`
 * — same fallback the docs review block uses, kept inline here so
 * this page doesn't import from another component file.
 */
function resolveFileUrl(file: Record<string, unknown> | null | undefined): string | null {
  if (!file || typeof file !== "object") return null;
  const url = (file as { url?: unknown }).url;
  if (typeof url === "string" && url.length > 0) return url;
  const path = (file as { path?: unknown }).path;
  if (typeof path === "string" && path.length > 0) {
    const base =
      process.env.NEXT_PUBLIC_XANO_BASE ??
      "https://xsc3-mvx7-r86m.n7e.xano.io";
    return `${base}${path}`;
  }
  return null;
}

/**
 * Renders a labeled group of files for one document category — used
 * for the document arrays that live on the student row (birth
 * certificate, transcripts, IEP, etc.). Parents can upload multiple
 * pages per category, so a single row would lose detail.
 *
 * Layout:
 *   - Empty array → single "Not uploaded" row, mirroring the old
 *     `FileLine` look so the section reads consistently.
 *   - One file → single row with truncated filename + Open link.
 *   - Multiple files → header row with the category label + count,
 *     then one indented row per file.
 *
 * Filename truncation lives in CSS (`truncate` + `max-w-*`) rather
 * than JS so the text reflows on resize and the full filename is
 * always available via the `title` attribute on hover.
 */
function FileGroup({
  label,
  files,
}: {
  label: string;
  files: Record<string, unknown>[] | null | undefined;
}) {
  const entries = Array.isArray(files) ? files : [];
  if (entries.length === 0) {
    return (
      <li className="flex items-center justify-between gap-3 border-t first:border-t-0 py-1.5">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-xs italic text-muted-foreground/70">
          Not uploaded
        </span>
      </li>
    );
  }
  if (entries.length === 1) {
    const f = entries[0];
    const url = resolveFileUrl(f);
    const name =
      typeof (f as { name?: unknown }).name === "string"
        ? ((f as { name: string }).name)
        : "";
    return (
      <li className="flex items-center justify-between gap-3 border-t first:border-t-0 py-1.5">
        <span className="text-sm text-muted-foreground shrink-0">{label}</span>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline min-w-0"
            title={name || undefined}
          >
            <span className="truncate max-w-[18rem]">
              {name || "Open"}
            </span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
        ) : (
          <span className="text-xs italic text-muted-foreground/70">
            Unavailable
          </span>
        )}
      </li>
    );
  }
  return (
    <li className="border-t first:border-t-0 py-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground/70">
          {entries.length} files
        </span>
      </div>
      <ul className="mt-1.5 space-y-1 pl-3">
        {entries.map((f, idx) => {
          const url = resolveFileUrl(f);
          const name =
            typeof (f as { name?: unknown }).name === "string"
              ? ((f as { name: string }).name)
              : `File ${idx + 1}`;
          // `path` is unique per file in Xano's vault, so it's a
          // stable key across re-renders even when `name` collides
          // (parents sometimes upload `image.png` twice).
          const path =
            typeof (f as { path?: unknown }).path === "string"
              ? ((f as { path: string }).path)
              : `idx-${idx}`;
          return (
            <li
              key={path}
              className="flex items-center justify-between gap-3"
            >
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline min-w-0"
                  title={name}
                >
                  <span className="truncate max-w-[18rem]">{name}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              ) : (
                <span className="text-xs italic text-muted-foreground/70">
                  {name} · unavailable
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </li>
  );
}
