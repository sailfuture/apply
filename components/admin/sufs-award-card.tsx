"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** Award-tier labels — same vocabulary as the tuition breakdown and
 *  the /admin/sufs pipeline page. Keys match `sufs_type`. */
const SUFS_TYPE_LABELS: Record<string, string> = {
  fes_eo_8: "FES-EO (Grade 8)",
  fes_eo_9: "FES-EO (Grade 9)",
  ftc_8: "FTC (Grade 8)",
  ftc_9: "FTC (Grade 9)",
  fes_ua_8_ese_1_3: "FES-UA ESE 1-3 (Grade 8)",
  fes_ua_9_ese_1_3: "FES-UA ESE 1-3 (Grade 9)",
  fes_ua_ese_4: "FES-UA ESE 4",
  fes_ua_ese_5: "FES-UA ESE 5",
  custom: "Custom amount",
};

export interface SufsAwardRow {
  applicationId: number;
  studentName: string;
  sufsType: string;
  sufsStatus: string;
  /** Stored `sufs_award_id` on the application row; 0/null = none. */
  awardId: number | null;
}

/**
 * Admin editor for per-student SUFS award IDs — the 9-digit number the
 * Step Up for Students portal assigns to each award. The scholarship
 * determination happens on the apply-flow Decision card, but the award
 * ID often arrives LATER (after acceptance, sometimes after
 * enrollment), so this card gives the registration and enrolled detail
 * pages a way to record it without reopening the application.
 *
 * Writes go straight to `PATCH /api/admin/applications/[id]`
 * (`sufs_award_id` is allowlisted there); everything else on the row
 * is untouched. Type/status render read-only for context — the full
 * editor stays on the family Decision card.
 */
export function SufsAwardCard({
  rows,
  onSaved,
}: {
  rows: SufsAwardRow[];
  /** Fired after a successful save so the host page can revalidate. */
  onSaved: () => void;
}) {
  if (rows.length === 0) return null;
  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <CardTitle className="text-base">
          Step Up for Students — Award IDs
          <span className="ml-2 inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground align-middle">
            Admin only
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y p-0 bg-white">
        {rows.map((row) => (
          <SufsAwardRowEditor
            key={row.applicationId}
            row={row}
            onSaved={onSaved}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function SufsAwardRowEditor({
  row,
  onSaved,
}: {
  row: SufsAwardRow;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(
    row.awardId ? String(row.awardId) : ""
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    const next = Number(draft);
    const safe = Number.isFinite(next) ? next : 0;
    if (safe === (row.awardId ?? 0)) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/applications/${row.applicationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sufs_award_id: safe }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      toast.success(
        safe
          ? `Award ID saved for ${row.studentName}.`
          : `Award ID cleared for ${row.studentName}.`
      );
      onSaved();
    } catch (err) {
      console.error("[SufsAwardRowEditor.save]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't save the award ID."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{row.studentName}</p>
        <p className="text-xs text-muted-foreground">
          {row.sufsType
            ? SUFS_TYPE_LABELS[row.sufsType] ?? row.sufsType
            : "No SUFS tier selected"}
          {row.sufsStatus ? ` · ${row.sufsStatus}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {saving ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : null}
        <Input
          value={draft}
          type="text"
          inputMode="numeric"
          // SUFS portal hands out a fixed 9-digit numeric ID — same
          // constraints as the Decision-card input: filter non-digits
          // on the fly (hyphenated pastes get cleaned) and cap at 9.
          pattern="\d{0,9}"
          maxLength={9}
          disabled={saving}
          placeholder="From SUFS portal (9 digits)"
          onChange={(e) =>
            setDraft(e.target.value.replace(/\D/g, "").slice(0, 9))
          }
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="w-56 border-input tabular-nums"
        />
      </div>
    </div>
  );
}
