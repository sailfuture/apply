"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { adminFetcher } from "@/lib/admin-fetcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import type { XanoSchoolYear } from "@/lib/xano";

/** A single status for a school year. The Xano row carries four
 *  independent booleans (`isActive`, `isPast`, `isNextYear`, `isFuture`),
 *  but in practice exactly one should be true. We collapse them into a
 *  single value here for the picker, then expand back to the four flags
 *  on save. */
type YearStatus = "active" | "next" | "past" | "future" | "none";

const STATUS_LABEL: Record<YearStatus, string> = {
  active: "Active",
  next: "Upcoming",
  past: "Past",
  future: "Future",
  none: "—",
};

const STATUS_BADGE_CLASS: Record<YearStatus, string> = {
  active: "bg-emerald-100 text-emerald-700 border-emerald-200",
  next: "bg-blue-100 text-blue-700 border-blue-200",
  past: "bg-slate-100 text-slate-600 border-slate-200",
  future: "bg-amber-100 text-amber-700 border-amber-200",
  none: "bg-muted text-muted-foreground border-border",
};

function deriveStatus(y: XanoSchoolYear): YearStatus {
  if (y.isActive) return "active";
  if (y.isNextYear) return "next";
  if (y.isFuture) return "future";
  if (y.isPast) return "past";
  return "none";
}

/** Empty defaults for the create-new form. */
function emptyYear(): EditableYear {
  return {
    year_name: "",
    start_date: "",
    end_date: "",
    application_deadline: "",
    opportunity_scholarship_deadline: "",
    tuition: 0,
    annual_fees: 0,
    transportation_fees: 0,
    fes_eo_8: 0,
    fes_eo_9: 0,
    ftc_8: 0,
    ftc_9: 0,
    fes_ua_8_ese_1_3: 0,
    fes_ua_9_ese_1_3: 0,
    fes_ua_ese_4: 0,
    fes_ua_ese_5: 0,
    opportunity_scholarship_award: 0,
    status: "none",
  };
}

/** Form-friendly shape for the edit sheet — collapses the four status
 *  booleans on the Xano row into a single `status` value. */
interface EditableYear {
  year_name: string;
  start_date: string;
  end_date: string;
  application_deadline: string;
  opportunity_scholarship_deadline: string;
  tuition: number;
  annual_fees: number;
  transportation_fees: number;
  fes_eo_8: number;
  fes_eo_9: number;
  ftc_8: number;
  ftc_9: number;
  fes_ua_8_ese_1_3: number;
  fes_ua_9_ese_1_3: number;
  fes_ua_ese_4: number;
  fes_ua_ese_5: number;
  opportunity_scholarship_award: number;
  status: YearStatus;
}

function fromXano(y: XanoSchoolYear): EditableYear {
  return {
    year_name: y.year_name ?? "",
    start_date: y.start_date ?? "",
    end_date: y.end_date ?? "",
    application_deadline: y.application_deadline ?? "",
    opportunity_scholarship_deadline: y.opportunity_scholarship_deadline ?? "",
    tuition: y.tuition ?? 0,
    annual_fees: y.annual_fees ?? 0,
    transportation_fees: y.transportation_fees ?? 0,
    fes_eo_8: y.fes_eo_8 ?? 0,
    fes_eo_9: y.fes_eo_9 ?? 0,
    ftc_8: y.ftc_8 ?? 0,
    ftc_9: y.ftc_9 ?? 0,
    fes_ua_8_ese_1_3: y.fes_ua_8_ese_1_3 ?? 0,
    fes_ua_9_ese_1_3: y.fes_ua_9_ese_1_3 ?? 0,
    fes_ua_ese_4: y.fes_ua_ese_4 ?? 0,
    fes_ua_ese_5: y.fes_ua_ese_5 ?? 0,
    opportunity_scholarship_award: y.opportunity_scholarship_award ?? 0,
    status: deriveStatus(y),
  };
}

/** Inverse of `fromXano` — expands the single `status` value back into
 *  the four exclusive booleans Xano expects. */
function toXanoPayload(form: EditableYear) {
  return {
    year_name: form.year_name.trim(),
    start_date: form.start_date || null,
    end_date: form.end_date || null,
    application_deadline: form.application_deadline || null,
    opportunity_scholarship_deadline:
      form.opportunity_scholarship_deadline || null,
    tuition: Number(form.tuition) || 0,
    annual_fees: Number(form.annual_fees) || 0,
    transportation_fees: Number(form.transportation_fees) || 0,
    fes_eo_8: Number(form.fes_eo_8) || 0,
    fes_eo_9: Number(form.fes_eo_9) || 0,
    ftc_8: Number(form.ftc_8) || 0,
    ftc_9: Number(form.ftc_9) || 0,
    fes_ua_8_ese_1_3: Number(form.fes_ua_8_ese_1_3) || 0,
    fes_ua_9_ese_1_3: Number(form.fes_ua_9_ese_1_3) || 0,
    fes_ua_ese_4: Number(form.fes_ua_ese_4) || 0,
    fes_ua_ese_5: Number(form.fes_ua_ese_5) || 0,
    opportunity_scholarship_award:
      Number(form.opportunity_scholarship_award) || 0,
    isActive: form.status === "active",
    isNextYear: form.status === "next",
    isPast: form.status === "past",
    isFuture: form.status === "future",
  };
}

