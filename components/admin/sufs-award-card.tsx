"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
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

/**
 * One student's row: read-only until Edit, then tier / status / award
 * ID become editable together behind Cancel + Save.
 *
 * It used to be three always-live controls that each wrote on change
 * or blur. Award bookkeeping is reference data staff read far more
 * often than they change, and live inputs meant a mis-click on a
 * select or a stray keystroke in the ID field was already saved before
 * anyone noticed. Same shape as the NWEA testing card these pages
 * render alongside, so the two read as siblings.
 */
function SufsAwardRowEditor({
  row,
  onSaved,
}: {
  row: SufsAwardRow;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => rowToDraft(row));

  function rowToDraft(r: SufsAwardRow) {
    return {
      tier: r.sufsType || NO_TIER,
      status: r.sufsStatus || NO_STATUS,
      awardId: r.awardId ? String(r.awardId) : "",
    };
  }

  function enterEdit() {
    // Re-seed from the row, not from whatever the last cancelled edit
    // left behind.
    setDraft(rowToDraft(row));
    setEditing(true);
  }

  async function runSave() {
    // Diff-only, one PATCH. `""` is the stored convention for "not on
    // a SUFS scholarship" / "no status" — same value the family
    // Decision card writes.
    const patch: Record<string, string | number> = {};
    const tierStored = draft.tier === NO_TIER ? "" : draft.tier;
    if (tierStored !== (row.sufsType ?? "")) patch.sufs_type = tierStored;
    const statusStored = draft.status === NO_STATUS ? "" : draft.status;
    if (statusStored !== (row.sufsStatus ?? "")) {
      patch.sufs_status = statusStored;
    }
    const parsed = Number(draft.awardId);
    const nextAwardId = Number.isFinite(parsed) ? parsed : 0;
    if (nextAwardId !== (row.awardId ?? 0)) {
      patch.sufs_award_id = nextAwardId;
    }

    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/applications/${row.applicationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      toast.success(`SUFS details saved for ${row.studentName}.`);
      setEditing(false);
      onSaved();
    } catch (err) {
      console.error("[SufsAwardRowEditor.runSave]", err);
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
            <Field>
              <FieldLabel className="text-xs">SUFS tier</FieldLabel>
              <Select
                value={draft.tier}
                onValueChange={(v) => setDraft((d) => ({ ...d, tier: v }))}
                disabled={saving}
              >
                <SelectTrigger className="w-full bg-white">
                  <SelectValue placeholder="SUFS tier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TIER}>
                    Not on a SUFS scholarship
                  </SelectItem>
                  {Object.entries(SUFS_TYPE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel className="text-xs">SUFS status</FieldLabel>
              <Select
                value={draft.status}
                onValueChange={(v) => setDraft((d) => ({ ...d, status: v }))}
                disabled={saving}
              >
                <SelectTrigger className="w-full bg-white">
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
            </Field>
            <Field>
              <FieldLabel className="text-xs">Award ID</FieldLabel>
              <Input
                value={draft.awardId}
                type="text"
                inputMode="numeric"
                // SUFS hands out a fixed 9-digit numeric ID — filter
                // non-digits on the fly so a hyphenated paste like
                // "123-456-789" lands clean, and cap at 9.
                pattern="\d{0,9}"
                maxLength={9}
                disabled={saving}
                placeholder="From SUFS portal (9 digits)"
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    awardId: e.target.value.replace(/\D/g, "").slice(0, 9),
                  }))
                }
                className="tabular-nums"
              />
            </Field>
          </>
        ) : (
          <>
            <ReadValue
              label="SUFS tier"
              value={
                row.sufsType
                  ? (SUFS_TYPE_LABELS[row.sufsType] ?? row.sufsType)
                  : "Not on a SUFS scholarship"
              }
            />
            <ReadValue label="SUFS status" value={row.sufsStatus} />
            <ReadValue
              label="Award ID"
              value={row.awardId ? String(row.awardId) : ""}
            />
          </>
        )}
      </div>
    </div>
  );
}

/** Read-only labeled value — `readOnly` rather than `disabled` so an
 *  admin can still select and copy an award ID out of it. */
function ReadValue({ label, value }: { label: string; value: string }) {
  return (
    <Field>
      <FieldLabel className="text-xs">{label}</FieldLabel>
      <Input
        value={value || "—"}
        readOnly
        className="border-input bg-white text-foreground tabular-nums"
      />
    </Field>
  );
}
