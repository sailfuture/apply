"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, ChevronDown, ExternalLink, FileText, Pin } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/admin/status-badge";
import { FamilyNotes } from "@/components/admin/family-notes";
import { deriveApplicationStatus } from "@/lib/application-status";
import type {
  XanoApplication,
  XanoRegistrationDetails,
  XanoStudent,
} from "@/lib/xano";
import { useState } from "react";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface StudentResponse {
  student: XanoStudent;
  family: { id: number; family_name: string; isAccepted: boolean; isSubmitted: boolean } | null;
  applications: XanoApplication[];
  packets: XanoRegistrationDetails[];
}

const xanoBase =
  process.env.NEXT_PUBLIC_XANO_BASE ?? "https://xsc3-mvx7-r86m.n7e.xano.io";

const REQUIRED_DOCS: { key: keyof XanoStudent; label: string }[] = [
  { key: "birth_certificate", label: "Birth Certificate" },
  { key: "school_health_form", label: "School Health Form" },
  { key: "transcripts", label: "Transcripts" },
  { key: "immunization_forms", label: "Immunization Forms" },
];

const OPTIONAL_DOCS: { key: keyof XanoStudent; label: string }[] = [
  { key: "iep", label: "IEP" },
  { key: "ssn_card", label: "SSN Card" },
  { key: "passport", label: "Passport" },
  { key: "student_state_id", label: "Student State ID" },
];

/**
 * Per-student admin record. Multi-year history view — student basics +
 * cross-year documents at the top, then a year-by-year accordion with
 * application + packet details for each year the student has on file.
 *
 * Notes pane lives at the bottom (filtered to this student's family,
 * narrowed to this student via `defaultStudentId`).
 */
export default function AdminStudentDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const studentId = Number(params.id);

  const { data, isLoading } = useSWR<StudentResponse>(
    studentId ? `/api/admin/students/${studentId}` : null,
    fetcher
  );

  const backHref = yearId ? `/admin/students?yearId=${yearId}` : "/admin/students";

  if (isLoading || !data) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  const { student, family, applications, packets } = data;

  // Build a unified list of "years on file" merging applications + packets
  // by their school_years_id. A student might have an app for a year but
  // no packet (still applying) or a packet but no app (rare — mostly
  // historical data fixes).
  const yearMap = new Map<
    number,
    { yearId: number; app?: XanoApplication; packet?: XanoRegistrationDetails }
  >();
  for (const app of applications) {
    const yid = Number(app.registration_school_years_id);
    yearMap.set(yid, { ...(yearMap.get(yid) ?? { yearId: yid }), app });
  }
  for (const packet of packets) {
    const yid = Number(packet.registration_school_years_id);
    yearMap.set(yid, { ...(yearMap.get(yid) ?? { yearId: yid }), packet });
  }
  const years = Array.from(yearMap.values()).sort((a, b) => b.yearId - a.yearId);

  const photo = parsePhoto(student.photo);

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Link href={backHref}>
          <Button variant="outline" size="icon" className="size-8 bg-white">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-3 min-w-0">
          {photo ? (
            // Inline element rendered through next/image isn't necessary here —
            // these are arbitrary uploaded files and the size is small enough
            // that the layout-shift cost is negligible.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt=""
              className="size-12 rounded-full object-cover border bg-white"
            />
          ) : (
            <div className="size-12 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground">
              {(student.first_name?.[0] ?? "").toUpperCase()}
              {(student.last_name?.[0] ?? "").toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold truncate">
              {student.first_name} {student.last_name}
            </h1>
            <p className="text-xs text-muted-foreground truncate">
              {family ? (
                <Link
                  href={`/admin/families/${family.id}`}
                  className="hover:text-foreground underline-offset-2 hover:underline"
                >
                  {family.family_name || `Family #${family.id}`}
                </Link>
              ) : (
                "No family on file"
              )}
              {student.date_of_birth ? (
                <>
                  {" · "}
                  DOB {formatDob(student.date_of_birth)}
                </>
              ) : null}
              {student.gender ? ` · ${student.gender}` : null}
            </p>
          </div>
        </div>
      </div>

      {/* Cross-year documents — these live on the student row, not per-year. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documents (all years)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DocSection
            title="Required"
            docs={REQUIRED_DOCS}
            student={student}
          />
          <DocSection
            title="Optional"
            docs={OPTIONAL_DOCS}
            student={student}
          />
        </CardContent>
      </Card>

      {/* Year-by-year history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Year history</CardTitle>
        </CardHeader>
        <CardContent>
          {years.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No applications or packets on file for this student yet.
            </p>
          ) : (
            <div className="space-y-3">
              {years.map((y, i) => (
                <YearAccordion key={y.yearId} entry={y} defaultOpen={i === 0} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notes — scoped to family, narrowed to this student. */}
      {family ? (
        <FamilyNotes familyId={family.id} defaultStudentId={student.id} />
      ) : null}
    </div>
  );
}

function YearAccordion({
  entry,
  defaultOpen,
}: {
  entry: {
    yearId: number;
    app?: XanoApplication;
    packet?: XanoRegistrationDetails;
  };
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const yearName =
    entry.packet?._registration_school_years_1?.year_name ??
    `Year #${entry.yearId}`;
  const status = entry.app
    ? deriveApplicationStatus({
        ...entry.app,
        registrationConfirmed: entry.packet?.registrationConfirmed ?? false,
      })
    : null;

  return (
    <div className="rounded-lg border bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium">{yearName}</span>
          {status ? <StatusBadge status={status} /> : null}
          {entry.packet?.registrationConfirmed ? (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
              <Pin className="size-2.5" />
              Packet confirmed
            </span>
          ) : null}
        </div>
        <ChevronDown
          className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="border-t px-4 py-4 space-y-4">
          {entry.app ? <AppPanel app={entry.app} /> : <Empty label="No application for this year." />}
          {entry.packet ? <PacketPanel packet={entry.packet} /> : <Empty label="No registration packet for this year." />}
        </div>
      ) : null}
    </div>
  );
}

