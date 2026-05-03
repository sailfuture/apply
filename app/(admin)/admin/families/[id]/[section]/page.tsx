"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  ExternalLink,
  Pencil,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetcher } from "@/lib/admin-fetcher";
import { deriveApplicationStatus } from "@/lib/application-status";
import { StatusBadge } from "@/components/admin/status-badge";
import type {
  XanoAdminFamilyDetail,
  XanoApplication,
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
}
interface FamilyResponse {
  id: number;
  family_name: string;
  registration_parents_id: Parent[];
  registration_students_id: Student[];
}

/**
 * Slug → metadata table. Adding a new section means adding a row here
 * and (if it requires bespoke rendering) a branch in the body switch
 * below. Slugs match the URLs the Applications + Re-Applications
 * tables route to from their per-section column buttons.
 *
 * Apply-flow slugs are bare (`family`, `students`, …); reapply-flow
 * slugs are prefixed with `reapply-` so a single dynamic route can
 * cleanly distinguish them.
 */
const SECTION_META: Record<
  string,
  {
    label: string;
    flow: "apply" | "reapply";
    progressKey:
      | "family_completed"
      | "students_completed"
      | "financial_aid_completed"
      | "testing_completed"
      | "isFamilyDetails"
      | "isStudentDetails"
      | "isScholarship"
      | "isTransportation";
    /** Path under `/apply/year/[yearId]` (or `/reapply/year/[yearId]`)
     *  the parent uses for this section. The "Open in apply view"
     *  button deep-links to it so admins can review the live form. */
    parentPath: string;
  }
> = {
  family: {
    label: "Family",
    flow: "apply",
    progressKey: "family_completed",
    parentPath: "family",
  },
  students: {
    label: "Students",
    flow: "apply",
    progressKey: "students_completed",
    parentPath: "students",
  },
  "financial-aid": {
    label: "Financial Aid",
    flow: "apply",
    progressKey: "financial_aid_completed",
    parentPath: "scholarship",
  },
  testing: {
    label: "Initial Testing",
    flow: "apply",
    progressKey: "testing_completed",
    parentPath: "nwea",
  },
  "reapply-family": {
    label: "Family (Re-Application)",
    flow: "reapply",
    progressKey: "isFamilyDetails",
    parentPath: "family",
  },
  "reapply-students": {
    label: "Students (Re-Application)",
    flow: "reapply",
    progressKey: "isStudentDetails",
    parentPath: "students",
  },
  "reapply-financial-aid": {
    label: "Financial Aid (Re-Application)",
    flow: "reapply",
    progressKey: "isScholarship",
    parentPath: "scholarship",
  },
  "reapply-transportation": {
    label: "Transportation (Re-Application)",
    flow: "reapply",
    progressKey: "isTransportation",
    parentPath: "transportation",
  },
};

