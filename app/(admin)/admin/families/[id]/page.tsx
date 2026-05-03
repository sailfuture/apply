"use client";

import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
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
  isAccepted: boolean;
  isSubmitted: boolean;
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
  // info, student names + DOB). The new admin_student_applications
  // endpoint returns family parents/students as IDs only.
  const { data: family, isLoading } = useSWR<FamilyResponse>(
    familyId ? `/api/admin/families/${familyId}` : null,
    fetcher
  );

  // Per-year applications + scholarship — single fetch via the new
  // admin_student_applications Xano query. Only fires when we have both
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

  if (isLoading || !family) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  const parents = family.registration_parents_id ?? [];
  const students = family.registration_students_id ?? [];
  const familyApps: XanoApplication[] = detail?.application ?? [];
  const scholarship: XanoScholarship | null = detail?.scholarship?.[0] ?? null;
  const yearMeta = detail?.school_year ?? null;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link href={backHref}>
          <Button variant="outline" size="icon" className="size-8">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">{family.family_name || `Family #${family.id}`}</h1>
          <div className="flex items-center gap-2 mt-1">
            {yearMeta ? (
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {yearMeta.year_name}
              </span>
            ) : null}
            {family.isSubmitted && <StatusBadge status="submitted" />}
            {family.isAccepted && <StatusBadge status="accepted" />}
          </div>
        </div>
      </div>

      {/* Parents / Guardians */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parents / Guardians</CardTitle>
        </CardHeader>
        <CardContent>
          {parents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No parents on file.</p>
          ) : (
            <div className="space-y-3">
              {parents.map((parent) => (
                <div key={parent.id} className="rounded-md border p-3">
                  <p className="text-sm font-medium">
                    {parent.first_name} {parent.last_name}
                    {parent.relationship && (
                      <span className="ml-2 text-xs text-muted-foreground">({parent.relationship})</span>
                    )}
                  </p>
                  <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
                    {parent.email && <p>{parent.email}</p>}
                    {parent.phone && <p>{parent.phone}</p>}
                    {parent.address_line_1 && (
                      <p>
                        {parent.address_line_1}
                        {parent.address_line_2 && `, ${parent.address_line_2}`}
                        {parent.city && `, ${parent.city}`}
                        {parent.state && ` ${parent.state}`}
                        {parent.zipcode && ` ${parent.zipcode}`}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Students */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Students</CardTitle>
        </CardHeader>
        <CardContent>
          {students.length === 0 ? (
            <p className="text-sm text-muted-foreground">No students on file.</p>
          ) : (
            <div className="space-y-3">
              {students.map((student) => (
                <div key={student.id} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">
                      {/* Per-student admin page was removed — student name
                          renders as plain text now. Section-level details
                          live on the per-section pages instead. */}
                      {student.first_name} {student.last_name}
                    </p>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {student.date_of_birth && <span>DOB: {new Date(student.date_of_birth).toLocaleDateString()} &middot; </span>}
                      {student.gender && <span>{student.gender} &middot; </span>}
                      {student.ethnicity && <span>{student.ethnicity}</span>}
                    </div>
                  </div>
                  {student.isAccepted && <StatusBadge status="accepted" />}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-student application breakdown — uses the new admin endpoint
          so admins see every field they care about (grade, school,
          strengths/growth, SUFS, NWEA, transport) without bouncing into
          a separate per-student page. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Applications
            {yearMeta ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                · {yearMeta.year_name}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!yearId ? (
            <p className="text-sm text-muted-foreground">
              Pick a school year to view applications.
            </p>
          ) : detailLoading && !detail ? (
            <div className="space-y-3">
              <Skeleton className="h-32 w-full rounded-md" />
              <Skeleton className="h-32 w-full rounded-md" />
            </div>
          ) : familyApps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No applications for the selected year.
            </p>
          ) : (
            <div className="space-y-4">
              {familyApps.map((app) => {
                const student = students.find(
                  (s) => s.id === Number(app.registration_students_id)
                );
                const status = deriveApplicationStatus(app);
                return (
                  <div
                    key={app.id}
                    className="rounded-md border p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">
                          {student
                            ? `${student.first_name} ${student.last_name}`
                            : `Student #${app.registration_students_id}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          App #{app.id} · Submitted{" "}
                          {new Date(app.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <StatusBadge status={status} />
                    </div>

                    <DetailGrid
                      rows={[
                        ["Current grade", app.current_grade || "—"],
                        ["Last grade completed", app.last_grade_completed || "—"],
                        ["Previous school", app.current_previous_school || "—"],
                        [
                          "Bus transportation",
                          app.is_bus_transportation
                            ? `Yes${app.bus_stop ? ` · ${app.bus_stop}` : ""}`
                            : "No",
                        ],
                        ["SUFS type", app.sufs_type || "—"],
                        ["SUFS status", app.sufs_status || "—"],
                        [
                          "SUFS award ID",
                          app.sufs_award_id ? String(app.sufs_award_id) : "—",
                        ],
                        [
                          "Opportunity scholarship award",
                          formatCurrency(app.opportunity_scholarship_award_amount),
                        ],
                        [
                          "NWEA testing",
                          app.nwea_testing_complete
                            ? "Complete"
                            : app.nwea_testing_scheduled
                              ? "Scheduled"
                              : "Not scheduled",
                        ],
                      ]}
                    />

                    {app.describe_student_strengths ? (
                      <Section
                        label="Strengths"
                        body={app.describe_student_strengths}
                      />
                    ) : null}
                    {app.describe_student_opportunities_for_growth ? (
                      <Section
                        label="Opportunities for growth"
                        body={app.describe_student_opportunities_for_growth}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Opportunity Scholarship — only renders when the family actually
          has a scholarship row for this year. Summary view; the Apply
          flow's full scholarship form is the canonical edit surface. */}
      {scholarship ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Opportunity Scholarship
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {scholarship.isOpportunityScholarship
                  ? "· Full application"
                  : scholarship.isSNAPBenefits
                    ? "· SNAP benefits path"
                    : scholarship.isNotParticipating
                      ? "· Opted out"
                      : ""}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <DetailGrid
              rows={[
                [
                  "Household",
                  `${scholarship.household_adults ?? 0} adult${
                    (scholarship.household_adults ?? 0) === 1 ? "" : "s"
                  } · ${scholarship.household_children ?? 0} child${
                    (scholarship.household_children ?? 0) === 1 ? "" : "ren"
                  }`,
                ],
                [
                  "Government benefits",
                  scholarship.government_benefits ? "Yes" : "No",
                ],
                [
                  "Family contribution / mo",
                  formatCurrency(scholarship.family_contribution_per_month),
                ],
                [
                  "Other monthly income",
                  formatCurrency(
                    (scholarship.business_income_monthly ?? 0) +
                      (scholarship.capital_gains_monthly ?? 0) +
                      (scholarship.child_support_monthly ?? 0) +
                      (scholarship.alimony_monthly ?? 0) +
                      (scholarship.trusts_monthly ?? 0) +
                      (scholarship.other_income_monthly ?? 0)
                  ),
                ],
                [
                  "Liquid assets",
                  formatCurrency(
                    (scholarship.assets_checking ?? 0) +
                      (scholarship.assets_savings ?? 0) +
                      (scholarship.assets_stocks_bonds_securities ?? 0)
                  ),
                ],
                [
                  "Retirement / trusts / business",
                  formatCurrency(
                    (scholarship.assets_retirement_savings ?? 0) +
                      (scholarship.assets_trusts_inheritance ?? 0) +
                      (scholarship.assets_business ?? 0)
                  ),
                ],
                [
                  "Total debts",
                  formatCurrency(
                    (scholarship.debts_credit_cards ?? 0) +
                      (scholarship.debts_student_loans ?? 0) +
                      (scholarship.debts_personal_loans ?? 0)
                  ),
                ],
                [
                  "No contributing members?",
                  scholarship.no_contributing_member ? "Yes" : "No",
                ],
              ]}
            />

            {scholarship.scholarship_advocacy_letter ? (
              <Section
                label="Advocacy letter"
                body={scholarship.scholarship_advocacy_letter}
              />
            ) : null}

            <SignaturePreview signature={scholarship.signature} />
          </CardContent>
        </Card>
      ) : null}

      {/* Comms log — pinned notes float to top, then chronological. */}
      <FamilyNotes familyId={family.id} />
    </div>
  );
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

function Section({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </p>
      <p className="text-sm whitespace-pre-wrap">{body}</p>
    </div>
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
