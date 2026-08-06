"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { EVENT_COLORS, eventColor, parseDate } from "@/lib/school-calendar";
import type {
  XanoSchoolCalendarDay,
  XanoSchoolCalendarEvent,
} from "@/lib/xano";

/**
 * Shared school-calendar event machinery — the create/edit dialog plus
 * the field widgets (segmented HH:MM + AM/PM time picker after
 * time.openstatus.dev, etiquette color picker, Places-backed location
 * input) and their helpers. Used by the calendar page and the
 * Volunteer Hours page so both surfaces write events identically.
 */

// Palette + date helpers moved to lib/school-calendar so the parent
// calendar page can share them without pulling this dialog into its
// bundle. Re-exported here so existing admin imports keep working.
export { EVENT_COLORS, eventColor, parseDate };

/** ms → "HH:MM" for a time input ("" when unset). */
export function msToTimeInput(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

/** Day date + "HH:MM" → local unix-ms (0 when the time is blank). */
export function timeInputToMs(dateIso: string, hhmm: string): number {
  if (!hhmm) return 0;
  const [hh, mm] = hhmm.split(":").map(Number);
  const d = parseDate(dateIso);
  d.setHours(hh ?? 0, mm ?? 0, 0, 0);
  return d.getTime();
}

/* ── Segmented time picker (after time.openstatus.dev) ────────────── */

type TimePeriod = "AM" | "PM";
type TimeSegmentKind = "hour12" | "minute";

/** "HH:MM" (24h) → parts, null for "" / malformed. */
function parseHHMM(v: string): { h24: number; m: number } | null {
  const m = v.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const h24 = Number(m[1]);
  const min = Number(m[2]);
  if (h24 > 23 || min > 59) return null;
  return { h24, m: min };
}

function convert12To24(h12: number, period: TimePeriod): number {
  if (period === "PM") return h12 === 12 ? 12 : h12 + 12;
  return h12 === 12 ? 0 : h12;
}

/** Clamp a typed two-digit segment (no wrap — OpenStatus behavior). */
function clampSegment(kind: TimeSegmentKind, raw: string): string {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return kind === "hour12" ? "01" : "00";
  const min = kind === "hour12" ? 1 : 0;
  const max = kind === "hour12" ? 12 : 59;
  return String(Math.min(max, Math.max(min, n))).padStart(2, "0");
}

/** Arrow-key stepping wraps (12 → 1, 59 → 0). */
function stepSegment(
  kind: TimeSegmentKind,
  cur: number,
  step: number
): string {
  const min = kind === "hour12" ? 1 : 0;
  const max = kind === "hour12" ? 12 : 59;
  let v = cur + step;
  if (v > max) v = min;
  if (v < min) v = max;
  return String(v).padStart(2, "0");
}

/**
 * One two-digit segment of the time picker. Keyboard-driven like the
 * OpenStatus picker: digits type through (first digit fills "0X" and
 * arms a 2s window, a second digit completes "XY" and hops to the
 * next segment), ↑/↓ step with wrap, ←/→ move between segments. The
 * caret is hidden — the whole box acts as one value.
 */
function TimeSegmentInput({
  ref,
  kind,
  value,
  ariaLabel,
  onCommit,
  onLeftFocus,
  onRightFocus,
}: {
  ref?: React.Ref<HTMLInputElement>;
  kind: TimeSegmentKind;
  /** Padded 2-digit display value, "" when no time is set. */
  value: string;
  ariaLabel: string;
  onCommit: (padded: string) => void;
  onLeftFocus?: () => void;
  onRightFocus?: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const [prevKey, setPrevKey] = useState("0");
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2000);
    return () => clearTimeout(t);
  }, [armed]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Tab") return;
    e.preventDefault();
    if (e.key === "ArrowRight") onRightFocus?.();
    if (e.key === "ArrowLeft") onLeftFocus?.();
    if (e.key === "Backspace" || e.key === "Delete") {
      // Reset the segment to its floor so retyping starts clean.
      onCommit(kind === "hour12" ? "12" : "00");
      setArmed(false);
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const step = e.key === "ArrowUp" ? 1 : -1;
      const cur = value
        ? parseInt(value, 10)
        : kind === "hour12"
          ? 12
          : 0;
      onCommit(stepSegment(kind, cur, step));
      if (armed) setArmed(false);
    }
    if (e.key >= "0" && e.key <= "9") {
      const digit = e.key;
      if (!armed) {
        // First digit — restricted by what a valid hour/minute can
        // still become: a digit that can't be a tens digit (hours
        // 2–9, minutes 6–9) completes the segment immediately and
        // hops to the next one; 0/1 (hours) and 0–5 (minutes) wait
        // 2s for a second digit.
        const tensPossible =
          kind === "hour12"
            ? digit === "0" || digit === "1"
            : digit <= "5";
        onCommit(clampSegment(kind, "0" + digit));
        if (kind === "hour12") setPrevKey(digit);
        if (tensPossible) setArmed(true);
        else onRightFocus?.();
      } else {
        // Second digit inside the window. After a leading "0" the
        // hour reads 0X ("0" then "9" → 09, never 19-clamped-to-12).
        const next =
          kind === "hour12" && prevKey === "0"
            ? "0" + digit
            : value.slice(1, 2) + digit;
        onCommit(clampSegment(kind, next));
        setArmed(false);
        onRightFocus?.();
      }
    }
  }

  return (
    <Input
      ref={ref}
      type="tel"
      inputMode="numeric"
      aria-label={ariaLabel}
      value={value || "--"}
      onChange={(e) => e.preventDefault()}
      onKeyDown={handleKeyDown}
      // px-0 + shrink-0 — the Input default px-3 inside a 44px box
      // left ~4px for text once flex squeezed it, which rendered the
      // typed digits invisible ("inputs not registering").
      className={cn(
        "w-[44px] shrink-0 px-0 bg-white text-center font-mono tabular-nums caret-transparent focus:bg-accent focus:text-accent-foreground",
        !value && "text-muted-foreground"
      )}
    />
  );
}

