"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Loader2,
  Pencil,
  X,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetcher } from "@/lib/admin-fetcher";
import { deriveApplicationStatus } from "@/lib/application-status";
import { StatusBadge } from "@/components/admin/status-badge";
import { StateSelect } from "@/components/state-select";
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

const SECTION_META: Record<
  string,
  {
    label: string;
    flow: "apply" | "reapply";
  }
> = {
  family: { label: "Family Information", flow: "apply" },
  students: { label: "Student Details", flow: "apply" },
  "financial-aid": { label: "Financial Aid", flow: "apply" },
  testing: { label: "Initial Testing", flow: "apply" },
  "reapply-family": { label: "Family (Re-Application)", flow: "reapply" },
  "reapply-students": { label: "Students (Re-Application)", flow: "reapply" },
  "reapply-financial-aid": {
    label: "Financial Aid (Re-Application)",
    flow: "reapply",
  },
  "reapply-transportation": {
    label: "Transportation (Re-Application)",
    flow: "reapply",
  },
};

/**
 * Per-section admin page that mirrors the parent-side application form
 * for that section. Read-only by default — admins click "Edit" to flip
 * inputs to editable, fill in any values that need correcting, then
 * "Save" to PATCH the underlying Xano rows. Cancel discards local
 * changes.
 *
 * Each section body is its own component so we can grow them
 * independently — Family + Testing are inline editors today, Students
 * + Financial Aid render the application data and link out for the
 * full edit flow until those pages get their own admin form.
 */
export default function AdminFamilySectionPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const familyId = params.id as string;
  const sectionSlug = params.section as string;
  const yearId = searchParams.get("yearId");
  const meta = SECTION_META[sectionSlug];

  const { data: family, mutate: refreshFamily } = useSWR<FamilyResponse>(
    familyId ? `/api/admin/families/${familyId}` : null,
    fetcher
  );

  const { data: detail, mutate: refreshDetail } =
    useSWR<XanoAdminFamilyDetail>(
      yearId
        ? `/api/admin/family-applications?familyId=${familyId}&yearId=${yearId}`
        : null,
      adminFetcher
    );

  if (!meta) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          Unknown section &ldquo;{sectionSlug}&rdquo;.
        </p>
        <Button asChild variant="outline">
          <Link
            href={`/admin/families/${familyId}${yearId ? `?yearId=${yearId}` : ""}`}
          >
            <ArrowLeft className="size-4 mr-1.5" />
            Back to family
          </Link>
        </Button>
      </div>
    );
  }

  const backHref = `/admin/families/${familyId}${yearId ? `?yearId=${yearId}` : ""}`;

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
            <h1 className="text-2xl font-semibold mt-1">{meta.label}</h1>
          </div>
        </div>
      </div>

      {sectionSlug === "family" || sectionSlug === "reapply-family" ? (
        <FamilyEditor family={family} onSaved={() => refreshFamily()} />
      ) : sectionSlug === "students" || sectionSlug === "reapply-students" ? (
        <StudentsEditor
          family={family}
          detail={detail}
          onSaved={() => refreshDetail()}
        />
      ) : sectionSlug === "financial-aid" ||
        sectionSlug === "reapply-financial-aid" ? (
        <FinancialAidEditor scholarship={detail?.scholarship?.[0] ?? null} />
      ) : sectionSlug === "testing" ? (
        <TestingEditor
          family={family}
          detail={detail}
          onSaved={() => refreshDetail()}
        />
      ) : sectionSlug === "reapply-transportation" ? (
        <TransportationEditor
          family={family}
          detail={detail}
          onSaved={() => refreshDetail()}
        />
      ) : null}
    </div>
  );
}

/* ─────────────────────── Family ─────────────────────── */

