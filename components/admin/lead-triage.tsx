"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Circle,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Undo2,
  UserX,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { adminFetcher } from "@/lib/admin-fetcher";
import { sortYearsOldestFirst } from "@/lib/school-years";
import { formatUSPhone } from "@/lib/phone";
import { formatNoteTimestamp } from "@/lib/format-note-time";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  InquiryNoteComposer,
  InquiryNotes,
  type LeadNoteScope,
} from "@/components/admin/inquiry-notes";
import { LeadTourButton } from "@/components/admin/tour-section";
import { StarRating } from "@/components/admin/star-rating";
import { cn } from "@/lib/utils";

/**
 * Shared lead triage controls — the three things admin does to every
 * recruitment lead regardless of where it came from: rate it 1–5 on
 * likelihood of conversion, mark it followed up, and log what was
 * said. All four sources (inquiry / summer camp / liability-waiver
 * visit / TASCO) write through `/api/admin/leads` and
 * `/api/admin/notes`, so the per-source pages and All Leads can't
 * drift on behavior.
 *
 * `onChanged` fires after a successful rating / follow-up write and
 * after a note is added (the note POST stamps `last_reach_out`
 * server-side), so the host list can revalidate.
 */
export function LeadTriageControls({
  scope,
  rating,
  isFollowedUp,
  lastReachOut,
  actions,
  onChanged,
  className,
}: {
  scope: LeadNoteScope;
  rating: number;
  isFollowedUp: boolean;
  /** Server-stamped timestamp of the most recent note; null when the
   *  lead has never been contacted. */
  lastReachOut?: number | null;
  /** Extra controls rendered inline with the Followed-up button —
   *  the sheet passes Book campus tour so the two sit on one row.
   *  Hosts that don't (Summer Camp, Liability Waiver) get just the
   *  toggle. */
  actions?: React.ReactNode;
  onChanged?: () => void;
  className?: string;
}) {
  const [savingRating, setSavingRating] = useState(false);
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  // Optimistic mirrors — the control flips the instant it's clicked
  // instead of waiting for the PATCH + host revalidation round-trip.
  // The prop catches up after `onChanged()` refreshes the host list;
  // the render-phase resets below clear the mirror when it does (the
  // sanctioned adjust-state-on-prop-change pattern — effects are the
  // wrong tool and the lint bans setState in them). A failed save
  // clears the mirror immediately, visibly reverting the control.
  const [optimisticRating, setOptimisticRating] = useState<number | null>(
    null
  );
  const [optimisticFollowUp, setOptimisticFollowUp] = useState<
    boolean | null
  >(null);
  const [prevRating, setPrevRating] = useState(rating);
  const [prevFollowedUp, setPrevFollowedUp] = useState(isFollowedUp);
  if (rating !== prevRating) {
    setPrevRating(rating);
    setOptimisticRating(null);
  }
  if (isFollowedUp !== prevFollowedUp) {
    setPrevFollowedUp(isFollowedUp);
    setOptimisticFollowUp(null);
  }
  const shownRating = optimisticRating ?? rating;
  const shownFollowedUp = optimisticFollowUp ?? isFollowedUp;

  async function patchLead(
    patch: { interest_level?: number; isFollowedUp?: boolean },
    label: string
  ) {
    const res = await fetch("/api/admin/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: scope.source, id: scope.id, ...patch }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error ?? `${label} failed (${res.status})`);
    }
  }

  async function setRating(v: number) {
    setOptimisticRating(v);
    setSavingRating(true);
    try {
      await patchLead({ interest_level: v }, "Rating save");
      onChanged?.();
    } catch (err) {
      console.error("Failed to save lead rating:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't save the rating."
      );
      setOptimisticRating(null);
    } finally {
      setSavingRating(false);
    }
  }

  async function toggleFollowUp() {
    const next = !shownFollowedUp;
    setOptimisticFollowUp(next);
    setSavingFollowUp(true);
    try {
      await patchLead({ isFollowedUp: next }, "Follow-up save");
      onChanged?.();
    } catch (err) {
      console.error("Failed to save follow-up flag:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't update follow-up."
      );
      setOptimisticFollowUp(null);
    } finally {
      setSavingFollowUp(false);
    }
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Conversion rating — full-width row of its own. */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Likelihood of conversion
        </p>
        <div className="mt-1 flex items-center gap-2">
          <StarRating
            value={shownRating}
            disabled={savingRating}
            onChange={(v) => void setRating(v)}
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            {shownRating ? `${shownRating}/5` : "Not rated"}
          </span>
          {savingRating ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : null}
        </div>
      </div>
      {/* Follow-up toggle + whatever the host docks beside it (the
          sheet passes Book campus tour). A pressed button rather than
          a checkbox: the label stays fixed so the row never reflows,
          and the filled state carries the "on" meaning. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={shownFollowedUp ? "default" : "outline"}
          size="sm"
          aria-pressed={shownFollowedUp}
          disabled={savingFollowUp}
          className={cn("h-8", !shownFollowedUp && "bg-white")}
          title={
            shownFollowedUp
              ? "Followed up — click to clear"
              : "Mark this lead as followed up"
          }
          onClick={() => void toggleFollowUp()}
        >
          {savingFollowUp ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : shownFollowedUp ? (
            <CheckCircle2 className="size-3.5" />
          ) : (
            <Circle className="size-3.5" />
          )}
          Followed up
        </Button>
        {actions}
      </div>
      <p
        className="text-xs text-muted-foreground"
        title={
          lastReachOut
            ? new Date(lastReachOut).toLocaleString()
            : undefined
        }
      >
        {lastReachOut
          ? `Last contacted ${formatNoteTimestamp(lastReachOut)}`
          : "No contact logged yet."}
      </p>
    </div>
  );
}

/**
 * Funnel-stage badge vocabulary, shared by the All Leads table and the
 * triage sheet's conversion section so the two surfaces can't drift.
 * Ranks order table sorting (further along = higher). Stage semantics
 * live on `AllLeadRow.funnel_stage` in the all-leads route.
 */
export const LEAD_FUNNEL_META: Record<
  string,
  { label: string; chip: string; rank: number }
> = {
  linked: {
    label: "Linked",
    chip: "bg-muted text-muted-foreground hover:bg-muted",
    rank: 1,
  },
  started: {
    label: "Started",
    chip: "bg-amber-100 text-amber-800 hover:bg-amber-100",
    rank: 2,
  },
  applied: {
    label: "Applied",
    chip: "bg-blue-100 text-blue-800 hover:bg-blue-100",
    rank: 3,
  },
  accepted: {
    label: "Accepted",
    chip: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
    rank: 4,
  },
  enrolled: {
    label: "Enrolled",
    chip: "bg-green-100 text-green-800 hover:bg-green-100",
    rank: 5,
  },
};

/** The lead's conversion link as the host list knows it — passed into
 *  the sheet so the section renders without its own fetch. */
export interface LeadConversionInfo {
  /** 0 = not linked. */
  family_id: number;
  family_name: string;
  /** "" | "linked" | "started" | "applied" | "accepted" | "enrolled" */
  stage: string;
  /** Epoch ms the link was stamped; 0 when unlinked. */
  converted_at: number;
}

/** Slim row shape from `/api/admin/families` — just the fields the
 *  link picker searches and displays. */
interface FamilyPickerRow {
  id: number;
  family_name: string;
  primary_name: string;
  primary_email: string;
  student_names: string;
}

/**
 * Conversion combobox — one control for the whole link state. The
 * trigger reads as a field (funnel-stage badge + family name, or a
 * "Link to family…" placeholder), and the dropdown both picks a
 * family and offers Unlink when one is already linked. Writes go
 * through `/api/admin/leads` `family_id`, same path for link, re-link,
 * and unlink (0 sentinel).
 *
 * Sits under Opt-in in the Lead details block, styled to match the
 * fields around it rather than as its own titled section.
 */
function LeadConversionEditor({
  scope,
  conversion,
  onChanged,
}: {
  scope: LeadNoteScope;
  conversion: LeadConversionInfo;
  onChanged?: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Families load lazily — only once the admin opens the picker, so
  // every sheet open doesn't pay for the full families list.
  const { data: familyRows, isLoading: familiesLoading } = useSWR<
    FamilyPickerRow[]
  >(pickerOpen ? "/api/admin/families" : null, adminFetcher);

  async function saveLink(familyId: number) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: scope.source,
          id: scope.id,
          family_id: familyId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? `Save failed (${res.status})`);
      }
      if (data?.warning) toast.warning(data.warning);
      else if (familyId > 0) toast.success("Lead linked to family.");
      else toast.success("Lead unlinked.");
      onChanged?.();
    } catch (err) {
      console.error("[LeadConversionEditor.saveLink]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't save the link."
      );
    } finally {
      setSaving(false);
    }
  }

  const meta = LEAD_FUNNEL_META[conversion.stage];
  const linked = conversion.family_id > 0;

  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] text-muted-foreground">Conversion</p>
      <div className="flex items-center gap-1">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={pickerOpen}
              disabled={saving}
              className="h-8 min-w-0 flex-1 justify-between bg-white px-2 font-normal"
              title={
                linked && conversion.converted_at
                  ? `Linked ${new Date(conversion.converted_at).toLocaleString()}`
                  : undefined
              }
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {saving ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin" />
                ) : null}
                {linked ? (
                  <>
                    {meta ? (
                      <Badge
                        className={cn(
                          meta.chip,
                          "shrink-0 px-1.5 py-0 text-[10px] font-medium"
                        )}
                      >
                        {meta.label}
                      </Badge>
                    ) : null}
                    <span className="truncate">
                      {conversion.family_name ||
                        `Family #${conversion.family_id}`}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    Link to family…
                  </span>
                )}
              </span>
              <ChevronsUpDown className="ml-1 size-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-(--radix-popover-trigger-width) min-w-72 p-0"
            align="start"
          >
            <Command>
              <CommandInput placeholder="Search family, parent, or student…" />
              <CommandList>
                <CommandEmpty>
                  {familiesLoading ? "Loading families…" : "No family found."}
                </CommandEmpty>
                {linked ? (
                  <CommandGroup>
                    <CommandItem
                      value="unlink remove clear conversion link"
                      onSelect={() => {
                        setPickerOpen(false);
                        void saveLink(0);
                      }}
                    >
                      <Undo2 className="size-3.5 text-muted-foreground" />
                      <span className="text-sm">
                        Unlink — this lead didn&rsquo;t become this family
                      </span>
                    </CommandItem>
                  </CommandGroup>
                ) : null}
                <CommandGroup>
                  {(familyRows ?? []).map((f) => (
                    <CommandItem
                      key={f.id}
                      // Search across everything an admin might
                      // remember about the family, not just its name.
                      value={`${f.family_name} ${f.primary_name} ${f.primary_email} ${f.student_names} #${f.id}`}
                      onSelect={() => {
                        setPickerOpen(false);
                        void saveLink(f.id);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {f.family_name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[f.primary_name, f.student_names]
                            .filter(Boolean)
                            .join(" · ") || f.primary_email}
                        </p>
                      </div>
                      {f.id === conversion.family_id ? (
                        <Check className="size-3.5 shrink-0" />
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {/* Jump to the family this lead became — the mirror of the
            family page's "View inquiry" button. Icon-only so the
            combobox stays the one substantive control on the row. */}
        {linked ? (
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground"
            title="Open this family"
          >
            <a href={`/admin/families/${conversion.family_id}`}>
              <ExternalLink className="size-3.5" />
              <span className="sr-only">Open this family</span>
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** School-year row as the year picker needs it. */
interface SchoolYearOption {
  id: number;
  year_name: string;
  isActive?: boolean;
  isNextYear?: boolean;
}

/**
 * Academic-year picker — which year this family is asking about.
 *
 * Deliberately HAND-SET and blank until chosen: a family inquiring in
 * August could mean the year starting this month or the one after,
 * and only a person knows which. Inferring it from the submission
 * date would fill the column with confident-looking guesses and make
 * the year filter untrustworthy, which defeats the point.
 *
 * Writes `school_year_id` through `/api/admin/leads` (0 clears back
 * to unassigned); the route echo-verifies like every other lead write.
 */
function LeadYearPicker({
  scope,
  yearId,
  onChanged,
}: {
  scope: LeadNoteScope;
  yearId: number;
  onChanged?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const { data: years } = useSWR<SchoolYearOption[]>(
    "/api/admin/school-years",
    adminFetcher,
    { revalidateOnFocus: false }
  );
  const options = sortYearsOldestFirst(Array.isArray(years) ? years : []);

  async function save(next: number) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: scope.source,
          id: scope.id,
          school_year_id: next,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Save failed (${res.status})`);
      if (data?.warning) toast.warning(data.warning);
      else if (next > 0) toast.success("Academic year set.");
      else toast.success("Academic year cleared.");
      onChanged?.();
    } catch (err) {
      console.error("[LeadYearPicker.save]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] text-muted-foreground">
        Interested in
      </p>
      <Select
        value={yearId > 0 ? String(yearId) : "0"}
        disabled={saving}
        onValueChange={(v) => void save(Number(v))}
      >
        <SelectTrigger className="h-8 w-full bg-white">
          {saving ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Saving…
            </span>
          ) : (
            <SelectValue placeholder="Not set" />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="0">Not set</SelectItem>
          {options.map((y) => (
            <SelectItem key={y.id} value={String(y.id)}>
              {y.year_name}
              {y.isActive ? " (current)" : y.isNextYear ? " (next)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Preset reasons for the "mark not interested" flow. Stored verbatim
 * into `status_reason` so reporting can group on the exact label —
 * same list the Inquiries page uses. "Other" swaps in a free-text
 * input.
 */
const NOT_INTERESTED_REASONS = [
  "Tuition / cost",
  "Chose another school",
  "Distance / transportation",
  "Program not the right fit",
  "Timing — may apply later",
  "Stopped responding",
  "Other",
] as const;

/**
 * Lifecycle status control — lets admin mark any lead "not
 * interested" with a reason (preset list, free text under "Other"),
 * or restore a declined lead back to the active pipeline. Writes
 * `status`/`status_reason` through `/api/admin/leads`; the route
 * echo-verifies, so a source table missing the columns comes back as
 * a warning toast naming what to add in Xano instead of silently
 * saving nothing.
 */
function LeadStatusEditor({
  scope,
  status,
  reason,
  onChanged,
}: {
  scope: LeadNoteScope;
  /** "" = active pipeline; "not_interested" = declined;
   *  "converted" = legacy hand-marked win (treated as active here). */
  status: string;
  reason: string;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customReason, setCustomReason] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  async function save(patch: { status: string; status_reason?: string }) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: scope.source, id: scope.id, ...patch }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Save failed (${res.status})`);
      if (data?.warning) toast.warning(data.warning);
      else if (patch.status === "not_interested") {
        toast.success("Marked not interested.");
      } else {
        toast.success("Lead restored to the active pipeline.");
      }
      setOpen(false);
      setShowCustom(false);
      setCustomReason("");
      onChanged?.();
    } catch (err) {
      console.error("[LeadStatusEditor.save]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  const declined = status === "not_interested";

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setShowCustom(false);
          setCustomReason("");
        }
      }}
    >
      {/* Icon-only so it sits beside Edit in the Lead details header
          without competing with it. Red when the lead is declined —
          that tint IS the status indicator, and the popover carries
          the reason plus Restore. */}
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-pressed={declined}
          className={cn(
            "size-7",
            declined
              ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800"
              : "bg-white text-muted-foreground"
          )}
          disabled={saving}
          title={
            declined
              ? `Not interested${reason ? ` — ${reason}` : ""}`
              : "Mark not interested"
          }
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <UserX className="size-3.5" />
          )}
          <span className="sr-only">
            {declined ? "Not interested" : "Mark not interested"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="end">
        {declined ? (
          <div className="space-y-2 p-1">
            <div className="flex items-center gap-2">
              <Badge className="bg-red-100 text-red-800 hover:bg-red-100 whitespace-nowrap">
                Not interested
              </Badge>
            </div>
            {reason ? (
              <p className="text-xs text-muted-foreground">{reason}</p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-full bg-white"
              disabled={saving}
              onClick={() => void save({ status: "active" })}
              title="Put this lead back in the active pipeline"
            >
              {saving ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <Undo2 className="size-3.5 mr-1.5" />
              )}
              Restore to active
            </Button>
          </div>
        ) : (
          <>
        <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Why not interested?
        </p>
        {showCustom ? (
          <div className="space-y-2 p-1">
            <Input
              autoFocus
              value={customReason}
              disabled={saving}
              placeholder="Reason…"
              className="h-8 border-input bg-white text-sm"
              onChange={(e) => setCustomReason(e.target.value)}
            />
            <div className="flex justify-end gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 bg-white"
                disabled={saving}
                onClick={() => setShowCustom(false)}
              >
                Back
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7"
                disabled={saving || !customReason.trim()}
                onClick={() =>
                  void save({
                    status: "not_interested",
                    status_reason: customReason.trim(),
                  })
                }
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            {NOT_INTERESTED_REASONS.map((r) =>
              r === "Other" ? (
                <button
                  key={r}
                  type="button"
                  disabled={saving}
                  className="rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => setShowCustom(true)}
                >
                  Other…
                </button>
              ) : (
                <button
                  key={r}
                  type="button"
                  disabled={saving}
                  className="rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() =>
                    void save({ status: "not_interested", status_reason: r })
                  }
                >
                  {r}
                </button>
              )
            )}
          </div>
        )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The contact facts the triage sheet can edit. Source-agnostic —
 *  `/api/admin/leads` maps each onto the lead table's own columns. */
export interface LeadEditableDetails {
  student_name: string;
  /** null = the source has no parent-name column (TASCO); the input
   *  is hidden rather than offering an edit that can't save. */
  parent_name: string | null;
  phone: string;
  email: string;
  grade: string;
  school: string;
  /** Messaging/marketing consent. Read-only until Edit is clicked —
   *  and never editable when the source has no consent column
   *  (camp: sign-up is the implied consent). */
  opt_in: boolean;
  opt_in_editable: boolean;
}

/**
 * Full-width phone/email row: the value on its own line (wrapping
 * rather than truncating, so a long address stays readable), with a
 * one-tap action (call / compose) and a copy button.
 */
function ContactRow({
  label,
  value,
  copyValue,
  href,
  actionLabel,
  actionIcon,
}: {
  label: string;
  value: string;
  /** Raw value for the clipboard — the phone copies as digits, not
   *  the prettified display form. */
  copyValue: string;
  href: string | null;
  actionLabel: string;
  actionIcon: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      // Revert the tick after a beat — a persistent check would read
      // as state rather than as confirmation.
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("[ContactRow.copy]", err);
      toast.error("Couldn't copy — your browser blocked clipboard access.");
    }
  }

  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      {value ? (
        <div className="flex items-start justify-between gap-2">
          <a
            href={href ?? undefined}
            className="min-w-0 flex-1 break-all text-sm text-foreground hover:underline"
            title={`${actionLabel} ${value}`}
          >
            {value}
          </a>
          <span className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => void copy()}
              title={copied ? "Copied" : `Copy ${label.toLowerCase()}`}
              aria-label={`Copy ${label.toLowerCase()}`}
            >
              {copied ? (
                <Check className="size-3.5 text-green-600" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
            {href ? (
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="size-7"
                title={`${actionLabel} ${value}`}
              >
                <a href={href} aria-label={actionLabel}>
                  {actionIcon}
                </a>
              </Button>
            ) : null}
          </span>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">—</p>
      )}
    </div>
  );
}

/**
 * Inline editor for a lead's contact facts — read-mode grid with an
 * Edit toggle, PATCHing only the changed fields. Blank values can't
 * be saved (Xano skips empty inputs); the server says so in a warning
 * toast rather than pretending the clear landed.
 */
function LeadDetailsEditor({
  scope,
  details,
  headerActions,
  onChanged,
}: {
  scope: LeadNoteScope;
  details: LeadEditableDetails;
  /** Rendered inline just left of Edit — the sheet docks the
   *  not-interested icon button here. Hidden while editing so the
   *  Cancel/Save pair owns the row. */
  headerActions?: React.ReactNode;
  onChanged?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    student_name: "",
    parent_name: "",
    phone: "",
    email: "",
    grade: "",
    school: "",
  });
  const [draftOptIn, setDraftOptIn] = useState(false);

  // Optimistic snapshot shown between clicking Save and the host's
  // refetch landing. Cleared in the render phase below once the
  // incoming `details` change — the sanctioned adjust-state-on-prop-
  // change pattern (an effect here would flash the stale values).
  const [optimistic, setOptimistic] = useState<LeadEditableDetails | null>(
    null
  );
  const detailsSig = JSON.stringify(details);
  const [prevSig, setPrevSig] = useState(detailsSig);
  if (detailsSig !== prevSig) {
    setPrevSig(detailsSig);
    setOptimistic(null);
  }
  // Everything below reads through this, so read mode, the edit
  // seed, and the diff base all agree on what's currently shown.
  const shown = optimistic ?? details;

  function enterEdit() {
    setDraft({
      student_name: shown.student_name,
      parent_name: shown.parent_name ?? "",
      phone: formatUSPhone(shown.phone) || shown.phone,
      email: shown.email,
      grade: shown.grade,
      school: shown.school,
    });
    setDraftOptIn(shown.opt_in);
    setEditing(true);
  }

  async function save() {
    // Diff-only patch against the row snapshot — untouched fields
    // never hit the API, so a stale value elsewhere can't clobber.
    const patch: Record<string, string | boolean> = {};
    if (draft.student_name.trim() !== shown.student_name) {
      patch.student_name = draft.student_name;
    }
    if (
      shown.parent_name !== null &&
      draft.parent_name.trim() !== shown.parent_name
    ) {
      patch.parent_name = draft.parent_name;
    }
    const draftDigits = draft.phone.replace(/\D/g, "");
    if (draftDigits !== shown.phone.replace(/\D/g, "")) {
      patch.phone = draft.phone;
    }
    if (draft.email.trim() !== shown.email) patch.email = draft.email;
    if (draft.grade.trim() !== shown.grade) patch.grade = draft.grade;
    if (draft.school.trim() !== shown.school) patch.school = draft.school;
    if (shown.opt_in_editable && draftOptIn !== shown.opt_in) {
      patch.opt_in = draftOptIn;
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }

    // Show the new values immediately and close the editor. Waiting
    // for the PATCH *and* the host's full All-Leads refetch (which
    // rescans four lead tables) meant the editor closed on stale text
    // and the values visibly changed a beat later.
    //
    // The optimistic snapshot mirrors what the SERVER will actually
    // store, not the raw draft: blank values are dropped (Xano skips
    // empty inputs) and the phone is stored as bare digits — so a
    // cleared field must not appear cleared here.
    const optimisticNext: LeadEditableDetails = {
      ...shown,
      ...(typeof patch.student_name === "string" && patch.student_name.trim()
        ? { student_name: patch.student_name.trim() }
        : {}),
      ...(typeof patch.parent_name === "string" && patch.parent_name.trim()
        ? { parent_name: patch.parent_name.trim() }
        : {}),
      ...(typeof patch.phone === "string" && patch.phone.replace(/\D/g, "")
        ? { phone: patch.phone.replace(/\D/g, "") }
        : {}),
      ...(typeof patch.email === "string" && patch.email.trim()
        ? { email: patch.email.trim() }
        : {}),
      ...(typeof patch.grade === "string" && patch.grade.trim()
        ? { grade: patch.grade.trim() }
        : {}),
      ...(typeof patch.school === "string" && patch.school.trim()
        ? { school: patch.school.trim() }
        : {}),
      ...(typeof patch.opt_in === "boolean" ? { opt_in: patch.opt_in } : {}),
    };
    setOptimistic(optimisticNext);
    setEditing(false);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: scope.source,
          id: scope.id,
          ...patch,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      const data = await res.json().catch(() => null);
      if (data?.warning) toast.warning(data.warning);
      else toast.success("Lead details saved.");
      onChanged?.();
    } catch (err) {
      console.error("[LeadDetailsEditor.save]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
      // Roll the display back and reopen the editor with the draft
      // intact, so a failed save is obviously unsaved and retryable
      // rather than silently showing values that never persisted.
      setOptimistic(null);
      setEditing(true);
    } finally {
      setSaving(false);
    }
  }

  // Short facts pair up in two columns; phone and email get their own
  // full-width rows underneath. An email in a half-width cell was
  // truncating to the point of being unreadable, and both want room
  // for their call/mail/copy actions.
  const gridFields: Array<{
    key: keyof typeof draft;
    label: string;
    readValue: string;
    hidden?: boolean;
  }> = [
    { key: "student_name", label: "Student", readValue: shown.student_name },
    {
      key: "parent_name",
      label: "Parent",
      readValue: shown.parent_name ?? "",
      hidden: shown.parent_name === null,
    },
    { key: "grade", label: "Grade", readValue: shown.grade },
    { key: "school", label: "School", readValue: shown.school },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Lead details
          {/* The editor has already closed on the new values by the
              time this shows — it just marks the write in flight. */}
          {saving && !editing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : null}
        </p>
        {editing ? (
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 bg-white"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : null}
              Save
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {headerActions}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 bg-white"
              onClick={enterEdit}
            >
              <Pencil className="size-3 mr-1.5" />
              Edit
            </Button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {gridFields
          .filter((f) => !f.hidden)
          .map((f) =>
            editing ? (
              <div key={f.key}>
                <p className="mb-1 text-[11px] text-muted-foreground">
                  {f.label}
                </p>
                <Input
                  value={draft[f.key]}
                  disabled={saving}
                  className="h-8 border-input bg-white text-sm"
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [f.key]: e.target.value }))
                  }
                />
              </div>
            ) : (
              <div key={f.key} className="min-w-0">
                <p className="text-[11px] text-muted-foreground">{f.label}</p>
                <p
                  className="truncate text-sm text-foreground"
                  title={f.readValue || undefined}
                >
                  {f.readValue || "—"}
                </p>
              </div>
            )
          )}
      </div>

      {/* Phone + email get full-width rows of their own: an email in a
          half-width cell truncated past readability, and both carry
          actions (call / mail / copy). */}
      <div className="space-y-2.5">
        {editing ? (
          <>
            <div>
              <p className="mb-1 text-[11px] text-muted-foreground">Phone</p>
              <Input
                value={draft.phone}
                disabled={saving}
                className="h-8 border-input bg-white text-sm"
                onChange={(e) =>
                  setDraft((d) => ({ ...d, phone: e.target.value }))
                }
              />
            </div>
            <div>
              <p className="mb-1 text-[11px] text-muted-foreground">Email</p>
              <Input
                value={draft.email}
                disabled={saving}
                className="h-8 border-input bg-white text-sm"
                onChange={(e) =>
                  setDraft((d) => ({ ...d, email: e.target.value }))
                }
              />
            </div>
          </>
        ) : (
          <>
            <ContactRow
              label="Phone"
              value={formatUSPhone(shown.phone) || shown.phone}
              copyValue={shown.phone}
              href={shown.phone ? `tel:${shown.phone}` : null}
              actionLabel="Call"
              actionIcon={<Phone className="size-3.5" />}
            />
            <ContactRow
              label="Email"
              value={shown.email}
              copyValue={shown.email}
              href={shown.email ? `mailto:${shown.email}` : null}
              actionLabel="Email"
              actionIcon={<Mail className="size-3.5" />}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {/* Opt-in — read-only checkbox until Edit is clicked. Camp
            leads stay locked even then (no consent column; sign-up is
            the implied consent). */}
        <div>
          <p className="mb-1 text-[11px] text-muted-foreground">Opt-in</p>
          <label
            className={cn(
              "flex w-fit items-center gap-2 text-sm",
              editing && shown.opt_in_editable
                ? "cursor-pointer"
                : "cursor-default"
            )}
            title={
              !shown.opt_in_editable
                ? "Implied consent from camp sign-up"
                : editing
                  ? undefined
                  : "Click Edit to change"
            }
          >
            <Checkbox
              checked={editing ? draftOptIn : shown.opt_in}
              disabled={!editing || !shown.opt_in_editable || saving}
              aria-label="Messaging opt-in"
              className={cn(
                !editing && "disabled:opacity-100 disabled:cursor-default"
              )}
              onCheckedChange={(v) => setDraftOptIn(v === true)}
            />
            <span
              className={cn(
                (editing ? draftOptIn : shown.opt_in)
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {(editing ? draftOptIn : shown.opt_in)
                ? "Opted in"
                : "Opted out"}
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}

/**
 * Full triage sheet — the triage controls above a lead's comms log,
 * with the note composer docked to the bottom so it stays reachable
 * while the timeline scrolls. Used as-is by the pages that have no
 * detail sheet of their own (TASCO, All Leads); pages with an existing
 * detail sheet (Summer Camp, Liability Waiver Visits) embed
 * `LeadTriageControls` + `<InquiryNotes scope=… />` directly instead.
 */
export function LeadTriageSheet({
  open,
  onOpenChange,
  scope,
  title,
  subtitle,
  rating,
  isFollowedUp,
  lastReachOut,
  details,
  conversion,
  leadStatus,
  statusReason,
  schoolYearId,
  extraFields,
  extraContent,
  headerBadges,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: LeadNoteScope;
  title: string;
  subtitle?: string;
  rating: number;
  isFollowedUp: boolean;
  lastReachOut?: number | null;
  /** When provided, the sheet renders an editable Lead details block
   *  between the triage controls and the comms log. */
  details?: LeadEditableDetails;
  /** When provided, the sheet renders the Conversion section — the
   *  lead's link to the registration family it became, with manual
   *  link/unlink. */
  conversion?: LeadConversionInfo;
  /** When provided ("", "not_interested", …), the sheet renders the
   *  lifecycle control — mark not interested with a reason, or
   *  restore. Omit to hide (hosts without the status data). */
  leadStatus?: string;
  statusReason?: string;
  /** Academic year the family is asking about (FK id; 0 = unset).
   *  When provided the sheet renders the year picker beside the
   *  conversion combobox. */
  schoolYearId?: number;
  /** Read-only facts a particular source carries that the shared
   *  details block doesn't — e.g. an inquiry's "About the student".
   *  Rendered at the foot of the details block in the same style, so
   *  hosts keep their own data without diverging on layout. Blank
   *  values are dropped rather than rendered as an empty row. */
  extraFields?: Array<{ label: string; value: string }>;
  /** Source-specific markup for facts a label/value pair can't carry
   *  — the liability waiver's signature image, for one. Rendered at
   *  the foot of the details block, below `extraFields`. */
  extraContent?: React.ReactNode;
  /** Badges pinned beside the title. For facts that must be seen
   *  before anything else — a camp registration's "Carries EpiPen",
   *  say — which would lose their urgency buried in a field list. */
  headerBadges?: React.ReactNode;
  onChanged?: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="shrink-0 border-b px-4 py-3">
          <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
            {title}
            {headerBadges}
          </SheetTitle>
          {subtitle ? (
            <SheetDescription className="text-xs">
              {subtitle}
            </SheetDescription>
          ) : null}
        </SheetHeader>

        <div className="shrink-0 space-y-3 border-b px-4 py-4">
          {/* Rating on its own row, then the two triage ACTIONS
              (followed-up toggle + book a tour) side by side. */}
          <LeadTriageControls
            scope={scope}
            rating={rating}
            isFollowedUp={isFollowedUp}
            lastReachOut={lastReachOut}
            onChanged={onChanged}
            actions={
              <LeadTourButton
                scope={scope}
                parentName={details?.parent_name ?? ""}
                parentEmail={details?.email ?? ""}
                parentPhone={details?.phone ?? ""}
                studentName={details?.student_name ?? ""}
                onChanged={onChanged}
              />
            }
          />
        </div>

        {details || conversion ? (
          // `min-h-0 + overflow-y-auto` makes THIS section the sheet's
          // pressure valve: when the details outgrow the viewport (an
          // inquiry's "About the student" runs to paragraphs), this
          // block shrinks and scrolls internally instead of shoving
          // the activity log + composer off-screen with no scrollbar
          // anywhere. The header, triage controls, and composer stay
          // pinned (shrink-0); the timeline keeps its own floor below.
          <div className="min-h-0 space-y-3 overflow-y-auto border-b bg-muted/10 px-4 py-4">
            {/* Keyed by lead so switching rows resets any in-progress
                edit instead of carrying a stale draft across leads. */}
            {details ? (
              <LeadDetailsEditor
                key={`${scope.source}-${scope.id}`}
                scope={scope}
                details={details}
                headerActions={
                  leadStatus !== undefined ? (
                    <LeadStatusEditor
                      key={`status-${scope.source}-${scope.id}`}
                      scope={scope}
                      status={leadStatus}
                      reason={statusReason ?? ""}
                      onChanged={onChanged}
                    />
                  ) : null
                }
                onChanged={onChanged}
              />
            ) : null}
            {/* Which year they're asking about, then whether they
                actually converted — the two pipeline facts, read in
                that order. */}
            {schoolYearId !== undefined ? (
              <LeadYearPicker
                key={`year-${scope.source}-${scope.id}`}
                scope={scope}
                yearId={schoolYearId}
                onChanged={onChanged}
              />
            ) : null}
            {/* Conversion reads as the last field of the details
                block — one combobox under Opt-in. */}
            {conversion ? (
              <LeadConversionEditor
                key={`conversion-${scope.source}-${scope.id}`}
                scope={scope}
                conversion={conversion}
                onChanged={onChanged}
              />
            ) : null}
            {/* Source-specific read-only facts, in the same style as
                the fields above. `whitespace-pre-wrap` because these
                can be free text the family typed (an inquiry's
                "About the student" runs to paragraphs). */}
            {extraFields
              ?.filter((f) => f.value.trim())
              .map((f) => (
                <div key={f.label} className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">
                    {f.label}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                    {f.value}
                  </p>
                </div>
              ))}
            {extraContent}
          </div>
        ) : null}

        {/* Timeline — a chat stream pinned to the newest message
            (MessageScroller inside InquiryNotes); composer stays
            docked below it. `min-h-56` guarantees the log a usable
            window even when a long details block is competing for
            room — the details scroll for the remainder. */}
        <div className="flex min-h-56 flex-1 flex-col">
          <p className="shrink-0 border-b px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Activity log
          </p>
          <div className="min-h-0 flex-1">
            <InquiryNotes scope={scope} variant="timeline" />
          </div>
        </div>
        <div className="shrink-0 border-t bg-muted/20 px-4 py-3">
          <InquiryNoteComposer scope={scope} onNoteAdded={onChanged} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
