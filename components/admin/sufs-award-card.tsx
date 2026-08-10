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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

/** Radix Select forbids `value=""` on items, so the "no scholarship"
 *  choice rides a sentinel that maps back to the empty string the
 *  column convention stores (same convention as the family Decision
 *  card's tier picker). */
const NO_TIER = "none";

/** SUFS status vocabulary — mirrors the family Decision card's
 *  status picker (`SUFS_STATUSES` on the apply-flow detail page).
 *  Same empty-string convention as the tier for "no status". */
const NO_STATUS = "__none";
const SUFS_STATUS_OPTIONS = ["Pending", "Approved", "Denied"];

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
 * Step Up for Students portal assigns to each award — plus the SUFS
 * tier (award level) and status. The scholarship determination happens
 * on the apply-flow Decision card, but the tier choice, status, and
 * the award ID often arrive LATER (after acceptance, sometimes after
 * enrollment), so this card gives the registration and enrolled detail
 * pages a way to record all three without reopening the application —
 * and deliberately carries NO `confirmed_scholarship` lock: award
 * bookkeeping stays editable forever, while the signed tuition
 * amounts keep their own lock on the Decision card.
 *
 * Writes go straight to `PATCH /api/admin/applications/[id]`
 * (`sufs_type`, `sufs_status`, and `sufs_award_id` are all
 * allowlisted there); everything else on the row is untouched. The
 * dollar amount is untouched on purpose — billing reads the stored
 * `sufs_amount`, so a tier correction here never moves what the
 * family signed for.
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
  // Local mirrors so the selects reflect the change instantly; the
  // host page revalidates behind them via onSaved().
  const [tier, setTier] = useState(row.sufsType || NO_TIER);
  const [status, setStatus] = useState(row.sufsStatus || NO_STATUS);
  const [saving, setSaving] = useState(false);

  async function patchApplication(
    body: Record<string, unknown>,
    successMessage: string
  ) {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/applications/${row.applicationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      toast.success(successMessage);
      onSaved();
      return true;
    } catch (err) {
      console.error("[SufsAwardRowEditor.patchApplication]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't save."
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveAwardId() {
    const next = Number(draft);
    const safe = Number.isFinite(next) ? next : 0;
    if (safe === (row.awardId ?? 0)) return;
    await patchApplication(
      { sufs_award_id: safe },
      safe
        ? `Award ID saved for ${row.studentName}.`
        : `Award ID cleared for ${row.studentName}.`
    );
  }

  async function saveTier(next: string) {
    const prev = tier;
    setTier(next);
    // "" per the existing column convention for "not on a SUFS
    // scholarship" — same value the family Decision card stores.
    const stored = next === NO_TIER ? "" : next;
    if (stored === row.sufsType) return;
    const ok = await patchApplication(
      { sufs_type: stored },
      stored
        ? `SUFS tier saved for ${row.studentName}.`
        : `SUFS tier cleared for ${row.studentName}.`
    );
    if (!ok) setTier(prev);
  }

  async function saveStatus(next: string) {
    const prev = status;
    setStatus(next);
    const stored = next === NO_STATUS ? "" : next;
    if (stored === row.sufsStatus) return;
    const ok = await patchApplication(
      { sufs_status: stored },
      stored
        ? `SUFS status saved for ${row.studentName}.`
        : `SUFS status cleared for ${row.studentName}.`
    );
    if (!ok) setStatus(prev);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{row.studentName}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {saving ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : null}
        <Select
          value={tier}
          onValueChange={(v) => void saveTier(v)}
          disabled={saving}
        >
          <SelectTrigger className="w-56 bg-white">
            <SelectValue placeholder="SUFS tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_TIER}>Not on a SUFS scholarship</SelectItem>
            {Object.entries(SUFS_TYPE_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => void saveStatus(v)}
          disabled={saving}
        >
          <SelectTrigger className="w-36 bg-white">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_STATUS}>No status</SelectItem>
            {SUFS_STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          onBlur={() => void saveAwardId()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="w-56 border-input tabular-nums"
        />
      </div>
    </div>
  );
}