function formatCurrency(value: number | null | undefined): string {
  // Xano can omit numeric columns when their value is the default (or
  // when the schema added a column after the row was created). Treat
  // missing / non-finite values as 0 instead of crashing on
  // `undefined.toLocaleString`.
  const safe = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return safe.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const parsed = new Date(`${d}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AdminSchoolYearsPage() {
  const { data, isLoading, error, mutate } = useSWR<XanoSchoolYear[]>(
    "/api/admin/school-years",
    adminFetcher
  );
  const years = useMemo(
    () => (Array.isArray(data) ? data : []),
    [data]
  );

  const [editing, setEditing] = useState<XanoSchoolYear | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<XanoSchoolYear | null>(null);
  const sheetOpen = editing !== null || creating;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">School Years</h1>
          <p className="text-sm text-muted-foreground">
            Tuition, fees, scholarship amounts, and deadlines for every
            academic year.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4 mr-1.5" />
          Add School Year
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load school years:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : null}

      <div className="rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Tuition</TableHead>
              <TableHead>Fees</TableHead>
              <TableHead>Deadlines</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && years.length === 0 ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-9 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : years.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-10">
                  No school years yet. Click <strong>Add School Year</strong> to
                  create the first one.
                </TableCell>
              </TableRow>
            ) : (
              years.map((y) => {
                const status = deriveStatus(y);
                return (
                  <TableRow
                    key={y.id}
                    className="cursor-pointer"
                    onClick={() => setEditing(y)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {y.year_name || `Year #${y.id}`}
                        </span>
                        {status !== "none" ? (
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_BADGE_CLASS[status]}`}
                          >
                            {STATUS_LABEL[status]}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{formatDate(y.start_date)}</p>
                      <p className="text-xs text-muted-foreground">
                        to {formatDate(y.end_date)}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">
                        {formatCurrency(y.tuition)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        OS award: {formatCurrency(y.opportunity_scholarship_award)}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">
                        Annual: {formatCurrency(y.annual_fees)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Transport: {formatCurrency(y.transportation_fees)}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">
                        App: {formatDate(y.application_deadline)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Scholarship: {formatDate(y.opportunity_scholarship_deadline)}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      <div
                        className="inline-flex gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => setEditing(y)}
                          aria-label={`Edit ${y.year_name}`}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-red-600"
                          onClick={() => setPendingDelete(y)}
                          aria-label={`Delete ${y.year_name}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <SchoolYearSheet
        open={sheetOpen}
        mode={editing ? "edit" : "create"}
        initial={editing ? fromXano(editing) : emptyYear()}
        editingId={editing?.id ?? null}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        onSaved={() => {
          setEditing(null);
          setCreating(false);
          mutate();
        }}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {pendingDelete?.year_name || "this school year"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the year from Xano. Any application or
              packet that referenced it will keep the foreign key but no
              longer resolve to a year. Only delete years that no real
              student data depends on.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={async (e) => {
                e.preventDefault();
                if (!pendingDelete) return;
                try {
                  const res = await fetch(
                    `/api/admin/school-years/${pendingDelete.id}`,
                    { method: "DELETE" }
                  );
                  if (!res.ok) {
                    const body = await res.json().catch(() => null);
                    throw new Error(body?.error ?? `Failed (${res.status})`);
                  }
                  setPendingDelete(null);
                  await mutate();
                  toast.success("School year deleted.");
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Couldn't delete."
                  );
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface SheetProps {
  open: boolean;
  mode: "edit" | "create";
  initial: EditableYear;
  editingId: number | null;
  onClose: () => void;
  onSaved: () => void;
}

function SchoolYearSheet({
  open,
  mode,
  initial,
  editingId,
  onClose,
  onSaved,
}: SheetProps) {
  const [form, setForm] = useState<EditableYear>(initial);
  const [saving, setSaving] = useState(false);

  // Re-seed the form whenever the sheet opens with a new target row, so
  // editing a different year doesn't show the previous edit's draft.
  useEffect(() => {
    if (open) setForm(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingId]);

  function patch<K extends keyof EditableYear>(key: K, value: EditableYear[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (!form.year_name.trim()) {
      toast.error("Year name is required (e.g. 2026-2027).");
      return;
    }
    setSaving(true);
    try {
      const payload = toXanoPayload(form);
      const res = await fetch(
        mode === "edit"
          ? `/api/admin/school-years/${editingId}`
          : "/api/admin/school-years",
        {
          method: mode === "edit" ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      toast.success(
        mode === "edit" ? "School year updated." : "School year created."
      );
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col">
        <SheetHeader>
          <SheetTitle>
            {mode === "edit" ? "Edit School Year" : "Add School Year"}
          </SheetTitle>
          <SheetDescription>
            Tuition + fees + SUFS award amounts + deadlines for the year.
            Leave SUFS fields at $0 for any program that hasn&rsquo;t set
            its rate yet.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-6">
          {/* Identity */}
          <Section title="Identity">
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="year_name">Year name</FieldLabel>
                <Input
                  id="year_name"
                  placeholder="2026-2027"
                  value={form.year_name}
                  onChange={(e) => patch("year_name", e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Status</FieldLabel>
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
                <FieldDescription>
                  Drives where the year shows up in the parent + admin year
                  pickers.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="start_date">Start date</FieldLabel>
                <Input
                  id="start_date"
                  type="date"
                  value={form.start_date}
                  onChange={(e) => patch("start_date", e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="end_date">End date</FieldLabel>
                <Input
                  id="end_date"
                  type="date"
                  value={form.end_date}
                  onChange={(e) => patch("end_date", e.target.value)}
                />
              </Field>
            </div>
          </Section>

          {/* Tuition + fees */}
          <Section title="Tuition & Fees">
            <div className="grid grid-cols-3 gap-4">
              <CurrencyField
                label="Annual tuition"
                value={form.tuition}
                onChange={(v) => patch("tuition", v)}
              />
              <CurrencyField
                label="Annual fees"
                value={form.annual_fees}
                onChange={(v) => patch("annual_fees", v)}
              />
              <CurrencyField
                label="Transportation fees"
                value={form.transportation_fees}
                onChange={(v) => patch("transportation_fees", v)}
              />
            </div>
          </Section>

          {/* SUFS amounts */}
          <Section
            title="Step Up For Students Award Amounts"
            description="Per-program annual award amount. Leave at $0 for any program not yet set."
          >
            <div className="grid grid-cols-2 gap-4">
              <CurrencyField
                label="FES-EO · Grade 8"
                value={form.fes_eo_8}
                onChange={(v) => patch("fes_eo_8", v)}
              />
              <CurrencyField
                label="FES-EO · Grade 9"
                value={form.fes_eo_9}
                onChange={(v) => patch("fes_eo_9", v)}
              />
              <CurrencyField
                label="FTC · Grade 8"
                value={form.ftc_8}
                onChange={(v) => patch("ftc_8", v)}
              />
              <CurrencyField
                label="FTC · Grade 9"
                value={form.ftc_9}
                onChange={(v) => patch("ftc_9", v)}
              />
              <CurrencyField
                label="FES-UA ESE 1-3 · Grade 8"
                value={form.fes_ua_8_ese_1_3}
                onChange={(v) => patch("fes_ua_8_ese_1_3", v)}
              />
              <CurrencyField
                label="FES-UA ESE 1-3 · Grade 9"
                value={form.fes_ua_9_ese_1_3}
                onChange={(v) => patch("fes_ua_9_ese_1_3", v)}
              />
              <CurrencyField
                label="FES-UA ESE 4"
                value={form.fes_ua_ese_4}
                onChange={(v) => patch("fes_ua_ese_4", v)}
              />
              <CurrencyField
                label="FES-UA ESE 5"
                value={form.fes_ua_ese_5}
                onChange={(v) => patch("fes_ua_ese_5", v)}
              />
            </div>
          </Section>

          {/* Opportunity Scholarship */}
          <Section title="Opportunity Scholarship">
            <CurrencyField
              label="Default award amount"
              value={form.opportunity_scholarship_award}
              onChange={(v) => patch("opportunity_scholarship_award", v)}
            />
          </Section>

          {/* Deadlines */}
          <Section title="Deadlines">
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="application_deadline">
                  Application deadline
                </FieldLabel>
                <Input
                  id="application_deadline"
                  type="date"
                  value={form.application_deadline}
                  onChange={(e) =>
                    patch("application_deadline", e.target.value)
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="opportunity_scholarship_deadline">
                  Opportunity Scholarship deadline
                </FieldLabel>
                <Input
                  id="opportunity_scholarship_deadline"
                  type="date"
                  value={form.opportunity_scholarship_deadline}
                  onChange={(e) =>
                    patch(
                      "opportunity_scholarship_deadline",
                      e.target.value
                    )
                  }
                />
              </Field>
            </div>
          </Section>
        </div>

        <SheetFooter className="flex-row gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="size-4 mr-1.5 animate-spin" />
                Saving
              </>
            ) : mode === "edit" ? (
              "Save changes"
            ) : (
              "Create year"
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

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
    <section className="space-y-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
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

/** Currency-style number input with a leading "$" prefix. Stores the
 *  underlying value as a number. Empty input is treated as 0. */
function CurrencyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
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
          className="pl-7"
          value={Number.isFinite(value) ? String(value) : "0"}
          onChange={(e) => {
            const next = Number(e.target.value);
            onChange(Number.isFinite(next) ? next : 0);
          }}
        />
      </div>
    </Field>
  );
}
