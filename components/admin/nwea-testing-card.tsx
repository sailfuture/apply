"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Pencil } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface NweaTestingRow {
  applicationId: number;
  studentId: number;
  studentName: string;
  /** Per-year bools from the application row. */
  scheduled: boolean;
  complete: boolean;
  /** RIT scores + test dates from the student row. Score 0 or null
   *  both mean unset (the Xano column defaults to 0; real RIT
   *  scores are 100–300). Dates are `YYYY-MM-DD` or empty. */
  math: number | null;
  reading: number | null;
  mathDate: string;
  readingDate: string;
}

/**
 * Admin-only NWEA Initial Testing card — one editor row per student.
 * Mirrors the enrolled detail page's `TestingCard`, hoisted into a
 * shared component so the registration detail page gets the same
 * affordance.
 *
 * Saves fan out to two routes by field ownership: scheduled/complete
 * → `PATCH /api/admin/applications/[id]` (per-year row); scores +
 * dates → `PATCH /api/admin/students/[id]` (canonical student row,
 * follows re-enrollment). Neither route touches `isAccepted`, the
 * registration-confirmed latch, or any section-verify bool, so
 * testing data stays editable after acceptance and after the family
 * registration is confirmed — no revoke needed.
 */
export function NweaTestingCard({
  rows,
  onSaved,
}: {
  rows: NweaTestingRow[];
  /** Fired after a successful save so the host page can revalidate. */
  onSaved: () => void;
}) {
  if (rows.length === 0) return null;
  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <CardTitle className="text-base">
          Initial Testing (NWEA)
          <span className="ml-2 inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground align-middle">
            Admin only
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y p-0 bg-white">
        {rows.map((row) => (
          <NweaStudentRowEditor
            key={row.applicationId}
            row={row}
            onSaved={onSaved}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function scoreToDraft(score: number | null): string {
  return score != null && score !== 0 ? String(score) : "";
}

function NweaStudentRowEditor({
  row,
  onSaved,
}: {
  row: NweaTestingRow;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => rowToDraft(row));

  function rowToDraft(r: NweaTestingRow) {
    return {
      scheduled: r.scheduled,
      complete: r.complete,
      math: scoreToDraft(r.math),
      reading: scoreToDraft(r.reading),
      mathDate: r.mathDate,
      readingDate: r.readingDate,
    };
  }

  function enterEdit() {
    setDraft(rowToDraft(row));
    setEditing(true);
  }

  async function runSave() {
    // Diff-only, split by field ownership — bools on the application
    // row, scores/dates on the student row. Empty score clears to
    // null (matches the apply-flow TestingBlock's semantics).
    const appPatch: Record<string, boolean> = {};
    if (draft.scheduled !== row.scheduled) {
      appPatch.nwea_testing_scheduled = draft.scheduled;
    }
    if (draft.complete !== row.complete) {
      appPatch.nwea_testing_complete = draft.complete;
    }

    const parseScore = (raw: string): number | null => {
      const trimmed = raw.trim();
      if (trimmed === "") return null;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    };
    const studentPatch: Record<string, number | string | null> = {};
    const prevMath = row.math == null || row.math === 0 ? null : row.math;
    const nextMath = parseScore(draft.math);
    if (nextMath !== prevMath) {
      studentPatch.initial_screening_nwea_math = nextMath;
    }
    const prevReading =
      row.reading == null || row.reading === 0 ? null : row.reading;
    const nextReading = parseScore(draft.reading);
    if (nextReading !== prevReading) {
      studentPatch.initial_screening_nwea_reading = nextReading;
    }
    const nextMathDate = draft.mathDate.trim() || null;
    if (nextMathDate !== (row.mathDate || null)) {
      studentPatch.initial_screening_nwea_math_date = nextMathDate;
    }
    const nextReadingDate = draft.readingDate.trim() || null;
    if (nextReadingDate !== (row.readingDate || null)) {
      studentPatch.initial_screening_nwea_reading_date = nextReadingDate;
    }

    if (
      Object.keys(appPatch).length === 0 &&
      Object.keys(studentPatch).length === 0
    ) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const promises: Array<Promise<Response>> = [];
      if (Object.keys(appPatch).length > 0) {
        promises.push(
          fetch(`/api/admin/applications/${row.applicationId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(appPatch),
          })
        );
      }
      if (Object.keys(studentPatch).length > 0) {
        promises.push(
          fetch(`/api/admin/students/${row.studentId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(studentPatch),
          })
        );
      }
      const results = await Promise.all(promises);
      const failed = results.find((r) => !r.ok);
      if (failed) {
        const errBody = await failed.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${failed.status})`);
      }
      toast.success(`Testing details saved for ${row.studentName}.`);
      setEditing(false);
      onSaved();
    } catch (err) {
      console.error("[NweaStudentRowEditor.runSave]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">{row.studentName}</p>
        {editing ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="bg-white"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void runSave()}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saving ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <CheckCircle2 className="size-3.5 mr-1.5" />
              )}
              Save
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={enterEdit}
            className="bg-white"
          >
            <Pencil className="size-3.5 mr-1.5" />
            Edit
          </Button>
        )}
      </div>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {editing ? (
          <>
            <YesNoField
              label="Scheduled"
              value={draft.scheduled}
              onChange={(v) => setDraft((d) => ({ ...d, scheduled: v }))}
              disabled={saving}
            />
            <YesNoField
              label="Complete"
              value={draft.complete}
              onChange={(v) => setDraft((d) => ({ ...d, complete: v }))}
              disabled={saving}
            />
            <div className="hidden lg:block" aria-hidden="true" />
            <EditInput
              label="Math RIT score"
              value={draft.math}
              onChange={(v) => setDraft((d) => ({ ...d, math: v }))}
              disabled={saving}
            />
            <EditInput
              label="Math test date"
              type="date"
              value={draft.mathDate}
              onChange={(v) => setDraft((d) => ({ ...d, mathDate: v }))}
              disabled={saving}
            />
            <div className="hidden lg:block" aria-hidden="true" />
            <EditInput
              label="Reading RIT score"
              value={draft.reading}
              onChange={(v) => setDraft((d) => ({ ...d, reading: v }))}
              disabled={saving}
            />
            <EditInput
              label="Reading test date"
              type="date"
              value={draft.readingDate}
              onChange={(v) => setDraft((d) => ({ ...d, readingDate: v }))}
              disabled={saving}
            />
          </>
        ) : (
          <>
            <ReadValue label="Scheduled" value={row.scheduled ? "Yes" : "No"} />
            <ReadValue label="Complete" value={row.complete ? "Yes" : "No"} />
            <div className="hidden lg:block" aria-hidden="true" />
            <ReadValue label="Math RIT score" value={scoreToDraft(row.math)} />
            <ReadValue label="Math test date" value={row.mathDate} />
            <div className="hidden lg:block" aria-hidden="true" />
            <ReadValue
              label="Reading RIT score"
              value={scoreToDraft(row.reading)}
            />
            <ReadValue label="Reading test date" value={row.readingDate} />
          </>
        )}
      </div>
    </div>
  );
}

/** Read-only labeled value — `readOnly` Input (not disabled) so
 *  admin can select + copy, matching the detail pages' ReadField. */
function ReadValue({ label, value }: { label: string; value: string }) {
  return (
    <Field>
      <FieldLabel className="text-xs">{label}</FieldLabel>
      <Input
        value={value || "—"}
        readOnly
        className="border-input bg-white text-foreground"
      />
    </Field>
  );
}

function EditInput({
  label,
  value,
  onChange,
  type = "text",
  disabled,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <Field>
      <FieldLabel className="text-xs">{label}</FieldLabel>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </Field>
  );
}

function YesNoField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Field>
      <FieldLabel className="text-xs">{label}</FieldLabel>
      <Select
        value={value ? "Yes" : "No"}
        onValueChange={(v) => onChange(v === "Yes")}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="Yes">Yes</SelectItem>
          <SelectItem value="No">No</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}