export default function AdminFamilySectionPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const familyId = params.id as string;
  const sectionSlug = params.section as string;
  const yearId = searchParams.get("yearId");

  const meta = SECTION_META[sectionSlug];

  // Family + parents + students — used across all section views for the
  // header label, so always fetch.
  const { data: family } = useSWR<FamilyResponse>(
    familyId ? `/api/admin/families/${familyId}` : null,
    fetcher
  );

  // Per-year applications + scholarship — only fetched when the section
  // needs it. Wrapped in a hook-friendly conditional via key=null.
  const needsAppDetail =
    !!yearId &&
    !!meta &&
    (meta.progressKey === "family_completed" ||
      meta.progressKey === "students_completed" ||
      meta.progressKey === "financial_aid_completed" ||
      meta.progressKey === "testing_completed" ||
      meta.progressKey === "isFamilyDetails" ||
      meta.progressKey === "isStudentDetails" ||
      meta.progressKey === "isScholarship" ||
      meta.progressKey === "isTransportation");
  const { data: detail } = useSWR<XanoAdminFamilyDetail>(
    needsAppDetail
      ? `/api/admin/family-applications?familyId=${familyId}&yearId=${yearId}`
      : null,
    adminFetcher
  );

  const sectionComplete = useMemo(() => {
    if (!meta) return false;
    // Pull completion from whichever progress source matches the flow.
    // Both progress endpoints return the bool of the same name we keyed
    // off in SECTION_META.
    // For now we surface the bool via SWR on the existing per-year
    // family-progress endpoints (consumed by the parent flow) since the
    // admin doesn't have its own per-family progress fetch yet — easy
    // upgrade path.
    return false;
  }, [meta]);

  if (!meta) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          Unknown section &ldquo;{sectionSlug}&rdquo;.
        </p>
        <Button asChild variant="outline">
          <Link href={`/admin/families/${familyId}${yearId ? `?yearId=${yearId}` : ""}`}>
            <ArrowLeft className="size-4 mr-1.5" />
            Back to family
          </Link>
        </Button>
      </div>
    );
  }

  const backHref = `/admin/families/${familyId}${yearId ? `?yearId=${yearId}` : ""}`;
  const parentEditHref = yearId
    ? `/${meta.flow}/year/${yearId}/${meta.parentPath}`
    : "#";

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link href={backHref}>
            <Button variant="outline" size="icon" className="size-8 bg-white">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {family?.family_name || `Family #${familyId}`}
            </p>
            <h1 className="text-2xl font-semibold mt-1">
              {meta.label}
            </h1>
            <div className="flex items-center gap-2 mt-2">
              {sectionComplete ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="size-4 text-green-600" /> Complete
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Circle className="size-4" /> Not yet complete
                </span>
              )}
            </div>
          </div>
        </div>

        {/* "Open in apply view" — admin opens the live form in a new
            tab so they can see exactly what the parent sees. Edit-on-
            behalf via admin impersonation is the next step; for now
            this gives admins a way into the canonical form. */}
        <Button asChild variant="outline" className="bg-white">
          <a href={parentEditHref} target="_blank" rel="noopener noreferrer">
            <Pencil className="size-4 mr-1.5" />
            Open in apply view
            <ExternalLink className="size-3.5 ml-1.5" />
          </a>
        </Button>
      </div>

      {/* Section body — switches on slug for now. Each rendering uses
          read-only cards that mirror what the parent sees on their
          actual form. As we wire admin-side editing, individual
          branches grow inline form controls. */}
      {sectionSlug === "family" || sectionSlug === "reapply-family" ? (
        <FamilyBody family={family} />
      ) : sectionSlug === "students" || sectionSlug === "reapply-students" ? (
        <StudentsBody family={family} detail={detail} />
      ) : sectionSlug === "financial-aid" ||
        sectionSlug === "reapply-financial-aid" ? (
        <FinancialAidBody scholarship={detail?.scholarship?.[0] ?? null} />
      ) : sectionSlug === "testing" ? (
        <TestingBody family={family} detail={detail} />
      ) : sectionSlug === "reapply-transportation" ? (
        <TransportationBody family={family} detail={detail} />
      ) : null}
    </div>
  );
}