function FamilyEditor({
  family,
  onSaved,
}: {
  family: FamilyResponse | undefined;
  onSaved: () => void;
}) {
  if (!family) return <SectionSkeleton />;
  // Xano's expanded relation sometimes mixes full parent objects with
  // bare ID numbers in the same array. Filter to only the objects that
  // actually carry an `id`, otherwise React's key check trips on the
  // numeric entries (and `parent.email` etc. are undefined too).
  const parents = (family.registration_parents_id ?? []).filter(
    (p): p is Parent =>
      !!p && typeof p === "object" && typeof (p as { id?: unknown }).id === "number"
  );
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Parents / Guardians
      </h2>
      {parents.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No parents on file.
          </CardContent>
        </Card>
      ) : (
        parents.map((parent) => (
          <ParentCard key={parent.id} parent={parent} onSaved={onSaved} />
        ))
      )}
    </div>
  );
}

function ParentCard({
  parent,
  onSaved,
}: {
  parent: Parent;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(parent);
  const [saving, setSaving] = useState(false);

  // Re-seed the local draft if the parent prop changes (e.g. after a
  // refresh) so we don't render stale values when the user opens edit
  // mode on a different parent.
  useEffect(() => setDraft(parent), [parent]);

  function patch<K extends keyof Parent>(key: K, value: Parent[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/parents/${parent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: draft.first_name,
          last_name: draft.last_name,
          email: draft.email,
          phone: draft.phone,
          relationship: draft.relationship,
          address_line_1: draft.address_line_1,
          address_line_2: draft.address_line_2,
          city: draft.city,
          state: draft.state,
          zipcode: draft.zipcode,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      toast.success("Parent updated.");
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden gap-0 py-0">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">
            {draft.first_name || draft.last_name
              ? `${draft.first_name} ${draft.last_name}`.trim()
              : `Parent #${parent.id}`}
            {draft.relationship ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({draft.relationship})
              </span>
            ) : null}
          </CardTitle>
          {editing ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setDraft(parent);
                }}
                disabled={saving}
              >
                <X className="size-4 mr-1" />
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="size-4 mr-1 animate-spin" />
                    Saving
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-4 mr-1" />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6 py-5 bg-white">
        <Section title="Name">
          <div className="grid gap-4 grid-cols-2">
            <FieldRow
              label="First name"
              value={draft.first_name}
              editing={editing}
              onChange={(v) => patch("first_name", v)}
            />
            <FieldRow
              label="Last name"
              value={draft.last_name}
              editing={editing}
              onChange={(v) => patch("last_name", v)}
            />
          </div>
        </Section>
        <Section title="Contact">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
            <FieldRow
              label="Email"
              value={draft.email}
              editing={editing}
              onChange={(v) => patch("email", v)}
              type="email"
            />
            <FieldRow
              label="Phone"
              value={draft.phone}
              editing={editing}
              onChange={(v) => patch("phone", v)}
            />
            <FieldRow
              label="Relationship"
              value={draft.relationship}
              editing={editing}
              onChange={(v) => patch("relationship", v)}
              placeholder="e.g. Mother"
            />
          </div>
        </Section>
        <Section title="Address">
          <div className="grid gap-4 grid-cols-1">
            <FieldRow
              label="Street address"
              value={draft.address_line_1}
              editing={editing}
              onChange={(v) => patch("address_line_1", v)}
            />
            <FieldRow
              label="Apt / suite"
              value={draft.address_line_2}
              editing={editing}
              onChange={(v) => patch("address_line_2", v)}
            />
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
              <FieldRow
                label="City"
                value={draft.city}
                editing={editing}
                onChange={(v) => patch("city", v)}
              />
              <Field>
                <FieldLabel className="text-xs">State</FieldLabel>
                {editing ? (
                  <StateSelect
                    value={draft.state}
                    onChange={(v) => patch("state", v)}
                  />
                ) : (
                  <p className="text-sm font-medium pt-2">{draft.state || "—"}</p>
                )}
              </Field>
              <FieldRow
                label="Zip"
                value={draft.zipcode}
                editing={editing}
                onChange={(v) => patch("zipcode", v)}
              />
            </div>
          </div>
        </Section>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────── Students ─────────────────────── */

function StudentsEditor({
  family,
  detail,
  onSaved,
}: {
  family: FamilyResponse | undefined;
  detail: XanoAdminFamilyDetail | undefined;
  onSaved: () => void;
}) {
  if (!family) return <SectionSkeleton />;
  const apps: XanoApplication[] = detail?.application ?? [];
  // Same filter as parents — Xano's expanded relation occasionally
  // returns bare student IDs alongside the full objects.
  const students = (family.registration_students_id ?? []).filter(
    (s): s is Student =>
      !!s && typeof s === "object" && typeof (s as { id?: unknown }).id === "number"
  );
  if (students.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          No students on file.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {students.map((student) => {
        const app = apps.find(
          (a) => Number(a.registration_students_id) === student.id
        );
        return (
          <StudentAppCard
            key={student.id}
            student={student}
            app={app}
            onSaved={onSaved}
          />
        );
      })}
    </div>
  );
}

function StudentAppCard({
  student,
  app,
  onSaved,
}: {
  student: Student;
  app: XanoApplication | undefined;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    current_grade: app?.current_grade ?? "",
    last_grade_completed: app?.last_grade_completed ?? "",
    current_previous_school: app?.current_previous_school ?? "",
    describe_student_strengths: app?.describe_student_strengths ?? "",
    describe_student_opportunities_for_growth:
      app?.describe_student_opportunities_for_growth ?? "",
    is_bus_transportation: app?.is_bus_transportation ?? false,
    bus_stop: app?.bus_stop ?? "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft({
      current_grade: app?.current_grade ?? "",
      last_grade_completed: app?.last_grade_completed ?? "",
      current_previous_school: app?.current_previous_school ?? "",
      describe_student_strengths: app?.describe_student_strengths ?? "",
      describe_student_opportunities_for_growth:
        app?.describe_student_opportunities_for_growth ?? "",
      is_bus_transportation: app?.is_bus_transportation ?? false,
      bus_stop: app?.bus_stop ?? "",
    });
  }, [app]);

  const status = useMemo(
    () => (app ? deriveApplicationStatus(app) : null),
    [app]
  );

  async function save() {
    if (!app) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/applications/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      toast.success(
        `${student.first_name} ${student.last_name} updated.`
      );
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden gap-0 py-0">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">
              {student.first_name} {student.last_name}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {student.date_of_birth
                ? `DOB ${new Date(`${student.date_of_birth}T00:00:00`).toLocaleDateString()}`
                : ""}
              {student.gender ? ` · ${student.gender}` : ""}
              {status ? null : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {status ? <StatusBadge status={status} /> : null}
            {!app ? (
              <span className="text-xs text-muted-foreground">No app</span>
            ) : editing ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setEditing(false);
                    setDraft({
                      current_grade: app.current_grade ?? "",
                      last_grade_completed: app.last_grade_completed ?? "",
                      current_previous_school: app.current_previous_school ?? "",
                      describe_student_strengths:
                        app.describe_student_strengths ?? "",
                      describe_student_opportunities_for_growth:
                        app.describe_student_opportunities_for_growth ?? "",
                      is_bus_transportation: app.is_bus_transportation ?? false,
                      bus_stop: app.bus_stop ?? "",
                    });
                  }}
                >
                  <X className="size-4 mr-1" />
                  Cancel
                </Button>
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="size-4 mr-1 animate-spin" />
                      Saving
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-4 mr-1" />
                Edit
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      {app ? (
        <CardContent className="space-y-6 py-5 bg-white">
          <Section title="Academic">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
              <FieldRow
                label="Last grade completed"
                value={draft.last_grade_completed}
                editing={editing}
                onChange={(v) => setDraft((d) => ({ ...d, last_grade_completed: v }))}
              />
              <FieldRow
                label="Current grade"
                value={draft.current_grade}
                editing={editing}
                onChange={(v) => setDraft((d) => ({ ...d, current_grade: v }))}
              />
              <FieldRow
                label="Previous school"
                value={draft.current_previous_school}
                editing={editing}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, current_previous_school: v }))
                }
              />
            </div>
          </Section>
          <Section title="About the student">
            <div className="space-y-4">
              <TextareaRow
                label="Strengths"
                value={draft.describe_student_strengths}
                editing={editing}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, describe_student_strengths: v }))
                }
              />
              <TextareaRow
                label="Opportunities for growth"
                value={draft.describe_student_opportunities_for_growth}
                editing={editing}
                onChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    describe_student_opportunities_for_growth: v,
                  }))
                }
              />
            </div>
          </Section>
          <Section title="Transportation">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id={`bus-${app.id}`}
                checked={draft.is_bus_transportation}
                disabled={!editing}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    is_bus_transportation: e.target.checked,
                  }))
                }
                className="size-5 cursor-pointer rounded accent-primary"
              />
              <label
                htmlFor={`bus-${app.id}`}
                className="text-sm cursor-pointer"
              >
                Will use bus transportation
              </label>
              {draft.is_bus_transportation ? (
                <FieldRow
                  label=""
                  value={draft.bus_stop}
                  editing={editing}
                  onChange={(v) => setDraft((d) => ({ ...d, bus_stop: v }))}
                  placeholder="Bus stop name"
                />
              ) : null}
            </div>
          </Section>
        </CardContent>
      ) : (
        <CardContent className="py-6 bg-white">
          <p className="text-sm text-muted-foreground italic">
            No application row for this year. Have the parent add this
            student via the Students page.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

/* ─────────────────────── Financial Aid ─────────────────────── */

function FinancialAidEditor({
  scholarship,
}: {
  scholarship: XanoScholarship | null;
}) {
  if (!scholarship) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          No scholarship row for this family / year. The parent
          hasn&rsquo;t opened the Financial Aid section yet.
        </CardContent>
      </Card>
    );
  }
  const path = scholarship.isOpportunityScholarship
    ? "Full Opportunity Scholarship application"
    : scholarship.isSNAPBenefits
      ? "SNAP benefits path"
      : scholarship.isNotParticipating
        ? "Opted out of financial aid"
        : "—";
  return (
    <Card className="overflow-hidden gap-0 py-0">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Opportunity Scholarship</CardTitle>
          <span className="text-xs text-muted-foreground">{path}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 py-5 bg-white">
        <Section title="Household">
          <div className="grid gap-4 grid-cols-2">
            <ReadonlyField
              label="Adults"
              value={String(scholarship.household_adults ?? 0)}
            />
            <ReadonlyField
              label="Children"
              value={String(scholarship.household_children ?? 0)}
            />
            <ReadonlyField
              label="No contributing members"
              value={scholarship.no_contributing_member ? "Yes" : "No"}
            />
            <ReadonlyField
              label="Government benefits"
              value={scholarship.government_benefits ? "Yes" : "No"}
            />
          </div>
        </Section>
        <Section title="Income (monthly)">
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3">
            {[
              ["Business", scholarship.business_income_monthly],
              ["Capital gains", scholarship.capital_gains_monthly],
              ["Child support", scholarship.child_support_monthly],
              ["Alimony", scholarship.alimony_monthly],
              ["Trusts", scholarship.trusts_monthly],
              ["Other", scholarship.other_income_monthly],
            ].map(([label, value]) => (
              <ReadonlyField
                key={String(label)}
                label={String(label)}
                value={`$${(Number(value) || 0).toLocaleString()}`}
              />
            ))}
          </div>
        </Section>
        <Section title="Assets">
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3">
            {[
              ["Checking", scholarship.assets_checking],
              ["Savings", scholarship.assets_savings],
              ["Retirement", scholarship.assets_retirement_savings],
              ["Securities", scholarship.assets_stocks_bonds_securities],
              ["Trusts / inheritance", scholarship.assets_trusts_inheritance],
              ["Business", scholarship.assets_business],
            ].map(([label, value]) => (
              <ReadonlyField
                key={String(label)}
                label={String(label)}
                value={`$${(Number(value) || 0).toLocaleString()}`}
              />
            ))}
          </div>
        </Section>
        <Section title="Debts">
          <div className="grid gap-4 grid-cols-3">
            <ReadonlyField
              label="Credit cards"
              value={`$${(scholarship.debts_credit_cards ?? 0).toLocaleString()}`}
            />
            <ReadonlyField
              label="Student loans"
              value={`$${(scholarship.debts_student_loans ?? 0).toLocaleString()}`}
            />
            <ReadonlyField
              label="Personal loans"
              value={`$${(scholarship.debts_personal_loans ?? 0).toLocaleString()}`}
            />
          </div>
        </Section>
        <Section title="Family contribution">
          <ReadonlyField
            label="Per month"
            value={`$${(scholarship.family_contribution_per_month ?? 0).toLocaleString()}`}
          />
        </Section>
        {scholarship.scholarship_advocacy_letter ? (
          <Section title="Advocacy letter">
            <p className="text-sm whitespace-pre-wrap rounded-md border bg-muted/30 p-3">
              {scholarship.scholarship_advocacy_letter}
            </p>
          </Section>
        ) : null}
        <p className="text-xs text-muted-foreground italic">
          Editing the full Opportunity Scholarship form (members, homes,
          vehicles, benefits, supporting documents) is on the parent&rsquo;s
          apply flow. The summary above is read-only here while we wire
          the admin-side editor.
        </p>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────── Testing ─────────────────────── */

function TestingEditor({
  family,
  detail,
  onSaved,
}: {
  family: FamilyResponse | undefined;
  detail: XanoAdminFamilyDetail | undefined;
  onSaved: () => void;
}) {
  if (!family) return <SectionSkeleton />;
  const apps: XanoApplication[] = detail?.application ?? [];
  // Filter out bare ID entries Xano sometimes mixes into the
  // expanded relation array — see FamilyEditor for context.
  const students = (family.registration_students_id ?? []).filter(
    (s): s is Student =>
      !!s && typeof s === "object" && typeof (s as { id?: unknown }).id === "number"
  );
  if (students.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          No students on file.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {students.map((student) => {
        const app = apps.find(
          (a) => Number(a.registration_students_id) === student.id
        );
        return (
          <TestingCard
            key={student.id}
            student={student}
            app={app}
            onSaved={onSaved}
          />
        );
      })}
    </div>
  );
}

function TestingCard({
  student,
  app,
  onSaved,
}: {
  student: Student;
  app: XanoApplication | undefined;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [scheduled, setScheduled] = useState(!!app?.nwea_testing_scheduled);
  const [complete, setComplete] = useState(!!app?.nwea_testing_complete);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setScheduled(!!app?.nwea_testing_scheduled);
    setComplete(!!app?.nwea_testing_complete);
  }, [app]);

  async function save() {
    if (!app) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/applications/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nwea_testing_scheduled: scheduled,
          nwea_testing_complete: complete,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      toast.success(
        `${student.first_name} ${student.last_name} testing updated.`
      );
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden gap-0 py-0">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">
            {student.first_name} {student.last_name}
          </CardTitle>
          {!app ? (
            <span className="text-xs text-muted-foreground">No app</span>
          ) : editing ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setScheduled(!!app.nwea_testing_scheduled);
                  setComplete(!!app.nwea_testing_complete);
                }}
              >
                <X className="size-4 mr-1" />
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="size-4 mr-1 animate-spin" />
                    Saving
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-4 mr-1" />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      {app ? (
        <CardContent className="space-y-3 py-5 bg-white">
          <CheckboxRow
            id={`sched-${app.id}`}
            label="NWEA testing scheduled"
            checked={scheduled}
            onChange={setScheduled}
            disabled={!editing}
          />
          <CheckboxRow
            id={`done-${app.id}`}
            label="NWEA testing complete"
            checked={complete}
            onChange={setComplete}
            disabled={!editing}
          />
          <p className="text-xs text-muted-foreground">
            Status:{" "}
            {complete ? (
              <span className="inline-flex items-center gap-1 text-green-700">
                <CheckCircle2 className="size-3.5" /> Complete
              </span>
            ) : scheduled ? (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <Circle className="size-3.5" /> Scheduled
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Circle className="size-3.5" /> Not scheduled
              </span>
            )}
          </p>
        </CardContent>
      ) : (
        <CardContent className="py-6 bg-white">
          <p className="text-sm text-muted-foreground italic">
            No application row for this year.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

/* ─────────────────────── Transportation (Reapply) ─────────────────────── */

function TransportationEditor({
  family,
  detail,
  onSaved,
}: {
  family: FamilyResponse | undefined;
  detail: XanoAdminFamilyDetail | undefined;
  onSaved: () => void;
}) {
  if (!family) return <SectionSkeleton />;
  const apps: XanoApplication[] = detail?.application ?? [];
  // Filter out bare ID entries Xano sometimes mixes into the
  // expanded relation array — see FamilyEditor for context.
  const students = (family.registration_students_id ?? []).filter(
    (s): s is Student =>
      !!s && typeof s === "object" && typeof (s as { id?: unknown }).id === "number"
  );
  if (students.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          No students on file.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {students.map((student) => {
        const app = apps.find(
          (a) => Number(a.registration_students_id) === student.id
        );
        return (
          <TransportCard
            key={student.id}
            student={student}
            app={app}
            onSaved={onSaved}
          />
        );
      })}
    </div>
  );
}

function TransportCard({
  student,
  app,
  onSaved,
}: {
  student: Student;
  app: XanoApplication | undefined;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [bus, setBus] = useState(!!app?.is_bus_transportation);
  const [stop, setStop] = useState(app?.bus_stop ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBus(!!app?.is_bus_transportation);
    setStop(app?.bus_stop ?? "");
  }, [app]);

  async function save() {
    if (!app) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/applications/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_bus_transportation: bus,
          bus_stop: bus ? stop : "",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      toast.success("Transportation updated.");
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden gap-0 py-0">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">
            {student.first_name} {student.last_name}
          </CardTitle>
          {!app ? (
            <span className="text-xs text-muted-foreground">No app</span>
          ) : editing ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setBus(!!app.is_bus_transportation);
                  setStop(app.bus_stop ?? "");
                }}
              >
                <X className="size-4 mr-1" />
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="size-4 mr-1 animate-spin" />
                    Saving
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-4 mr-1" />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      {app ? (
        <CardContent className="space-y-3 py-5 bg-white">
          <CheckboxRow
            id={`bus-${app.id}`}
            label="Will use bus transportation"
            checked={bus}
            onChange={setBus}
            disabled={!editing}
          />
          {bus ? (
            <FieldRow
              label="Bus stop"
              value={stop}
              editing={editing}
              onChange={setStop}
              placeholder="e.g. Lakewood Pickup"
            />
          ) : null}
        </CardContent>
      ) : (
        <CardContent className="py-6 bg-white">
          <p className="text-sm text-muted-foreground italic">
            No application row for this year.
          </p>
        </CardContent>
      )}
    </Card>
  );
}

