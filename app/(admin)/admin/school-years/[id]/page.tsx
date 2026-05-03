"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Trash2,
  Pencil,
  X,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminFetcher } from "@/lib/admin-fetcher";
import type {
  XanoSchoolYear,
  XanoSchoolYearAwardBracket,
} from "@/lib/xano";

type YearStatus = "active" | "next" | "past" | "future" | "none";

function deriveStatus(y: XanoSchoolYear): YearStatus {
  if (y.isActive) return "active";
  if (y.isNextYear) return "next";
  if (y.isFuture) return "future";
  if (y.isPast) return "past";
  return "none";
}

function statusToFlags(status: YearStatus) {
  return {
    isActive: status === "active",
    isNextYear: status === "next",
    isPast: status === "past",
    isFuture: status === "future",
  };
}

function formatCurrency(value: number | null | undefined): string {
  const safe = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return safe.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * Per-school-year detail page. Replaces the previous side sheet so we
 * can host larger editing surfaces — most importantly the scholarship
 * award matrix, which doesn't fit comfortably in a sheet.
 *
 * Each section saves independently:
 *   - Year metadata (name + status + dates + deadlines + tuition/fees +
 *     default OS award + per-program SUFS amounts) — single PATCH on
 *     "Save" click
 *   - Award matrix — per-cell PATCH on blur, so cell edits don't depend
 *     on a top-level save
 */
export default function SchoolYearDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);

  const {
    data: year,
    isLoading,
    mutate: refreshYear,
  } = useSWR<XanoSchoolYear>(
    Number.isFinite(id) ? `/api/admin/school-years/${id}` : null,
    adminFetcher
  );

  if (!Number.isFinite(id)) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Invalid school year id.</p>
      </div>
    );
  }

  if (isLoading || !year) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/school-years">
          <Button variant="outline" size="icon" className="size-8 bg-white">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">
            {year.year_name || `Year #${year.id}`}
          </h1>
          <p className="text-xs text-muted-foreground">
            School year configuration
          </p>
        </div>
      </div>

      <YearMetadataCard
        year={year}
        onSaved={async () => {
          await refreshYear();
        }}
        onDeleted={() => router.push("/admin/school-years")}
      />

      <TuitionMatrixCard yearId={year.id} />
    </div>
  );
}

/* ─────────────────────── Year metadata card ─────────────────────── */

interface YearForm {
  year_name: string;
  start_date: string;
  end_date: string;
  application_deadline: string;
  opportunity_scholarship_deadline: string;
  status: YearStatus;
  tuition: number;
  annual_fees: number;
  transportation_fees: number;
  opportunity_scholarship_award: number;
  fes_eo_8: number;
  fes_eo_9: number;
  ftc_8: number;
  ftc_9: number;
  fes_ua_8_ese_1_3: number;
  fes_ua_9_ese_1_3: number;
  fes_ua_ese_4: number;
  fes_ua_ese_5: number;
}

function fromXano(y: XanoSchoolYear): YearForm {
  return {
    year_name: y.year_name ?? "",
    start_date: y.start_date ?? "",
    end_date: y.end_date ?? "",
    application_deadline: y.application_deadline ?? "",
    opportunity_scholarship_deadline:
      y.opportunity_scholarship_deadline ?? "",
    status: deriveStatus(y),
    tuition: y.tuition ?? 0,
    annual_fees: y.annual_fees ?? 0,
    transportation_fees: y.transportation_fees ?? 0,
    opportunity_scholarship_award: y.opportunity_scholarship_award ?? 0,
    fes_eo_8: y.fes_eo_8 ?? 0,
    fes_eo_9: y.fes_eo_9 ?? 0,
    ftc_8: y.ftc_8 ?? 0,
    ftc_9: y.ftc_9 ?? 0,
    fes_ua_8_ese_1_3: y.fes_ua_8_ese_1_3 ?? 0,
    fes_ua_9_ese_1_3: y.fes_ua_9_ese_1_3 ?? 0,
    fes_ua_ese_4: y.fes_ua_ese_4 ?? 0,
    fes_ua_ese_5: y.fes_ua_ese_5 ?? 0,
  };
}