function FamilyBody({ family }: { family: FamilyResponse | undefined }) {
  if (!family) return <SectionSkeleton />;
  const parents = family.registration_parents_id ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Parents / Guardians</CardTitle>
      </CardHeader>
      <CardContent>
        {parents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No parents on file.
          </p>
        ) : (
          <div className="space-y-3">
            {parents.map((parent) => (
              <div key={parent.id} className="rounded-md border p-3">
                <p className="text-sm font-medium">
                  {parent.first_name} {parent.last_name}
                  {parent.relationship ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({parent.relationship})
                    </span>
                  ) : null}
                </p>
                <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
                  {parent.email ? <p>{parent.email}</p> : null}
                  {parent.phone ? <p>{parent.phone}</p> : null}
                  {parent.address_line_1 ? (
                    <p>
                      {parent.address_line_1}
                      {parent.address_line_2
                        ? `, ${parent.address_line_2}`
                        : ""}
                      {parent.city ? `, ${parent.city}` : ""}
                      {parent.state ? ` ${parent.state}` : ""}
                      {parent.zipcode ? ` ${parent.zipcode}` : ""}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StudentsBody({
  family,
  detail,
}: {
  family: FamilyResponse | undefined;
  detail: XanoAdminFamilyDetail | undefined;
}) {
  if (!family) return <SectionSkeleton />;
  const students = family.registration_students_id ?? [];
  const apps: XanoApplication[] = detail?.application ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Students</CardTitle>
      </CardHeader>
      <CardContent>
        {students.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No students on file.
          </p>
        ) : (
          <div className="space-y-4">
            {students.map((student) => {
              const app = apps.find(
                (a) => Number(a.registration_students_id) === student.id
              );
              const status = app
                ? deriveApplicationStatus(app)
                : null;
              return (
                <div key={student.id} className="rounded-md border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm">
                        {student.first_name} {student.last_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {student.date_of_birth
                          ? new Date(
                              `${student.date_of_birth}T00:00:00`
                            ).toLocaleDateString()
                          : ""}
                        {student.gender ? ` · ${student.gender}` : ""}
                        {student.ethnicity ? ` · ${student.ethnicity}` : ""}
                      </p>
                    </div>
                    {status ? <StatusBadge status={status} /> : null}
                  </div>

                  {app ? (
                    <DetailGrid
                      rows={[
                        ["Current grade", app.current_grade || "—"],
                        ["Last grade", app.last_grade_completed || "—"],
                        ["Previous school", app.current_previous_school || "—"],
                        [
                          "Bus",
                          app.is_bus_transportation
                            ? `Yes${app.bus_stop ? ` · ${app.bus_stop}` : ""}`
                            : "No",
                        ],
                      ]}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      No application for this year.
                    </p>
                  )}

                  {app?.describe_student_strengths ? (
                    <SectionRow
                      label="Strengths"
                      body={app.describe_student_strengths}
                    />
                  ) : null}
                  {app?.describe_student_opportunities_for_growth ? (
                    <SectionRow
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
  );
}

function FinancialAidBody({
  scholarship,
}: {
  scholarship: XanoScholarship | null;
}) {
  if (!scholarship) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Financial Aid</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No scholarship row for this family / year. The parent
            hasn&rsquo;t opened the Financial Aid section yet.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
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
      <CardContent>
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
              "No contributing members",
              scholarship.no_contributing_member ? "Yes" : "No",
            ],
            [
              "Family contribution / mo",
              `$${(scholarship.family_contribution_per_month ?? 0).toLocaleString()}`,
            ],
          ]}
        />
        {scholarship.scholarship_advocacy_letter ? (
          <SectionRow
            label="Advocacy letter"
            body={scholarship.scholarship_advocacy_letter}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function TestingBody({
  family,
  detail,
}: {
  family: FamilyResponse | undefined;
  detail: XanoAdminFamilyDetail | undefined;
}) {
  if (!family) return <SectionSkeleton />;
  const apps: XanoApplication[] = detail?.application ?? [];
  const students = family.registration_students_id ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">NWEA Testing</CardTitle>
      </CardHeader>
      <CardContent>
        {students.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No students on file.
          </p>
        ) : (
          <div className="space-y-2">
            {students.map((student) => {
              const app = apps.find(
                (a) => Number(a.registration_students_id) === student.id
              );
              const state = app?.nwea_testing_complete
                ? "Complete"
                : app?.nwea_testing_scheduled
                  ? "Scheduled"
                  : "Not scheduled";
              return (
                <div
                  key={student.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <p className="text-sm font-medium">
                    {student.first_name} {student.last_name}
                  </p>
                  <span className="text-xs text-muted-foreground">{state}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TransportationBody({
  family,
  detail,
}: {
  family: FamilyResponse | undefined;
  detail: XanoAdminFamilyDetail | undefined;
}) {
  if (!family) return <SectionSkeleton />;
  const apps: XanoApplication[] = detail?.application ?? [];
  const students = family.registration_students_id ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Transportation</CardTitle>
      </CardHeader>
      <CardContent>
        {students.length === 0 ? (
          <p className="text-sm text-muted-foreground">No students on file.</p>
        ) : (
          <div className="space-y-2">
            {students.map((student) => {
              const app = apps.find(
                (a) => Number(a.registration_students_id) === student.id
              );
              const summary = app?.is_bus_transportation
                ? `Bus${app.bus_stop ? ` · ${app.bus_stop}` : " · stop unset"}`
                : "Self-transport";
              return (
                <div
                  key={student.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <p className="text-sm font-medium">
                    {student.first_name} {student.last_name}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {summary}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SectionSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-32 w-full rounded-md" />
      </CardContent>
    </Card>
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
          <span className="text-sm font-medium whitespace-pre-wrap">
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function SectionRow({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-3 mb-1">
        {label}
      </p>
      <p className="text-sm whitespace-pre-wrap">{body}</p>
    </div>
  );
}