/* ─────────────────────── Shared bits ─────────────────────── */

function Section({
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

/**
 * `FieldRow` and `TextareaRow` always render real `<Input>` /
 * `<textarea>` elements — the same chrome regardless of mode — and
 * just toggle `disabled` based on `editing`. Earlier versions
 * swapped between `<Input>` and a plain `<p>`, which made view-mode
 * read as "no fields here at all" instead of "this is a form, but
 * locked." Disabled inputs keep the border + label affordance so
 * the structure of the form stays visible at all times.
 */
function FieldRow({
  label,
  value,
  editing,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  editing: boolean;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <Field>
      {label ? <FieldLabel className="text-xs">{label}</FieldLabel> : null}
      <Input
        type={type}
        value={value}
        disabled={!editing}
        readOnly={!editing}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border-input disabled:opacity-100 disabled:bg-muted/30 disabled:cursor-default"
      />
    </Field>
  );
}

function TextareaRow({
  label,
  value,
  editing,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  editing: boolean;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Field>
      <FieldLabel className="text-xs">{label}</FieldLabel>
      <textarea
        value={value}
        disabled={!editing}
        readOnly={!editing}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
          !editing ? "bg-muted/30 cursor-default" : ""
        }`}
      />
    </Field>
  );
}

function CheckboxRow({
  id,
  label,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex items-center gap-3 rounded-md border px-3 py-2 ${
        disabled ? "opacity-70 cursor-default" : "cursor-pointer hover:bg-muted/30"
      }`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-5 cursor-pointer rounded accent-primary disabled:cursor-default"
      />
      <span className="text-sm font-medium">{label}</span>
    </label>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium whitespace-pre-wrap">{value}</span>
    </div>
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
