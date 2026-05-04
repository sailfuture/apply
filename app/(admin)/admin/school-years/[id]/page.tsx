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
import { cn } from "@/lib/utils";
import type { XanoSchoolYear } from "@/lib/xano";

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

      {/* Family Payment Matrix — single percentage cell drives both
          tuition and transportation. e.g. 8% means the family pays
          8% of base tuition + 8% of base transportation fees. The
          MatrixCell renders both derived dollar amounts under each
          input. Lives on registration_school_year_award_brackets. */}
      <BracketMatrixCard
        yearId={year.id}
        title="Family Payment Matrix"
        description={`The percentage of base tuition + transportation each family pays, given their household size (rows) and annual income bracket (columns). Base tuition: ${formatCurrency(year.tuition)} · base transportation: ${formatCurrency(year.transportation_fees)}. Each cell shows both derived dollar amounts. Cell edits save on blur.`}
        endpoint="/api/admin/school-year-brackets"
        valueField="tuition_percentage"
        valueKind="percentage"
        derivations={[
          { label: "Tuition", baseAmount: year.tuition },
          { label: "Transport", baseAmount: year.transportation_fees },
        ]}
      />

      {/* High-net-assets sliding scale — applies to families with net
          assets above $100k. Once a family clears that threshold,
          household size doesn't matter; only the asset bracket does.
          So this is a 1D list, not a household × bracket matrix.
          Transportation is intentionally absent as a derivation:
          high-net-assets families pay the full transportation fee
          regardless of the scale. */}
      <BracketListCard
        yearId={year.id}
        title="Net Assets > $100k Payment Percentage"
        description={`For families whose net assets exceed $100k. Each row is the percentage of base tuition the family pays for that asset bracket. Base tuition: ${formatCurrency(year.tuition)}. Transportation is the full ${formatCurrency(year.transportation_fees)} for every family in this group — not on the sliding scale.`}
        endpoint="/api/admin/school-year-net-assets-brackets"
        minField="net_asset_min"
        maxField="net_asset_max"
        valueField="percentage_of_total_tuition"
        derivations={[
          { label: "Tuition", baseAmount: year.tuition },
        ]}
        bracketAxisLabel="Net asset bracket"
      />
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
              description="Full-year published tuition. The Family Payment Matrix's percentages are taken against this number."
            />
            <CurrencyField
              label="Annual fees"
              value={form.annual_fees}
              editing={editing}
              onChange={(v) => patch("annual_fees", v)}
              description="Per-year fees layered on top of tuition (books, materials, activity)."
            />
            <CurrencyField
              label="Transportation fees"
              value={form.transportation_fees}
              editing={editing}
              onChange={(v) => patch("transportation_fees", v)}
              description="Bus / shuttle for the year. Slid by the same matrix as tuition."
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
              description="Family Empowerment Scholarship – Educational Options, 8th grade."
            />
            <CurrencyField
              label="FES-EO · Grade 9"
              value={form.fes_eo_9}
              editing={editing}
              onChange={(v) => patch("fes_eo_9", v)}
              description="Family Empowerment Scholarship – Educational Options, 9th grade."
            />
            <CurrencyField
              label="FTC · Grade 8"
              value={form.ftc_8}
              editing={editing}
              onChange={(v) => patch("ftc_8", v)}
              description="Florida Tax Credit scholarship, 8th grade."
            />
            <CurrencyField
              label="FTC · Grade 9"
              value={form.ftc_9}
              editing={editing}
              onChange={(v) => patch("ftc_9", v)}
              description="Florida Tax Credit scholarship, 9th grade."
            />
            <CurrencyField
              label="FES-UA ESE 1-3 · Grade 8"
              value={form.fes_ua_8_ese_1_3}
              editing={editing}
              onChange={(v) => patch("fes_ua_8_ese_1_3", v)}
              description="FES-UA, ESE matrix levels 1–3, 8th grade."
            />
            <CurrencyField
              label="FES-UA ESE 1-3 · Grade 9"
              value={form.fes_ua_9_ese_1_3}
              editing={editing}
              onChange={(v) => patch("fes_ua_9_ese_1_3", v)}
              description="FES-UA, ESE matrix levels 1–3, 9th grade."
            />
            <CurrencyField
              label="FES-UA ESE 4"
              value={form.fes_ua_ese_4}
              editing={editing}
              onChange={(v) => patch("fes_ua_ese_4", v)}
              description="FES-UA, ESE matrix level 4 (any grade)."
            />
            <CurrencyField
              label="FES-UA ESE 5"
              value={form.fes_ua_ese_5}
              editing={editing}
              onChange={(v) => patch("fes_ua_ese_5", v)}
              description="FES-UA, ESE matrix level 5 (any grade)."
            />
          </div>
        </Section>

        <Section title="Opportunity Scholarship">
          <CurrencyField
            label="Default award amount (legacy / fallback)"
            value={form.opportunity_scholarship_award}
            editing={editing}
            onChange={(v) => patch("opportunity_scholarship_award", v)}
            description="Used when a per-student award hasn't been entered manually on the application."
          />
        </Section>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────── Bracket matrix card (generic) ─────────────────────── */