/**
 * Segmented HH : MM + AM/PM time picker, after time.openstatus.dev
 * (no seconds). Type digits, use ↑/↓ to step, ←/→ to move between
 * segments; the X clears back to "no time". Value stays the same
 * "HH:MM" 24-hour string ("" = unset) the event forms already use.
 */
export function TimeSelect({
  value,
  onChange,
  ariaLabel,
  clearable = true,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  /** Show the trailing clear (✕) button. True for calendar events,
   *  where "no time" means an all-day event; pass false where a time
   *  is required (a tour must happen at some hour) — otherwise the
   *  extra control just overflows a tight two-column layout. */
  clearable?: boolean;
}) {
  const hourRef = useRef<HTMLInputElement>(null);
  const minuteRef = useRef<HTMLInputElement>(null);
  const periodRef = useRef<HTMLButtonElement>(null);

  const parts = parseHHMM(value);
  const period: TimePeriod = parts && parts.h24 >= 12 ? "PM" : "AM";
  const hourDisplay = parts
    ? String(parts.h24 % 12 === 0 ? 12 : parts.h24 % 12).padStart(2, "0")
    : "";
  const minuteDisplay = parts ? String(parts.m).padStart(2, "0") : "";
  // Editing a segment with no time set starts from 12:00 AM.
  const base = parts ?? { h24: 0, m: 0 };

  function commit(h24: number, m: number) {
    onChange(
      `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`
    );
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label={ariaLabel}>
      <TimeSegmentInput
        ref={hourRef}
        kind="hour12"
        value={hourDisplay}
        ariaLabel={`${ariaLabel} — hours`}
        onCommit={(padded) =>
          commit(
            convert12To24(parseInt(padded, 10), parts ? period : "AM"),
            base.m
          )
        }
        onRightFocus={() => minuteRef.current?.focus()}
      />
      <span className="shrink-0 text-sm text-muted-foreground">:</span>
      <TimeSegmentInput
        ref={minuteRef}
        kind="minute"
        value={minuteDisplay}
        ariaLabel={`${ariaLabel} — minutes`}
        onCommit={(padded) => commit(base.h24, parseInt(padded, 10))}
        onLeftFocus={() => hourRef.current?.focus()}
        onRightFocus={() => periodRef.current?.focus()}
      />
      <Select
        value={parts ? period : ""}
        onValueChange={(p) => {
          const h12 = base.h24 % 12 === 0 ? 12 : base.h24 % 12;
          commit(convert12To24(h12, p as TimePeriod), base.m);
        }}
      >
        <SelectTrigger
          ref={periodRef}
          className="w-[64px] shrink-0 bg-white"
          aria-label={`${ariaLabel} — AM or PM`}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") minuteRef.current?.focus();
          }}
        >
          <SelectValue placeholder="--" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AM">AM</SelectItem>
          <SelectItem value="PM">PM</SelectItem>
        </SelectContent>
      </Select>
      {clearable && value ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="size-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => onChange("")}
          aria-label={`Clear ${ariaLabel.toLowerCase()}`}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Etiquette-style color dots, one per event category. Clicking the
 * selected dot again clears back to the neutral default.
 */
export function EventColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const selected = eventColor(value);
  const generalOn = value.trim() === "";
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Event type</Label>
      <div className="flex items-center gap-2">
        {/* General is a real, selectable choice — stored as "" */}
        <button
          type="button"
          title="General"
          aria-label="General"
          aria-pressed={generalOn}
          onClick={() => onChange("")}
          className={cn(
            "flex size-8 items-center justify-center rounded-full bg-slate-300 transition-all",
            generalOn
              ? "ring-2 ring-foreground ring-offset-2"
              : "opacity-70 hover:opacity-100"
          )}
        >
          {generalOn ? (
            <span className="size-2 rounded-full bg-black/80" />
          ) : null}
        </button>
        {EVENT_COLORS.map((c) => {
          const on = value.trim() === c.value;
          return (
            <button
              key={c.value}
              type="button"
              title={c.label}
              aria-label={c.label}
              aria-pressed={on}
              onClick={() => onChange(on ? "" : c.value)}
              className={cn(
                "flex size-8 items-center justify-center rounded-full transition-all",
                c.dot,
                on
                  ? "ring-2 ring-foreground ring-offset-2"
                  : "opacity-70 hover:opacity-100"
              )}
            >
              {on ? (
                <span className="size-2 rounded-full bg-black/80" />
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {selected ? selected.label : "General"}
      </p>
    </div>
  );
}

/** One Places suggestion from /api/admin/places. */
export interface PlaceSuggestion {
  main: string;
  secondary: string;
  full: string;
}

/**
 * Location field with Google Places autocomplete. Still a free-text
 * input (events store location as plain text) — typing 3+ characters
 * fetches address/place suggestions through the server-side proxy;
 * picking one fills the input with the full formatted address. When
 * the API key isn't configured the dropdown never appears and this
 * behaves exactly like a plain input.
 */
export function LocationInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  // Server said "no key configured" — stop asking for this mount.
  const disabledRef = useRef(false);
  // Google per-session billing token: one UUID per typing session,
  // reset after a pick.
  const sessionRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  function queryPlaces(q: string) {
    if (disabledRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      setLoading(true);
      try {
        if (!sessionRef.current) {
          sessionRef.current =
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : String(Math.random()).slice(2);
        }
        const res = await fetch(
          `/api/admin/places?q=${encodeURIComponent(q)}&session=${sessionRef.current}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (seq !== seqRef.current) return; // a newer keystroke won
        if (data?.configured === false) {
          disabledRef.current = true;
          setOpen(false);
          return;
        }
        const list: PlaceSuggestion[] = data?.suggestions ?? [];
        setSuggestions(list);
        setOpen(list.length > 0);
      } catch {
        // Best-effort — the field keeps working as plain text.
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, 300);
  }

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          queryPlaces(e.target.value);
        }}
        onFocus={() => {
          if (suggestions.length > 0 && value.trim().length >= 3) {
            setOpen(true);
          }
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {loading ? (
        <Loader2 className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      ) : null}
      {open && suggestions.length > 0 ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-white shadow-md">
          <ul className="max-h-56 overflow-y-auto py-1">
            {suggestions.map((s) => (
              <li key={s.full}>
                {/* onMouseDown (not onClick) so the pick lands before
                    the input's blur closes the dropdown. */}
                <button
                  type="button"
                  className="w-full px-3 py-1.5 text-left transition-colors hover:bg-muted/60"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(s.full);
                    setSuggestions([]);
                    setOpen(false);
                    sessionRef.current = null;
                  }}
                >
                  <span className="block truncate text-sm font-medium">
                    {s.main}
                  </span>
                  {s.secondary ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.secondary}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          {/* Required attribution for Places data shown without a map. */}
          <p className="border-t px-3 py-1 text-right text-[10px] text-muted-foreground">
            Powered by Google
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Create/edit dialog for one school-calendar event. Create mode picks
 * a date (resolved to its `school_calendar` day row); edit mode locks
 * the date — the events API deliberately doesn't allow moving an
 * event between days (volunteer-hour entries FK the event id, so a
 * move-by-recreate would strand them).
 */
export function EventUpsertDialog({
  days,
  existing,
  defaultDate,
  defaultVolunteer,
  onDone,
}: {
  /** The year's day rows, date-ascending (for the date clamp). */
  days: XanoSchoolCalendarDay[];
  /** Null = creating. Edit needs the event plus its day's date. */
  existing: { event: XanoSchoolCalendarEvent; date: string } | null;
  /** Create-mode initial date (defaults to the year's first day). */
  defaultDate?: string;
  /** Create-mode initial state for the volunteer-hours switch. */
  defaultVolunteer?: boolean;
  onDone: (saved: boolean) => void;
}) {
  const ev = existing?.event ?? null;
  const [title, setTitle] = useState(ev?.title ?? "");
  const [date, setDate] = useState(
    existing?.date ?? defaultDate ?? days[0]?.date ?? ""
  );
  const [description, setDescription] = useState(ev?.description ?? "");
  const [location, setLocation] = useState(ev?.location ?? "");
  const [allDay, setAllDay] = useState(
    ev ? !ev.start_time && !ev.end_time : false
  );
  const [start, setStart] = useState(msToTimeInput(ev?.start_time));
  const [end, setEnd] = useState(msToTimeInput(ev?.end_time));
  const [color, setColor] = useState((ev?.color ?? "").trim());
  const [mandatory, setMandatory] = useState(ev?.mandatory === true);
  const [volunteer, setVolunteer] = useState(
    ev ? ev.parent_volunteer_hours === true : defaultVolunteer === true
  );
  const [hours, setHours] = useState(
    ev?.volunteer_hour_total ? String(ev.volunteer_hour_total) : ""
  );
  const [spots, setSpots] = useState(
    ev?.parent_spots ? String(ev.parent_spots) : ""
  );
  const [needs, setNeeds] = useState((ev?.needs ?? "").trim());
  const [saving, setSaving] = useState(false);

  const dayByDate = useMemo(
    () => new Map(days.map((d) => [d.date, d])),
    [days]
  );
  const minDate = days[0]?.date;
  const maxDate = days[days.length - 1]?.date;
  const day = date ? (dayByDate.get(date) ?? null) : null;

  async function save() {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    if (!existing && !day) return;
    setSaving(true);
    try {
      const timeDate = existing?.date ?? date;
      const payload = {
        title: trimmed,
        location: location.trim(),
        description: description.trim(),
        start_time: allDay ? 0 : timeInputToMs(timeDate, start),
        end_time: allDay ? 0 : timeInputToMs(timeDate, end),
        color,
        mandatory,
        parent_volunteer_hours: volunteer,
        volunteer_hour_total: volunteer ? Number(hours) || 0 : 0,
        parent_spots: Number(spots) || 0,
        needs: needs.trim(),
      };
      const res = await fetch(
        existing
          ? `/api/admin/school-calendar/events/${existing.event.id}`
          : "/api/admin/school-calendar/events",
        {
          method: existing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            existing
              ? payload
              : { ...payload, school_calendar_id: day!.id }
          ),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      toast.success(existing ? "Event updated." : "Event added.");
      onDone(true);
    } catch (err) {
      console.error("Failed to save event:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't save event."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !saving && !o && onDone(false)}>
      {/* lg (not md) so the side-by-side segmented time pickers fit;
          capped height with a scrolling body so the tall form never
          runs off shorter viewports. */}
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>
            {existing ? "Edit event" : "Create event"}
          </DialogTitle>
          <DialogDescription>
            {existing
              ? "Update this calendar event."
              : "Adds an event to a day on the school calendar."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Event name</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Family Night, field trip, early release…"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Event date</Label>
            <Input
              type="date"
              value={existing?.date ?? date}
              min={minDate}
              max={maxDate}
              disabled={Boolean(existing)}
              onChange={(e) => setDate(e.target.value)}
            />
            {existing ? (
              <p className="text-[11px] text-muted-foreground">
                Events can&rsquo;t move between days — delete and
                recreate to change the date.
              </p>
            ) : date && !day ? (
              <p className="text-xs text-red-600">
                That date isn&rsquo;t part of this school year&rsquo;s
                calendar.
              </p>
            ) : null}
          </div>
          {!allDay ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Start time</Label>
                <TimeSelect
                  value={start}
                  onChange={setStart}
                  ariaLabel="Start time"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">End time</Label>
                <TimeSelect
                  value={end}
                  onChange={setEnd}
                  ariaLabel="End time"
                />
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="ue-allday" className="text-sm font-normal">
              All day
            </Label>
            <Switch
              id="ue-allday"
              checked={allDay}
              onCheckedChange={setAllDay}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Location</Label>
            <LocationInput
              value={location}
              onChange={setLocation}
              placeholder="Campus, marina, address…"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Details families should know…"
            />
          </div>
          <EventColorPicker value={color} onChange={setColor} />
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="ue-mandatory" className="text-sm font-normal">
              Mandatory attendance
            </Label>
            <Switch
              id="ue-mandatory"
              checked={mandatory}
              onCheckedChange={setMandatory}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="ue-volunteer" className="text-sm font-normal">
              Counts toward parent volunteer hours
            </Label>
            <Switch
              id="ue-volunteer"
              checked={volunteer}
              onCheckedChange={setVolunteer}
            />
          </div>
          {volunteer ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Volunteer hours credited</Label>
              <Input
                type="number"
                min="0"
                step="0.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="2"
              />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label className="text-xs">Parent sign-up spots</Label>
            <Input
              type="number"
              min="0"
              step="1"
              value={spots}
              onChange={(e) => setSpots(e.target.value)}
              placeholder="0"
            />
            <p className="text-[11px] text-muted-foreground">
              How many parent spots families can reserve. Blank or 0 =
              no sign-up — the event won&rsquo;t offer an RSVP.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Event needs</Label>
            <Textarea
              value={needs}
              onChange={(e) => setNeeds(e.target.value)}
              rows={3}
              placeholder={"One need per line:\n4 chaperones\nWater jugs"}
            />
            <p className="text-[11px] text-muted-foreground">
              One per line — shown to families as a list of what the
              event needs.
            </p>
          </div>
        </div>
        <DialogFooter className="border-t px-5 py-3">
          <Button
            variant="outline"
            size="sm"
            className="bg-white"
            disabled={saving}
            onClick={() => onDone(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={saving || !title.trim() || (!existing && !day)}
          >
            {saving ? (
              <>
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                Saving
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
