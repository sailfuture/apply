"use client";

import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Pencil } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/admin/status-badge";
import { FamilyNotes } from "@/components/admin/family-notes";
import { deriveApplicationStatus } from "@/lib/application-status";
import { adminFetcher } from "@/lib/admin-fetcher";
import type {
  XanoApplication,
  XanoAdminFamilyDetail,
  XanoScholarship,
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
  const { data: detail, isLoading: detailLoading } =
    useSWR<XanoAdminFamilyDetail>(detailKey, adminFetcher);

  const backHref = yearId
    ? `/admin/applications?yearId=${yearId}`
    : "/admin/applications";

  const sectionHref = (slug: string) =>
    `/admin/families/${familyId}/${slug}${yearId ? `?yearId=${yearId}` : ""}`;

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
  const students: Student[] = (family.registration_students_id ?? []).filter(
    (s): s is Student =>
      !!s && typeof s === "object" && typeof (s as { id?: unknown }).id === "number"
  );
  const familyApps: XanoApplication[] = detail?.application ?? [];
  const scholarship: XanoScholarship | null = detail?.scholarship?.[0] ?? null;
  const yearMeta = detail?.school_year ?? null;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link href={backHref}>
          <Button variant="outline" size="icon" className="size-8 bg-white">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">
            {family.family_name || `Family #${family.id}`}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            {yearMeta ? (
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {yearMeta.year_name}
              </span>
            ) : null}
            {/* Per-year submitted / accepted badges removed — those
                flags now live on `family_application_progress` and the
                Applications + Re-Applications tables already show them
                per row. The family detail page is family-wide and
                doesn't have a single "is this family accepted" answer
                anymore (it's per academic year). */}
          </div>
        </div>
      </div>

      {/* Parents / Guardians — one card per parent, fields rendered as
          disabled inputs so the layout matches the parent-side
          application form. The Edit button hops to the dedicated
          Family section editor where actual mutations happen. */}
      <SectionShell
        title="Parents / Guardians"
        editHref={sectionHref("family")}
      >
        {parents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No parents on file.</p>
        ) : (
          <div className="space-y-4">
            {parents.map((parent) => (
              <ParentBlock key={parent.id} parent={parent} />
            ))}
          </div>
        )}
      </SectionShell>

      {/* Students — bio block + per-app fields; the student demographics
          block is intentionally compact since the Students section
          editor surfaces the same fields with edit affordance. */}
      <SectionShell
        title={`Students${yearMeta ? ` · ${yearMeta.year_name}` : ""}`}
        editHref={sectionHref("students")}
      >
        {students.length === 0 ? (
          <p className="text-sm text-muted-foreground">No students on file.</p>
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

      {/* Testing — pulled out as its own card to mirror the parent-side
          NWEA form. Same input style as the rest of the page. */}
      {yearId ? (
        <SectionShell
          title="Initial Testing (NWEA)"
          editHref={sectionHref("testing")}
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
                  (a) => Number(a.registration_students_id) === student.id
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
      ) : null}

      {/* Opportunity Scholarship — only renders when the family actually
          has a scholarship row for this year. Same disabled-input
          treatment as the rest of the page; the section editor is the
          mutating surface. */}
      {yearId ? (
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
        >
          {detailLoading && !detail ? (
            <Skeleton className="h-48 w-full rounded-md" />
          ) : scholarship ? (
            <ScholarshipBlock scholarship={scholarship} />
          ) : (
            <p className="text-sm text-muted-foreground">
              No scholarship row for this family / year. The parent
              hasn&rsquo;t opened the Financial Aid section yet.
            </p>
          )}
        </SectionShell>
      ) : null}

      {/* Comms log — pinned notes float to top, then chronological. */}
      <FamilyNotes familyId={family.id} />
    </div>
  );
}

/* ─────────────────────── Layout shells ─────────────────────── */

/**
 * One titled section with an "Open editor" affordance in the top-right.
 * Wraps every card on this page so the visual rhythm matches the
 * application form (card → header with action → content with disabled
 * inputs).
 */