interface BracketShape {
  /** "min-max" or "min-null" key — uniquely identifies a column */
  key: string;
  income_min: number;
  income_max: number | null;
}

/** Minimal shape every matrix row must satisfy. The two concrete row
 *  types (`XanoSchoolYearAwardBracket` and `XanoSchoolYearNetAssetsBracket`)
 *  both have these columns; the only difference is the value field
 *  (`tuition_payment` vs `tuition_percentage`), which we look up
 *  dynamically via `valueField`. */
interface BracketRowBase {
  id: number;
  household_size: number;
  income_min: number;
  income_max: number | null;
  [extra: string]: unknown;
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

interface BracketMatrixCardProps {
  yearId: number;
  title: string;
  description: string;
  /** Base path for the admin endpoints — POST goes here, PATCH/DELETE
   *  go to `${endpoint}/${id}`. */
  endpoint: string;
  /** Name of the cell-value field on the row. The matrix is otherwise
   *  identical between tuition (currency) and net-assets (percentage)
   *  surfaces, so we just swap the field reference. */
  valueField: string;
  /** Visual treatment of cell values + the input affordance. */
  valueKind: "currency" | "percentage";
  /** When `valueKind` is "percentage", each entry adds a derived
   *  dollar line under the cell input — e.g. `{ label: "Tuition",
   *  baseAmount: 26000 }` renders "Tuition = $2,080" when the cell
   *  value is 8. Pass multiple entries to surface several derivations
   *  from the same percentage (tuition + transportation today). */
  derivations?: Array<{ label: string; baseAmount: number }>;
  /** Optional discriminator merged into every POST + every GET filter
   *  string. Used so two card instances on the same page don't see
   *  each other's rows when they live on the same Xano table. */
  flag?: Record<string, boolean>;
  /** Override the bracket-axis label in copy + empty state — net
   *  assets matrix calls them "net asset brackets" rather than
   *  "income brackets". */
  bracketAxisLabel?: string;
}

function BracketMatrixCard({
  yearId,
  title,
  description,
  endpoint,
  valueField,
  valueKind,
  derivations,
  flag,
  bracketAxisLabel = "income bracket",
}: BracketMatrixCardProps) {
  // Build the SWR key from the endpoint + flag so two cards using the
  // same endpoint (Tuition vs Transportation, both on award_brackets)
  // hit different cache entries and re-fetch independently.
  const flagQuery = flag
    ? Object.entries(flag)
        .map(([k, v]) => `&${encodeURIComponent(k)}=${v}`)
        .join("")
    : "";
  const swrKey = `${endpoint}?yearId=${yearId}${flagQuery}`;

  const {
    data: cells,
    isLoading,
    error,
    mutate,
  } = useSWR<BracketRowBase[]>(swrKey, adminFetcher);

  // `pendingMutation` covers the gap between a structural change
  // (cell create / bracket-bound update / row|column delete) and the
  // SWR revalidation that follows. Without it, the table briefly
  // shows the old labels with the new bounds (or vice versa) which
  // reads as a flicker. We collapse to a skeleton during that window.
  const [pendingMutation, setPendingMutation] = useState(false);
  async function withPending<T>(fn: () => Promise<T>): Promise<T> {
    setPendingMutation(true);
    try {
      return await fn();
    } finally {
      setPendingMutation(false);
    }
  }

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
    const map = new Map<string, BracketRowBase>();
    for (const c of safeCells) {
      const key = `${c.household_size}::${bracketKey(c.income_min, c.income_max)}`;
      map.set(key, c);
    }
    return map;
  }, [safeCells]);

  // Default empty value for a freshly-created cell. Currency = 0 dollars,
  // percentage = 0%.
  function buildPostBody(
    extra: Record<string, unknown>
  ): Record<string, unknown> {
    return {
      registration_school_years_id: yearId,
      ...flag,
      ...extra,
    };
  }

  /* ────── Adders ────── */

  async function addHouseholdSize() {
    const next = sizes.length === 0 ? 1 : Math.max(...sizes) + 1;
    // Helper: throw on non-2xx so a Xano 400 doesn't silently fall
    // through and fire a misleading success toast. `fetch` only
    // rejects on network failure, not HTTP errors.
    async function postOrThrow(body: Record<string, unknown>) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Add failed (${res.status})`);
      }
    }

    await withPending(async () => {
      if (brackets.length === 0) {
        try {
          await postOrThrow(
            buildPostBody({
              household_size: next,
              income_min: 0,
              income_max: 25000,
              [valueField]: 0,
            })
          );
          await mutate();
          toast.success(
            "Added first cell. Add brackets to grow the matrix."
          );
        } catch (err) {
          console.error("[BracketMatrixCard.addHouseholdSize] failed:", err);
          toast.error(
            err instanceof Error ? err.message : "Couldn't add row."
          );
        }
        return;
      }
      try {
        await Promise.all(
          brackets.map((b) =>
            postOrThrow(
              buildPostBody({
                household_size: next,
                income_min: b.income_min,
                income_max: b.income_max,
                [valueField]: 0,
              })
            )
          )
        );
        await mutate();
        toast.success(`Added household size ${next}.`);
      } catch (err) {
        console.error("[BracketMatrixCard.addHouseholdSize] failed:", err);
        toast.error(err instanceof Error ? err.message : "Couldn't add row.");
      }
    });
  }

  async function addIncomeBracket() {
    let min = 0;
    let max: number | null = 25000;
    if (brackets.length > 0) {
      const last = brackets[brackets.length - 1];
      if (last.income_max === null) {
        min = last.income_min + 1;
        max = null;
      } else {
        min = last.income_max;
        max = last.income_max + 25000;
      }
    }
    const sizesToSeed = sizes.length === 0 ? [1] : sizes;
    await withPending(async () => {
      try {
        await Promise.all(
          sizesToSeed.map(async (s) => {
            const res = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                buildPostBody({
                  household_size: s,
                  income_min: min,
                  income_max: max,
                  [valueField]: 0,
                })
              ),
            });
            if (!res.ok) {
              const errBody = await res.json().catch(() => null);
              throw new Error(
                errBody?.error ?? `Add failed (${res.status})`
              );
            }
          })
        );
        await mutate();
        toast.success(`Added bracket ${formatCurrency(min)}+.`);
      } catch (err) {
        console.error("[BracketMatrixCard.addIncomeBracket] failed:", err);
        toast.error(
          err instanceof Error ? err.message : "Couldn't add column."
        );
      }
    });
  }

  async function deleteHouseholdSize(size: number) {
    const targets = safeCells.filter((c) => c.household_size === size);
    await withPending(async () => {
      try {
        await Promise.all(
          targets.map(async (c) => {
            const res = await fetch(`${endpoint}/${c.id}`, {
              method: "DELETE",
            });
            if (!res.ok) {
              const errBody = await res.json().catch(() => null);
              throw new Error(
                errBody?.error ?? `Delete failed (${res.status})`
              );
            }
          })
        );
        await mutate();
        toast.success(`Removed household size ${size}.`);
      } catch (err) {
        console.error("[BracketMatrixCard.deleteHouseholdSize] failed:", err);
        toast.error(err instanceof Error ? err.message : "Couldn't delete.");
      }
    });
  }

  async function deleteBracket(b: BracketShape) {
    const targets = safeCells.filter(
      (c) =>
        c.income_min === b.income_min && (c.income_max ?? null) === b.income_max
    );
    await withPending(async () => {
      try {
        await Promise.all(
          targets.map(async (c) => {
            const res = await fetch(`${endpoint}/${c.id}`, {
              method: "DELETE",
            });
            if (!res.ok) {
              const errBody = await res.json().catch(() => null);
              throw new Error(
                errBody?.error ?? `Delete failed (${res.status})`
              );
            }
          })
        );
        await mutate();
        toast.success(`Removed bracket ${formatBracketLabel(b)}.`);
      } catch (err) {
        console.error("[BracketMatrixCard.deleteBracket] failed:", err);
        toast.error(err instanceof Error ? err.message : "Couldn't delete.");
      }
    });
  }

  async function patchCell(id: number, fields: Record<string, unknown>) {
    try {
      const res = await fetch(`${endpoint}/${id}`, {
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
    await withPending(async () => {
      try {
        await Promise.all(
          targets.map((c) =>
            fetch(`${endpoint}/${c.id}`, {
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
    });
  }

  // Sticky-left column needs an explicit width AND a fully opaque
  // background so it doesn't bleed into the next column when the
  // table scrolls horizontally. Dropping `bg-muted/40` (40% alpha)
  // for `bg-muted` (opaque) was the actual fix for the overlap.
  const HOUSEHOLD_COL_W = "w-[160px] min-w-[160px] max-w-[160px]";

  // Read-only calculated tables only make sense for percentage
  // matrices with one or more dollar bases to multiply against. For
  // currency matrices we skip them entirely.
  const validDerivations =
    valueKind === "percentage" && derivations
      ? derivations.filter(
          (d) =>
            typeof d.baseAmount === "number" &&
            Number.isFinite(d.baseAmount) &&
            d.baseAmount > 0
        )
      : [];

  // Show the skeleton during the initial load *and* while a structural
  // mutation (cell create / bracket edit / row|column delete) is
  // re-fetching. This avoids the brief frame where stale cell labels
  // sit next to fresh bracket bounds while SWR catches up.
  const showSkeleton =
    (isLoading && safeCells.length === 0) || pendingMutation;

  return (
    <>
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {description}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={addHouseholdSize}
              disabled={pendingMutation}
              className="bg-white"
            >
              <Plus className="size-4 mr-1" />
              Add row
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={addIncomeBracket}
              disabled={pendingMutation}
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
            Confirm the corresponding Xano table exists and exposes the
            documented endpoints.
          </div>
        ) : null}
        {showSkeleton ? (
          <div className="p-4 space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : sizes.length === 0 || brackets.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              No matrix configured yet for this year.
            </p>
            <p className="text-xs text-muted-foreground/80 mb-4">
              Click <strong>Add bracket</strong> to set up your first{" "}
              {bracketAxisLabel} column, then <strong>Add row</strong>{" "}
              to add household sizes.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow className="hover:bg-muted">
                  <TableHead
                    className={cn(
                      "text-xs font-semibold uppercase tracking-wider text-muted-foreground sticky left-0 bg-muted z-20 border-r px-4 py-3",
                      HOUSEHOLD_COL_W
                    )}
                  >
                    Household
                  </TableHead>
                  {brackets.map((b) => (
                    <TableHead
                      key={b.key}
                      className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[200px] px-4 py-3"
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
                    <TableCell
                      className={cn(
                        "font-medium sticky left-0 bg-white z-10 border-r px-4 py-3",
                        HOUSEHOLD_COL_W
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
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
                      const cellValue =
                        cell && typeof cell[valueField] === "number"
                          ? (cell[valueField] as number)
                          : 0;
                      return (
                        <TableCell key={b.key} className="px-3 py-2">
                          <MatrixCell
                            value={cellValue}
                            valueKind={valueKind}
                            onSave={(amount) => {
                              if (cell) {
                                patchCell(cell.id, {
                                  [valueField]: amount,
                                });
                              } else {
                                // Cell doesn't exist (gap in matrix) —
                                // create it on first edit. Surface
                                // errors via toast + console so the
                                // user isn't left wondering why the
                                // value didn't stick.
                                withPending(async () => {
                                  try {
                                    const res = await fetch(endpoint, {
                                      method: "POST",
                                      headers: {
                                        "Content-Type": "application/json",
                                      },
                                      body: JSON.stringify(
                                        buildPostBody({
                                          household_size: size,
                                          income_min: b.income_min,
                                          income_max: b.income_max,
                                          [valueField]: amount,
                                        })
                                      ),
                                    });
                                    if (!res.ok) {
                                      const errBody = await res.json().catch(() => null);
                                      throw new Error(
                                        errBody?.error ?? `Save failed (${res.status})`
                                      );
                                    }
                                    await mutate();
                                  } catch (err) {
                                    console.error(
                                      "[BracketMatrixCard.inlineCellCreate] failed:",
                                      err
                                    );
                                    toast.error(
                                      err instanceof Error
                                        ? err.message
                                        : "Couldn't save."
                                    );
                                  }
                                });
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

    {/* One read-only calculated table per derivation. They share the
        same SWR cache key as the editor above (since they read from
        the same `cells` array), so a successful cell save in the
        editor re-renders the calculated tables with the new figures
        — no extra fetch, no manual sync. */}
    {validDerivations.map((d) => (
      <CalculatedMatrixCard
        key={d.label}
        title={`Calculated ${d.label}`}
        description={`Each cell = ${formatCurrency(d.baseAmount)} (base ${d.label.toLowerCase()}) × the percentage in the matrix above. Read-only; updates when a percentage cell is saved.`}
        baseAmount={d.baseAmount}
        sizes={sizes}
        brackets={brackets}
        cellLookup={cellLookup}
        valueField={valueField}
        isLoading={showSkeleton}
      />
    ))}
    </>
  );
}

/**
 * Read-only sibling of `BracketMatrixCard`. Mirrors the same matrix
 * shape (household × bracket) but renders calculated dollar values
 * instead of inputs — the editor cells above hold the percentages,
 * these cards show what those percentages translate to against a
 * specific dollar base (tuition, transportation, etc.).
 *
 * Driven entirely by props: takes the cells + derived sizes/brackets
 * computed by the parent so the math is centralized. Shows a skeleton
 * during the same `pendingMutation` window the editor uses, so a
 * structural change doesn't briefly show stale calculated values.
 */
function CalculatedMatrixCard({
  title,
  description,
  baseAmount,
  sizes,
  brackets,
  cellLookup,
  valueField,
  isLoading,
}: {
  title: string;
  description: string;
  baseAmount: number;
  sizes: number[];
  brackets: BracketShape[];
  cellLookup: Map<string, BracketRowBase>;
  valueField: string;
  isLoading: boolean;
}) {
  const HOUSEHOLD_COL_W = "w-[160px] min-w-[160px] max-w-[160px]";

  const empty = !isLoading && (sizes.length === 0 || brackets.length === 0);

  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        </div>
      </CardHeader>
      <CardContent className="p-0 bg-white">
        {isLoading ? (
          <div className="p-4 space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : empty ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No cells to calculate yet — add brackets and household
              sizes to the percentage matrix above.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow className="hover:bg-muted">
                  <TableHead
                    className={cn(
                      "text-xs font-semibold uppercase tracking-wider text-muted-foreground sticky left-0 bg-muted z-20 border-r px-4 py-3",
                      HOUSEHOLD_COL_W
                    )}
                  >
                    Household
                  </TableHead>
                  {brackets.map((b) => (
                    <TableHead
                      key={b.key}
                      className="text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[140px] px-4 py-3"
                    >
                      {formatBracketLabel(b)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sizes.map((size) => (
                  <TableRow key={size}>
                    <TableCell
                      className={cn(
                        "font-medium sticky left-0 bg-white z-10 border-r px-4 py-3",
                        HOUSEHOLD_COL_W
                      )}
                    >
                      {size} {size === 1 ? "person" : "people"}
                    </TableCell>
                    {brackets.map((b) => {
                      const cell = cellLookup.get(`${size}::${b.key}`);
                      const pct =
                        cell && typeof cell[valueField] === "number"
                          ? (cell[valueField] as number)
                          : 0;
                      const dollars = baseAmount * (pct / 100);
                      return (
                        <TableCell
                          key={b.key}
                          className="text-sm tabular-nums text-foreground px-4 py-3"
                        >
                          {formatCurrency(dollars)}
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
  // Stringify with locale formatting (commas) so the displayed value
  // matches the rest of the money inputs on the page. Defends
  // against `String(undefined)` reaching the input — SWR can hand
  // us undefined for one render right after a POST round-trip.
  const minStr = (m: number | undefined) =>
    Number.isFinite(m)
      ? (m as number).toLocaleString("en-US", { maximumFractionDigits: 2 })
      : "";
  const maxStr = (m: number | null | undefined) =>
    m === null || m === undefined || !Number.isFinite(m as number)
      ? ""
      : (m as number).toLocaleString("en-US", { maximumFractionDigits: 2 });
  // Strip everything but digits/period/minus before parsing — same
  // approach as `CurrencyField`. Returns NaN on empty so the caller
  // can distinguish "blank" from "0".
  const parseMoney = (s: string): number => {
    const stripped = s.replace(/[^\d.-]/g, "");
    if (stripped === "" || stripped === "-") return NaN;
    const n = Number(stripped);
    return Number.isFinite(n) ? n : NaN;
  };
  const [editing, setEditing] = useState(false);
  const [min, setMin] = useState(minStr(bracket.income_min));
  const [max, setMax] = useState(maxStr(bracket.income_max));

  useEffect(() => {
    setMin(minStr(bracket.income_min));
    setMax(maxStr(bracket.income_max));
  }, [bracket.income_min, bracket.income_max]);

  // Reformat free-typed input with locale commas so the display
  // stays consistent ("26,822") while the user types. Returns "" if
  // the input only contains separators / signs.
  const formatTyped = (raw: string): string => {
    const n = parseMoney(raw);
    return Number.isFinite(n) ? n.toLocaleString("en-US") : "";
  };

  if (editing) {
    return (
      // Min/Max grow to fill the full cell width via `flex-1`. The
      // separator and action buttons stay at their intrinsic width
      // so they don't inflate.
      <div className="flex items-center gap-1 normal-case tracking-normal w-full">
        <Input
          type="text"
          inputMode="numeric"
          value={min}
          onChange={(e) => setMin(formatTyped(e.target.value))}
          onFocus={(e) => {
            if (min === "0") {
              setMin("");
            } else {
              e.target.select();
            }
          }}
          className="h-7 text-xs flex-1 min-w-0 tabular-nums"
          placeholder="Min $"
        />
        <span className="text-muted-foreground shrink-0">–</span>
        <Input
          type="text"
          inputMode="numeric"
          value={max}
          onChange={(e) => setMax(formatTyped(e.target.value))}
          onFocus={(e) => {
            if (max === "0") {
              setMax("");
            } else {
              e.target.select();
            }
          }}
          className="h-7 text-xs flex-1 min-w-0 tabular-nums"
          placeholder="Max $ (blank = +)"
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => {
            // Parse the comma-formatted strings back to plain numbers.
            // An empty Max is intentional (= unbounded "+ row") so we
            // pass null. An empty Min coerces to 0.
            const minParsed = parseMoney(min);
            const nextMin = Number.isFinite(minParsed) ? minParsed : 0;
            const maxParsed = parseMoney(max);
            const nextMax = max === "" ? null : Number.isFinite(maxParsed) ? maxParsed : null;
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
            setMin(minStr(bracket.income_min));
            setMax(maxStr(bracket.income_max));
          }}
          aria-label="Cancel"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  // Display mode inherits the parent TableHead's text-xs / uppercase /
  // tracking-wider / muted treatment so this bracket label looks
  // identical to the "HOUSEHOLD" label in the same row.
  return (
    <div className="flex items-center justify-between gap-1">
      <span>{formatBracketLabel(bracket)}</span>
      <div className="flex items-center gap-0.5 normal-case tracking-normal">
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
 * `valueKind` swaps the affordance between currency ("$" prefix) and
 * percentage ("%" suffix). The dollar figures derived from a
 * percentage live in their own read-only `CalculatedMatrixCard`s
 * below the editable matrix — keeps the editable cells clean.
 */
function MatrixCell({
  value: initial,
  valueKind,
  onSave,
}: {
  value: number;
  valueKind: "currency" | "percentage";
  onSave: (amount: number) => void;
}) {
  // Guard against `String(undefined)` reaching the input — number
  // inputs reject "undefined" with a "cannot be parsed" warning, and
  // bracketed-data races sometimes hand us `undefined` for one render
  // before SWR settles.
  const safeInitial = Number.isFinite(initial) ? initial : 0;
  const [value, setValue] = useState(String(safeInitial));

  useEffect(() => {
    setValue(String(Number.isFinite(initial) ? initial : 0));
  }, [initial]);

  function commit() {
    const n = value === "" ? 0 : Number(value);
    if (!Number.isFinite(n)) {
      setValue(String(safeInitial));
      return;
    }
    if (n === safeInitial) return; // no-op
    onSave(n);
  }

  return (
    <div className="relative">
      {valueKind === "currency" ? (
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
          $
        </span>
      ) : (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
          %
        </span>
      )}
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        max={valueKind === "percentage" ? 100 : undefined}
        // Treat 0 as an unset placeholder rather than a real value.
        // Focusing clears it so the admin can type fresh without
        // backspacing; a non-zero value gets selected so typing
        // replaces it cleanly.
        placeholder="0"
        value={value}
        onFocus={(e) => {
          if (value === "0") {
            setValue("");
          } else {
            e.target.select();
          }
        }}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={cn(
          "h-9 text-sm tabular-nums bg-white",
          valueKind === "currency" ? "pl-5" : "pr-5"
        )}
      />
    </div>
  );
}

/* ─────────────────────── Bracket list card (1D) ─────────────────────── */

/**
 * 1D variant of `BracketMatrixCard` for tables that don't have a
 * household-size axis — currently just the high-net-assets tuition
 * scale. Each row is one bracket: bounds + percentage input + delete.
 *
 * Mirrors the editor's behavior contract:
 *   - Cell-value PATCHes save on blur with no skeleton flash
 *   - Structural changes (add row, edit bounds, delete) flip a
 *     `pendingMutation` flag and swap to a skeleton until SWR
 *     revalidates, so labels and values never disagree mid-render
 *   - One `CalculatedListCard` per derivation renders below, sharing
 *     the same SWR cache key so it stays in lockstep with the editor
 */
interface BracketListCardProps {
  yearId: number;
  title: string;
  description: string;
  endpoint: string;
  /** Xano column for the lower bound of the bracket (e.g.
   *  `income_min`, `net_asset_min`). Different tables name this
   *  differently, so the caller passes the actual column name. */
  minField: string;
  /** Xano column for the upper bound; nullable column = unbounded
   *  "and up" row. (e.g. `income_max`, `net_asset_max`). */
  maxField: string;
  /** Xano column holding the cell value (e.g. `tuition_percentage`,
   *  `percentage_of_total_tuition`). */
  valueField: string;
  derivations?: Array<{ label: string; baseAmount: number }>;
  bracketAxisLabel?: string;
}

interface BracketListRow {
  id: number;
  [field: string]: unknown;
}

function BracketListCard({
  yearId,
  title,
  description,
  endpoint,
  minField,
  maxField,
  valueField,
  derivations,
  bracketAxisLabel = "Bracket",
}: BracketListCardProps) {
  const swrKey = `${endpoint}?yearId=${yearId}`;
  const {
    data: rows,
    isLoading,
    error,
    mutate,
  } = useSWR<BracketListRow[]>(swrKey, adminFetcher);

  const [pendingMutation, setPendingMutation] = useState(false);
  async function withPending<T>(fn: () => Promise<T>): Promise<T> {
    setPendingMutation(true);
    try {
      return await fn();
    } finally {
      setPendingMutation(false);
    }
  }

  const safeRows = useMemo(
    () => (Array.isArray(rows) ? rows : []),
    [rows]
  );

  // Reading bounds + value off a row — generic over the column names
  // so the same component works for the awards table (income_min/_max)
  // and the net-assets table (net_asset_min/_max).
  function rowMin(r: BracketListRow): number {
    const v = r[minField];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  }
  function rowMax(r: BracketListRow): number | null {
    const v = r[maxField];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }

  // Sort by lower bound; null upper bound sinks to the bottom (it's
  // the unbounded "and up" row).
  const sortedRows = useMemo(() => {
    return [...safeRows].sort((a, b) => {
      const aMax = rowMax(a);
      const bMax = rowMax(b);
      if (aMax === null && bMax !== null) return 1;
      if (bMax === null && aMax !== null) return -1;
      return rowMin(a) - rowMin(b);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeRows, minField, maxField]);

  async function addBracket() {
    let min = 0;
    let max: number | null = 25000;
    if (sortedRows.length > 0) {
      const last = sortedRows[sortedRows.length - 1];
      const lastMax = rowMax(last);
      if (lastMax === null) {
        // Top is unbounded — split it so the new bracket has a finite top.
        min = rowMin(last) + 1;
        max = null;
      } else {
        min = lastMax;
        max = lastMax + 25000;
      }
    }
    await withPending(async () => {
      try {
        // `fetch` doesn't throw on HTTP errors — without an explicit
        // `res.ok` check, a 400 from Xano falls through, the success
        // toast fires, and the user sees nothing get added. So check.
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            registration_school_years_id: yearId,
            [minField]: min,
            [maxField]: max,
            [valueField]: 0,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Add failed (${res.status})`);
        }
        await mutate();
        toast.success(`Added bracket ${formatCurrency(min)}+.`);
      } catch (err) {
        console.error("[BracketListCard.addBracket] failed:", err);
        toast.error(err instanceof Error ? err.message : "Couldn't add bracket.");
      }
    });
  }

  async function deleteRow(id: number) {
    await withPending(async () => {
      try {
        const res = await fetch(`${endpoint}/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Delete failed (${res.status})`);
        }
        await mutate();
        toast.success("Bracket removed.");
      } catch (err) {
        console.error("[BracketListCard.deleteRow] failed:", err);
        toast.error(err instanceof Error ? err.message : "Couldn't delete.");
      }
    });
  }

  async function patchRow(id: number, fields: Record<string, unknown>) {
    try {
      const res = await fetch(`${endpoint}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      // Xano can silently ignore unknown columns — request returns
      // 200 OK but the field is dropped on the server side. Compare
      // what we sent against the response so the admin gets a clear
      // signal when the column name doesn't match.
      const updated = (await res.json().catch(() => null)) as
        | Record<string, unknown>
        | null;
      console.log("[BracketListCard.patchRow] sent:", fields);
      console.log("[BracketListCard.patchRow] received:", updated);
      if (updated) {
        for (const [k, v] of Object.entries(fields)) {
          const got = updated[k];
          const matched =
            v === null ? got === null : Number(got) === Number(v);
          if (!matched) {
            console.warn(
              `[BracketListCard.patchRow] Xano didn't apply ${k}=${String(
                v
              )}; row came back with ${k}=${String(got)}. Check the column name on the Xano table.`
            );
            toast.error(
              `Save accepted but server didn't update "${k}". Check that the column exists with that name on the Xano table.`
            );
          }
        }
      }
      await mutate();
    } catch (err) {
      console.error("[BracketListCard.patchRow] failed:", err);
      toast.error(err instanceof Error ? err.message : "Save failed.");
    }
  }

  async function updateRowBounds(
    id: number,
    nextMin: number,
    nextMax: number | null
  ) {
    await withPending(async () => {
      try {
        const res = await fetch(`${endpoint}/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            [minField]: nextMin,
            [maxField]: nextMax,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Update failed (${res.status})`);
        }
        await mutate();
        toast.success("Bracket updated.");
      } catch (err) {
        console.error("[BracketListCard.updateRowBounds] failed:", err);
        toast.error(err instanceof Error ? err.message : "Update failed.");
      }
    });
  }

  const showSkeleton =
    (isLoading && safeRows.length === 0) || pendingMutation;

  const validDerivations = derivations
    ? derivations.filter(
        (d) =>
          typeof d.baseAmount === "number" &&
          Number.isFinite(d.baseAmount) &&
          d.baseAmount > 0
      )
    : [];

  return (
    <>
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">{title}</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {description}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={addBracket}
              disabled={pendingMutation}
              className="bg-white"
            >
              <Plus className="size-4 mr-1" />
              Add bracket
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 bg-white">
          {error ? (
            <div className="p-4 text-sm text-red-700 bg-red-50 border-b border-red-200">
              Failed to load list:{" "}
              {error instanceof Error ? error.message : "unknown error"}.
            </div>
          ) : null}
          {showSkeleton ? (
            <div className="p-4 space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : sortedRows.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground mb-3">
                No brackets configured yet for this year.
              </p>
              <p className="text-xs text-muted-foreground/80 mb-4">
                Click <strong>Add bracket</strong> to create your first{" "}
                {bracketAxisLabel.toLowerCase()}.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted">
                  <TableRow className="hover:bg-muted">
                    {/* 50/50 split between bracket bounds and the
                        percentage cell. The trash + edit affordances
                        live inside `BracketHeader`, so no separate
                        actions column. */}
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 w-1/2">
                      {bracketAxisLabel}
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 w-1/2">
                      Tuition Percentage
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRows.map((row) => {
                    const value =
                      typeof row[valueField] === "number"
                        ? (row[valueField] as number)
                        : 0;
                    const min = rowMin(row);
                    const max = rowMax(row);
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="px-4 py-3 font-medium w-1/2">
                          <BracketHeader
                            bracket={{
                              key: bracketKey(min, max),
                              income_min: min,
                              income_max: max,
                            }}
                            onSave={(nextMin, nextMax) =>
                              updateRowBounds(row.id, nextMin, nextMax)
                            }
                            onDelete={() => deleteRow(row.id)}
                          />
                        </TableCell>
                        <TableCell className="px-3 py-2 w-1/2">
                          <MatrixCell
                            value={value}
                            valueKind="percentage"
                            onSave={(amount) =>
                              patchRow(row.id, { [valueField]: amount })
                            }
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {validDerivations.map((d) => (
        <CalculatedListCard
          key={d.label}
          title={`Calculated ${d.label}`}
          description={`Each row = ${formatCurrency(d.baseAmount)} (base ${d.label.toLowerCase()}) × the percentage in the list above. Read-only; updates when a row is saved.`}
          baseAmount={d.baseAmount}
          rows={sortedRows}
          minField={minField}
          maxField={maxField}
          valueField={valueField}
          isLoading={showSkeleton}
          bracketAxisLabel={bracketAxisLabel}
        />
      ))}
    </>
  );
}

/**
 * Read-only sibling of `BracketListCard`. Mirrors the same row shape
 * but renders calculated dollar values instead of inputs.
 */
function CalculatedListCard({
  title,
  description,
  baseAmount,
  rows,
  minField,
  maxField,
  valueField,
  isLoading,
  bracketAxisLabel,
}: {
  title: string;
  description: string;
  baseAmount: number;
  rows: BracketListRow[];
  minField: string;
  maxField: string;
  valueField: string;
  isLoading: boolean;
  bracketAxisLabel: string;
}) {
  const empty = !isLoading && rows.length === 0;
  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        </div>
      </CardHeader>
      <CardContent className="p-0 bg-white">
        {isLoading ? (
          <div className="p-4 space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : empty ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No brackets to calculate yet — add one in the list above.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow className="hover:bg-muted">
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 w-1/2">
                    {bracketAxisLabel}
                  </TableHead>
                  <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3 w-1/2">
                    Calculated
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const pct =
                    typeof row[valueField] === "number"
                      ? (row[valueField] as number)
                      : 0;
                  const dollars = baseAmount * (pct / 100);
                  const minRaw = row[minField];
                  const maxRaw = row[maxField];
                  const min =
                    typeof minRaw === "number" && Number.isFinite(minRaw)
                      ? minRaw
                      : 0;
                  const max =
                    typeof maxRaw === "number" && Number.isFinite(maxRaw)
                      ? maxRaw
                      : null;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="px-4 py-3 font-medium w-1/2">
                        {formatBracketLabel({
                          key: bracketKey(min, max),
                          income_min: min,
                          income_max: max,
                        })}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-sm tabular-nums text-foreground w-1/2">
                        {formatCurrency(dollars)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
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

/**
 * Currency-style number input with a leading "$" prefix and an
 * optional `description` rendered as a `FieldDescription` underneath.
 *
 * Renders the value with locale-formatted thousands separators
 * ($26,822 instead of $26822). HTML's native `type="number"` doesn't
 * accept commas, so the input is `type="text"` with `inputMode="numeric"`
 * — non-digit characters are stripped on every change before parsing,
 * so pasting "26,822" or "$26,822" all resolve to 26822.
 *
 * Use `description` for a short, human-readable comment about what
 * the dollar figure represents — e.g. "Annual amount per family" or
 * "Includes books and materials".
 */
function CurrencyField({
  label,
  value,
  editing,
  onChange,
  description,
}: {
  label: string;
  value: number;
  editing: boolean;
  onChange: (v: number) => void;
  description?: string;
}) {
  const display = Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "0";

  return (
    <Field>
      <FieldLabel className="text-xs">{label}</FieldLabel>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          $
        </span>
        <Input
          type="text"
          inputMode="numeric"
          className="pl-7 border-input disabled:opacity-100 disabled:bg-white disabled:cursor-default tabular-nums"
          value={display}
          disabled={!editing}
          onChange={(e) => {
            // Strip everything that isn't a digit, period, or minus
            // — handles users typing or pasting with commas, $ signs,
            // etc. Empty / lone "-" maps to 0.
            const stripped = e.target.value.replace(/[^\d.-]/g, "");
            if (stripped === "" || stripped === "-") {
              onChange(0);
              return;
            }
            const next = Number(stripped);
            onChange(Number.isFinite(next) ? next : 0);
          }}
        />
      </div>
      {description ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
    </Field>
  );
}