function YearMetadataCard({
  year,
  onSaved,
  onDeleted,
}: {
  year: XanoSchoolYear;
  onSaved: () => void | Promise<void>;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<YearForm>(fromXano(year));

  // Re-seed when the upstream year changes (e.g. matrix card mutates
  // and SWR revalidates the year row).
  useEffect(() => setForm(fromXano(year)), [year]);

  function patch<K extends keyof YearForm>(key: K, value: YearForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (!form.year_name.trim()) {
      toast.error("Year name is required.");
      return;
    }
    setSaving(true);
    try {
      const flags = statusToFlags(form.status);
      const res = await fetch(`/api/admin/school-years/${year.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year_name: form.year_name.trim(),
          start_date: form.start_date || null,
          end_date: form.end_date || null,
          application_deadline: form.application_deadline || null,
          opportunity_scholarship_deadline:
            form.opportunity_scholarship_deadline || null,
          tuition: form.tuition,
          annual_fees: form.annual_fees,
          transportation_fees: form.transportation_fees,
          opportunity_scholarship_award: form.opportunity_scholarship_award,
          fes_eo_8: form.fes_eo_8,
          fes_eo_9: form.fes_eo_9,
          ftc_8: form.ftc_8,
          ftc_9: form.ftc_9,
          fes_ua_8_ese_1_3: form.fes_ua_8_ese_1_3,
          fes_ua_9_ese_1_3: form.fes_ua_9_ese_1_3,
          fes_ua_ese_4: form.fes_ua_ese_4,
          fes_ua_ese_5: form.fes_ua_ese_5,
          ...flags,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      toast.success("School year updated.");
      setEditing(false);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Year Configuration</CardTitle>
          {editing ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setForm(fromXano(year));
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
                  <>
                    <Save className="size-4 mr-1" />
                    Save
                  </>
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
        <Section title="Identity">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <Field>
              <FieldLabel className="text-xs">Year name</FieldLabel>
              <Input
                placeholder="2026-2027"
                value={form.year_name}
                disabled={!editing}
                onChange={(e) => patch("year_name", e.target.value)}
                className="border-input disabled:opacity-100 disabled:bg-white disabled:cursor-default"
              />
            </Field>
            <Field>
              <FieldLabel className="text-xs">Status</FieldLabel>
              {editing ? (
                <Select
                  value={form.status}
                  onValueChange={(v) => patch("status", v as YearStatus)}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="next">Upcoming (next year)</SelectItem>
                    <SelectItem value="active">Active (current)</SelectItem>
                    <SelectItem value="future">Future</SelectItem>
                    <SelectItem value="past">Past</SelectItem>
                    <SelectItem value="none">None</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={form.status === "none" ? "—" : form.status}
                  disabled
                  readOnly
                  className="border-input disabled:opacity-100 disabled:bg-white disabled:cursor-default capitalize"
                  onChange={() => {}}
                />
              )}
              <FieldDescription>
                Drives where the year shows in parent + admin year pickers.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel className="text-xs">Start date</FieldLabel>
              <Input
                type="date"
                value={form.start_date}
                disabled={!editing}
                onChange={(e) => patch("start_date", e.target.value)}
                className="border-input disabled:opacity-100 disabled:bg-white disabled:cursor-default"
              />
            </Field>
            <Field>
              <FieldLabel className="text-xs">End date</FieldLabel>
              <Input
                type="date"
                value={form.end_date}
                disabled={!editing}
                onChange={(e) => patch("end_date", e.target.value)}
                className="border-input disabled:opacity-100 disabled:bg-white disabled:cursor-default"
              />
            </Field>
            <Field>
              <FieldLabel className="text-xs">Application deadline</FieldLabel>
              <Input
                type="date"
                value={form.application_deadline}
                disabled={!editing}
                onChange={(e) =>
                  patch("application_deadline", e.target.value)
                }
                className="border-input disabled:opacity-100 disabled:bg-white disabled:cursor-default"
              />
            </Field>
            <Field>
              <FieldLabel className="text-xs">
                Opportunity Scholarship deadline
              </FieldLabel>
              <Input
                type="date"
                value={form.opportunity_scholarship_deadline}
                disabled={!editing}
                onChange={(e) =>
                  patch("opportunity_scholarship_deadline", e.target.value)
                }
                className="border-input disabled:opacity-100 disabled:bg-white disabled:cursor-default"
              />
            </Field>
          </div>
        </Section>

        <Section title="Tuition & Fees">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <CurrencyField
              label="Annual tuition"
              value={form.tuition}
              editing={editing}
              onChange={(v) => patch("tuition", v)}
            />
            <CurrencyField
              label="Annual fees"
              value={form.annual_fees}
              editing={editing}
              onChange={(v) => patch("annual_fees", v)}
            />
            <CurrencyField
              label="Transportation fees"
              value={form.transportation_fees}
              editing={editing}
              onChange={(v) => patch("transportation_fees", v)}
            />
          </div>
        </Section>

        <Section
          title="Step Up For Students Award Amounts"
          description="Per-program annual award amount. Leave at $0 for any program not yet set."
        >
          <div className="grid gap-4 grid-cols-2">
            <CurrencyField
              label="FES-EO · Grade 8"
              value={form.fes_eo_8}
              editing={editing}
              onChange={(v) => patch("fes_eo_8", v)}
            />
            <CurrencyField
              label="FES-EO · Grade 9"
              value={form.fes_eo_9}
              editing={editing}
              onChange={(v) => patch("fes_eo_9", v)}
            />
            <CurrencyField
              label="FTC · Grade 8"
              value={form.ftc_8}
              editing={editing}
              onChange={(v) => patch("ftc_8", v)}
            />
            <CurrencyField
              label="FTC · Grade 9"
              value={form.ftc_9}
              editing={editing}
              onChange={(v) => patch("ftc_9", v)}
            />
            <CurrencyField
              label="FES-UA ESE 1-3 · Grade 8"
              value={form.fes_ua_8_ese_1_3}
              editing={editing}
              onChange={(v) => patch("fes_ua_8_ese_1_3", v)}
            />
            <CurrencyField
              label="FES-UA ESE 1-3 · Grade 9"
              value={form.fes_ua_9_ese_1_3}
              editing={editing}
              onChange={(v) => patch("fes_ua_9_ese_1_3", v)}
            />
            <CurrencyField
              label="FES-UA ESE 4"
              value={form.fes_ua_ese_4}
              editing={editing}
              onChange={(v) => patch("fes_ua_ese_4", v)}
            />
            <CurrencyField
              label="FES-UA ESE 5"
              value={form.fes_ua_ese_5}
              editing={editing}
              onChange={(v) => patch("fes_ua_ese_5", v)}
            />
          </div>
        </Section>

        <Section title="Opportunity Scholarship">
          <CurrencyField
            label="Default award amount (legacy / fallback)"
            value={form.opportunity_scholarship_award}
            editing={editing}
            onChange={(v) => patch("opportunity_scholarship_award", v)}
          />
        </Section>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────── Scholarship matrix card ─────────────────────── */

interface BracketShape {
  /** "min-max" or "min-null" key — uniquely identifies a column */
  key: string;
  income_min: number;
  income_max: number | null;
}

function bracketKey(min: number, max: number | null): string {
  return `${min}-${max ?? "null"}`;
}

function formatBracketLabel(b: BracketShape): string {
  if (b.income_max === null) {
    return `${formatCurrency(b.income_min)} +`;
  }
  return `${formatCurrency(b.income_min)} – ${formatCurrency(b.income_max)}`;
}

function TuitionMatrixCard({ yearId }: { yearId: number }) {
  const {
    data: cells,
    isLoading,
    error,
    mutate,
  } = useSWR<XanoSchoolYearAwardBracket[]>(
    `/api/admin/school-year-brackets?yearId=${yearId}`,
    adminFetcher
  );

  const safeCells = useMemo(
    () => (Array.isArray(cells) ? cells : []),
    [cells]
  );

  // Distinct household sizes (rows) and brackets (cols), sorted.
  const sizes = useMemo(() => {
    const set = new Set<number>();
    for (const c of safeCells) set.add(c.household_size);
    return Array.from(set).sort((a, b) => a - b);
  }, [safeCells]);

  const brackets = useMemo<BracketShape[]>(() => {
    const map = new Map<string, BracketShape>();
    for (const c of safeCells) {
      const key = bracketKey(c.income_min, c.income_max);
      if (!map.has(key)) {
        map.set(key, {
          key,
          income_min: c.income_min,
          income_max: c.income_max,
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => a.income_min - b.income_min
    );
  }, [safeCells]);

  // Lookup: (size, bracketKey) → cell row
  const cellLookup = useMemo(() => {
    const map = new Map<string, XanoSchoolYearAwardBracket>();
    for (const c of safeCells) {
      const key = `${c.household_size}::${bracketKey(c.income_min, c.income_max)}`;
      map.set(key, c);
    }
    return map;
  }, [safeCells]);

  /* ────── Adders ────── */

  async function addHouseholdSize() {
    const next = sizes.length === 0 ? 1 : Math.max(...sizes) + 1;
    if (brackets.length === 0) {
      // No columns yet — bootstrap with a default $0–$25k bracket so
      // the new row has somewhere to land. Admin can rename it after.
      try {
        await fetch("/api/admin/school-year-brackets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            registration_school_years_id: yearId,
            household_size: next,
            income_min: 0,
            income_max: 25000,
            tuition_payment: 0,
          }),
        });
        await mutate();
        toast.success("Added first cell. Add brackets to grow the matrix.");
        return;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't add row.");
        return;
      }
    }
    try {
      await Promise.all(
        brackets.map((b) =>
          fetch("/api/admin/school-year-brackets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              registration_school_years_id: yearId,
              household_size: next,
              income_min: b.income_min,
              income_max: b.income_max,
              tuition_payment: 0,
            }),
          })
        )
      );
      await mutate();
      toast.success(`Added household size ${next}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add row.");
    }
  }

  async function addIncomeBracket() {
    // Default new bracket bounds: pick up where the highest bracket
    // ends. If no brackets exist yet, start at $0–$25k.
    let min = 0;
    let max: number | null = 25000;
    if (brackets.length > 0) {
      const last = brackets[brackets.length - 1];
      if (last.income_max === null) {
        // Top is already unbounded — split it.
        min = last.income_min + 1;
        max = null;
      } else {
        min = last.income_max;
        max = last.income_max + 25000;
      }
    }
    const sizesToSeed = sizes.length === 0 ? [1] : sizes;
    try {
      await Promise.all(
        sizesToSeed.map((s) =>
          fetch("/api/admin/school-year-brackets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              registration_school_years_id: yearId,
              household_size: s,
              income_min: min,
              income_max: max,
              tuition_payment: 0,
            }),
          })
        )
      );
      await mutate();
      toast.success(`Added bracket ${formatCurrency(min)}+.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add column.");
    }
  }

  async function deleteHouseholdSize(size: number) {
    const targets = safeCells.filter((c) => c.household_size === size);
    try {
      await Promise.all(
        targets.map((c) =>
          fetch(`/api/admin/school-year-brackets/${c.id}`, {
            method: "DELETE",
          })
        )
      );
      await mutate();
      toast.success(`Removed household size ${size}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete.");
    }
  }

  async function deleteBracket(b: BracketShape) {
    const targets = safeCells.filter(
      (c) =>
        c.income_min === b.income_min && (c.income_max ?? null) === b.income_max
    );
    try {
      await Promise.all(
        targets.map((c) =>
          fetch(`/api/admin/school-year-brackets/${c.id}`, {
            method: "DELETE",
          })
        )
      );
      await mutate();
      toast.success(`Removed bracket ${formatBracketLabel(b)}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete.");
    }
  }

  async function patchCell(
    id: number,
    fields: Partial<XanoSchoolYearAwardBracket>
  ) {
    try {
      const res = await fetch(`/api/admin/school-year-brackets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed.");
    }
  }

  async function updateBracketBounds(
    oldB: BracketShape,
    nextMin: number,
    nextMax: number | null
  ) {
    const targets = safeCells.filter(
      (c) =>
        c.income_min === oldB.income_min &&
        (c.income_max ?? null) === oldB.income_max
    );
    try {
      await Promise.all(
        targets.map((c) =>
          fetch(`/api/admin/school-year-brackets/${c.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              income_min: nextMin,
              income_max: nextMax,
            }),
          })
        )
      );
      await mutate();
      toast.success("Bracket updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    }
  }

  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              Family Tuition Payment Matrix
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              The dollar amount each family pays for the year, given
              their household size (rows) and annual income bracket
              (columns). Cell edits save automatically on blur.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={addHouseholdSize}
              className="bg-white"
            >
              <Plus className="size-4 mr-1" />
              Add row
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={addIncomeBracket}
              className="bg-white"
            >
              <Plus className="size-4 mr-1" />
              Add bracket
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 bg-white">
        {error ? (
          <div className="p-4 text-sm text-red-700 bg-red-50 border-b border-red-200">
            Failed to load matrix:{" "}
            {error instanceof Error ? error.message : "unknown error"}.
            Confirm the <code>registration_school_year_award_brackets</code>{" "}
            Xano table exists and has the documented endpoints.
          </div>
        ) : null}
        {isLoading && safeCells.length === 0 ? (
          <div className="p-4">
            <Skeleton className="h-48 w-full" />
          </div>
        ) : sizes.length === 0 || brackets.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              No matrix configured yet for this year.
            </p>
            <p className="text-xs text-muted-foreground/80 mb-4">
              Click <strong>Add bracket</strong> to set up your first
              income column, then <strong>Add row</strong> to add household
              sizes.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground sticky left-0 bg-muted/40 z-10">
                    Household
                  </TableHead>
                  {brackets.map((b) => (
                    <TableHead
                      key={b.key}
                      className="text-xs font-semibold text-muted-foreground min-w-[180px]"
                    >
                      <BracketHeader
                        bracket={b}
                        onSave={(nextMin, nextMax) =>
                          updateBracketBounds(b, nextMin, nextMax)
                        }
                        onDelete={() => deleteBracket(b)}
                      />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sizes.map((size) => (
                  <TableRow key={size}>
                    <TableCell className="font-medium sticky left-0 bg-white z-10 border-r">
                      <div className="flex items-center justify-between gap-2 min-w-[100px]">
                        <span>
                          {size} {size === 1 ? "person" : "people"}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 text-muted-foreground hover:text-red-600"
                          onClick={() => deleteHouseholdSize(size)}
                          aria-label={`Remove household size ${size}`}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                    {brackets.map((b) => {
                      const cell = cellLookup.get(`${size}::${b.key}`);
                      return (
                        <TableCell key={b.key} className="p-1">
                          <MatrixCell
                            cell={cell}
                            onSave={(amount) => {
                              if (cell) {
                                patchCell(cell.id, {
                                  tuition_payment: amount,
                                });
                              } else {
                                // Cell doesn't exist (gap in matrix) —
                                // create it on first edit.
                                fetch("/api/admin/school-year-brackets", {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    registration_school_years_id: yearId,
                                    household_size: size,
                                    income_min: b.income_min,
                                    income_max: b.income_max,
                                    tuition_payment: amount,
                                  }),
                                }).then(() => mutate());
                              }
                            }}
                          />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BracketHeader({
  bracket,
  onSave,
  onDelete,
}: {
  bracket: BracketShape;
  onSave: (min: number, max: number | null) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [min, setMin] = useState(String(bracket.income_min));
  const [max, setMax] = useState(
    bracket.income_max === null ? "" : String(bracket.income_max)
  );

  useEffect(() => {
    setMin(String(bracket.income_min));
    setMax(bracket.income_max === null ? "" : String(bracket.income_max));
  }, [bracket.income_min, bracket.income_max]);

  if (editing) {
    return (
      <div className="flex items-center gap-1 normal-case tracking-normal">
        <Input
          type="number"
          value={min}
          onChange={(e) => setMin(e.target.value)}
          className="h-7 text-xs w-24"
          placeholder="Min"
        />
        <span className="text-muted-foreground">–</span>
        <Input
          type="number"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          className="h-7 text-xs w-24"
          placeholder="Max (blank = +)"
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => {
            const nextMin = Number(min);
            const nextMax = max === "" ? null : Number(max);
            if (!Number.isFinite(nextMin)) return;
            if (nextMax !== null && !Number.isFinite(nextMax)) return;
            onSave(nextMin, nextMax);
            setEditing(false);
          }}
          aria-label="Save bracket"
        >
          <Save className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => {
            setEditing(false);
            setMin(String(bracket.income_min));
            setMax(
              bracket.income_max === null ? "" : String(bracket.income_max)
            );
          }}
          aria-label="Cancel"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-1 normal-case tracking-normal">
      <span className="font-medium text-foreground">
        {formatBracketLabel(bracket)}
      </span>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => setEditing(true)}
          aria-label="Edit bracket bounds"
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-red-600"
          onClick={onDelete}
          aria-label="Remove bracket"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

/**
 * One editable matrix cell. Local input state until blur, then
 * compares to the saved value and PATCHes only if it changed. Empty
 * input is treated as 0 so admins can clear a cell quickly.
 *
 * The persisted field is `tuition_payment` — the dollar amount the
 * family pays for the year given that household size + income bracket.
 */
function MatrixCell({
  cell,
  onSave,
}: {
  cell: XanoSchoolYearAwardBracket | undefined;
  onSave: (amount: number) => void;
}) {
  const initial = cell?.tuition_payment ?? 0;
  const [value, setValue] = useState(String(initial));

  useEffect(() => {
    setValue(String(cell?.tuition_payment ?? 0));
  }, [cell?.tuition_payment]);

  function commit() {
    const n = value === "" ? 0 : Number(value);
    if (!Number.isFinite(n)) {
      setValue(String(initial));
      return;
    }
    if (n === initial) return; // no-op
    onSave(n);
  }

  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
        $
      </span>
      <Input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="h-9 pl-5 text-sm tabular-nums bg-white"
      />
    </div>
  );
}

/* ─────────────────────── Shared bits ─────────────────────── */

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {description ? (
          <p className="text-xs text-muted-foreground/80 mt-0.5">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function CurrencyField({
  label,
  value,
  editing,
  onChange,
}: {
  label: string;
  value: number;
  editing: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <Field>
      <FieldLabel className="text-xs">{label}</FieldLabel>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          $
        </span>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          className="pl-7 border-input disabled:opacity-100 disabled:bg-white disabled:cursor-default"
          value={Number.isFinite(value) ? String(value) : "0"}
          disabled={!editing}
          onChange={(e) => {
            const next = Number(e.target.value);
            onChange(Number.isFinite(next) ? next : 0);
          }}
        />
      </div>
    </Field>
  );
}