function SectionShell({
  title,
  editHref,
  children,
}: {
  title: string;
  editHref?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
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
      <SectionGroup title="Name">
        <div className="grid gap-4 grid-cols-2">
          <DisabledField label="First name" value={parent.first_name} />
          <DisabledField label="Last name" value={parent.last_name} />
        </div>
      </SectionGroup>
      <SectionGroup title="Contact">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
          <DisabledField
            label="Email"
            value={parent.email}
            type="email"
          />
          <DisabledField label="Phone" value={parent.phone} />
          <DisabledField
            label="Relationship"
            value={parent.relationship}
            placeholder="—"
          />
        </div>
      </SectionGroup>
      <SectionGroup title="Address">
        <div className="grid gap-4 grid-cols-1">
          <DisabledField
            label="Street address"
            value={parent.address_line_1}
          />
          <DisabledField label="Apt / suite" value={parent.address_line_2} />
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <DisabledField label="City" value={parent.city} />
            <DisabledField label="State" value={parent.state} />
            <DisabledField label="Zip" value={parent.zipcode} />
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
        />
        <DisabledField label="Gender" value={student.gender} />
        <DisabledField label="Ethnicity" value={student.ethnicity} />
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
  const status = app ? deriveApplicationStatus(app) : null;
  return (
    <div className="rounded-md border bg-muted/10 p-4 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {student.first_name} {student.last_name}
          </p>
          {app ? (
            <p className="text-xs text-muted-foreground">
              App #{app.id} · Created{" "}
              {new Date(app.created_at).toLocaleDateString()}
            </p>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              No application row for this year.
            </p>
          )}
        </div>
        {status ? <StatusBadge status={status} /> : null}
      </div>

      {/* Demographics — sourced from the student record itself, not
          the per-year app. Always shown so the picture of who's
          applying stays at the top of the card. */}
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
          />
          <DisabledField label="Gender" value={student.gender} />
          <DisabledField label="Ethnicity" value={student.ethnicity} />
        </div>
      </SectionGroup>

      {app ? (
        <>
          <SectionGroup title="Academic">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
              <DisabledField
                label="Last grade completed"
                value={app.last_grade_completed}
              />
              <DisabledField
                label="Current grade"
                value={app.current_grade}
              />
              <DisabledField
                label="Previous school"
                value={app.current_previous_school}
              />
            </div>
          </SectionGroup>

          <SectionGroup title="About the student">
            <div className="space-y-4">
              <DisabledTextarea
                label="Strengths"
                value={app.describe_student_strengths}
              />
              <DisabledTextarea
                label="Opportunities for growth"
                value={app.describe_student_opportunities_for_growth}
              />
            </div>
          </SectionGroup>

          <SectionGroup title="SUFS / Scholarship awards">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
              <DisabledField
                label="SUFS type"
                value={app.sufs_type}
                placeholder="—"
              />
              <DisabledField
                label="SUFS status"
                value={app.sufs_status}
                placeholder="—"
              />
              <DisabledField
                label="SUFS award ID"
                value={
                  app.sufs_award_id ? String(app.sufs_award_id) : ""
                }
                placeholder="—"
              />
              <DisabledField
                label="Opportunity scholarship award"
                value={formatCurrency(
                  app.opportunity_scholarship_award_amount
                )}
              />
            </div>
          </SectionGroup>

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

function ScholarshipBlock({ scholarship }: { scholarship: XanoScholarship }) {
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
 * Read-only field that still renders a real `<Input>` element so the
 * page reads as a form (with borders, labels, and structure) rather
 * than a text dump. Mirrors the `FieldRow` used by the per-section
 * editors when their `editing` state is `false`.
 */
function DisabledField({
  label,
  value,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string | number | null | undefined;
  type?: string;
  placeholder?: string;
}) {
  const display =
    value === null || value === undefined || value === "" ? "" : String(value);
  return (
    <Field>
      {label ? <FieldLabel className="text-xs">{label}</FieldLabel> : null}
      <Input
        type={type}
        value={display}
        disabled
        readOnly
        placeholder={placeholder}
        onChange={() => {}}
        className="border-input disabled:opacity-100 disabled:bg-white disabled:cursor-default"
      />
    </Field>
  );
}

function DisabledTextarea({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <Field>
      {label ? <FieldLabel className="text-xs">{label}</FieldLabel> : null}
      <textarea
        value={value ?? ""}
        disabled
        readOnly
        onChange={() => {}}
        className="flex min-h-[80px] w-full rounded-md border border-input bg-white px-3 py-2 text-sm placeholder:text-muted-foreground cursor-default opacity-100"
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