function AppPanel({ app }: { app: XanoApplication }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Application
      </p>
      <DetailGrid
        rows={[
          ["Current grade", app.current_grade || "—"],
          ["Last grade completed", app.last_grade_completed || "—"],
          ["Previous school", app.current_previous_school || "—"],
          ["Bus", app.is_bus_transportation ? `Yes${app.bus_stop ? ` · ${app.bus_stop}` : ""}` : "No"],
          ["SUFS type", app.sufs_type || "—"],
          ["SUFS status", app.sufs_status || "—"],
          ["OS award", String(app.opportunity_scholarship_award_amount ?? 0)],
          ["Strengths", app.describe_student_strengths || "—"],
          ["Growth", app.describe_student_opportunities_for_growth || "—"],
        ]}
      />
    </div>
  );
}

function PacketPanel({ packet }: { packet: XanoRegistrationDetails }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Registration packet
        {packet._registration_type?.type ? (
          <span className="ml-2 text-muted-foreground">· {packet._registration_type.type}</span>
        ) : null}
      </p>
      <DetailGrid
        rows={[
          ["Allergies", packet.allergies || "—"],
          ["Dietary", packet.dietary_restrictions || "—"],
          ["Medications", packet.prescription_medications || "—"],
          ["Health conditions", packet.health_conditions || "—"],
          ["Vision", packet.vision_impairments || "—"],
          ["Hearing", packet.hearing_impairments || "—"],
          ["Acetaminophen", packet.permission_for_acetaminophen || "—"],
          ["Counseling", packet.interested_in_counseling_services || "—"],
          ["Carries EpiPen", packet.carry_epi_pen ? "Yes" : "No"],
          ...(packet.carry_epi_pen
            ? ([["EpiPen notes", packet.epipen_explainer || "—"]] as [string, string][])
            : []),
          ["On Medicaid", packet.is_student_on_medicaid ? "Yes" : "No"],
          ...(packet.is_student_on_medicaid
            ? ([
                ["Medicaid provider", packet.medicaid_provider || "—"],
                ["Medicaid #", String(packet.medicaid_number ?? "—")],
              ] as [string, string][])
            : []),
          ["Approved pickup adults", packet.other_adults_approved_for_pickup || "—"],
          ["Prohibited adults", packet.prohibited_adults || "—"],
          ["Shirt size", packet.shirt_size || "—"],
          ["Pant size", packet.pant_size || "—"],
          ["Swim level", packet.swim_level || "—"],
          ["Liability waiver", waiverLabel(packet)],
        ]}
      />
    </div>
  );
}

function waiverLabel(p: XanoRegistrationDetails): string {
  if (!p.liability_waiver_status) return "Not sent";
  return p.liability_waiver_pdf_url
    ? `${p.liability_waiver_status} (signed)`
    : p.liability_waiver_status;
}

function DetailGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <span className="text-sm font-medium whitespace-pre-wrap">{value}</span>
        </div>
      ))}
    </div>
  );
}

function DocSection({
  title,
  docs,
  student,
}: {
  title: string;
  docs: { key: keyof XanoStudent; label: string }[];
  student: XanoStudent;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {docs.map(({ key, label }) => {
          const files = ensureFileArray(student[key]);
          return (
            <div
              key={String(key)}
              className="rounded-md border bg-white px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <FileText className="size-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">{label}</span>
              </div>
              {files.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-1">
                  No file on record.
                </p>
              ) : (
                <ul className="mt-1 space-y-0.5">
                  {files.map((f, i) => (
                    <li
                      key={(f.path as string) ?? i}
                      className="text-xs"
                    >
                      <a
                        href={(f.url as string) ?? `${xanoBase}${f.path}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary underline underline-offset-2 hover:no-underline truncate"
                      >
                        {(f.name as string) ?? `File ${i + 1}`}
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-xs text-muted-foreground italic">{label}</p>;
}

function formatDob(dob: string): string {
  return new Date(`${dob}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ensureFileArray(v: unknown): { name?: string; path?: string; url?: string }[] {
  if (Array.isArray(v)) {
    return v.filter(
      (f): f is { name?: string; path?: string; url?: string } =>
        f !== null && typeof f === "object" && !Array.isArray(f)
    );
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return [v as { name?: string; path?: string; url?: string }];
  }
  return [];
}

function parsePhoto(p: XanoStudent["photo"]): string | null {
  if (!p) return null;
  if (typeof p === "string") return p;
  if (typeof p === "object" && !Array.isArray(p)) {
    const meta = p as { url?: string; path?: string };
    if (meta.url) return meta.url;
    if (meta.path) return `${xanoBase}${meta.path}`;
  }
  return null;
}
