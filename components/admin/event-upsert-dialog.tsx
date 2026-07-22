"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  XanoSchoolCalendarDay,
  XanoSchoolCalendarEvent,
} from "@/lib/xano";

/**
 * Shared school-calendar event machinery — the create/edit dialog plus
 * the field widgets (searchable time combobox, etiquette color picker,
 * Places-backed location input) and their helpers. Used by the
 * Settings calendar page and the Volunteer Hours page so both surfaces
 * write events identically.
 */

/** "YYYY-MM-DD" → local Date (avoids the UTC-midnight off-by-one that
 *  `new Date("YYYY-MM-DD")` gives in western timezones). */
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

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

/**
 * Event categories and their colors — the brand etiquette palette.
 * The slug is what `school_calendar_events.color` stores; empty (or
 * the " " clear-sentinel) renders the neutral gray chip.
 */
export const EVENT_COLORS = [
  {
    value: "sky",
    label: "Testing",
    dot: "bg-sky-400",
    chip: "bg-sky-100 text-sky-900",
  },
  {
    value: "emerald",
    label: "SailFuture Serves",
    dot: "bg-emerald-400",
    chip: "bg-emerald-100 text-emerald-900",
  },
  {
    value: "violet",
    label: "Student Events",
    dot: "bg-violet-400",
    chip: "bg-violet-100 text-violet-900",
  },
  {
    value: "amber",
    label: "Parent Events",
    dot: "bg-amber-400",
    chip: "bg-amber-100 text-amber-900",
  },
] as const;

export function eventColor(color: string | null | undefined) {
  const slug = (color ?? "").trim();
  return EVENT_COLORS.find((c) => c.value === slug) ?? null;
}

/** 15-minute options for the time dropdowns — "HH:MM" 24h values with
 *  12-hour labels, like the pickers in calendar apps. */
export const TIME_OPTIONS: Array<{ value: string; label: string }> = (() => {
  const out: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      out.push({
        value: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
        label: timeLabel12(h, m),
      });
    }
  }
  return out;
})();

export function timeLabel12(h: number, m: number): string {
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "HH:MM" → 12-hour label, for values off the 15-minute grid. */
export function labelForTimeValue(v: string): string {
  const found = TIME_OPTIONS.find((o) => o.value === v);
  if (found) return found.label;
  const [h, m] = v.split(":").map(Number);
  return timeLabel12(h ?? 0, m ?? 0);
}

/**
 * Loose time parsing for the combobox — accepts "8", "8:05", "815",
 * "8:05p", "8 pm", "14:30"… Bare hours with no AM/PM read as 24-hour
 * (8 → 8:00 AM, 14 → 2:00 PM). Returns null when it isn't a time.
 */
export function parseTimeInput(
  raw: string
): { value: string; label: string } | null {
  const s = raw.trim().toLowerCase().replace(/\./g, "");
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?\s*(a|am|p|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const mer = m[3];
  if (min > 59) return null;
  if (mer) {
    if (h < 1 || h > 12) return null;
    if ((mer === "p" || mer === "pm") && h !== 12) h += 12;
    if ((mer === "a" || mer === "am") && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  const value = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  return { value, label: timeLabel12(h, min) };
}

/**
 * Searchable time combobox — type to filter the 15-minute grid, or
 * type any exact time ("8:05", "8:05p", "14:30") and pick the parsed
 * "Use …" row it offers. "No time" clears.
 */
export function TimeSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Free-typed time that isn't one of the grid rows — offered as its
  // own "Use 8:05 AM" item (value = the raw query so cmdk's filter
  // always keeps it visible).
  const parsed = parseTimeInput(query);
  const offParsed =
    parsed && !TIME_OPTIONS.some((o) => o.value === parsed.value)
      ? parsed
      : null;

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className="w-full justify-between bg-white px-3 font-normal"
        >
          <span
            className={cn(
              "flex min-w-0 items-center gap-1.5",
              !value && "text-muted-foreground"
            )}
          >
            <Clock className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {value ? labelForTimeValue(value) : "No time"}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Type a time…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-56">
            <CommandEmpty>No matching time.</CommandEmpty>
            {offParsed ? (
              <CommandGroup>
                <CommandItem
                  value={query}
                  onSelect={() => pick(offParsed.value)}
                >
                  Use {offParsed.label}
                </CommandItem>
              </CommandGroup>
            ) : null}
            <CommandGroup>
              <CommandItem
                value="no time clear none"
                onSelect={() => pick("")}
              >
                No time
                {!value ? <Check className="ml-auto size-3.5" /> : null}
              </CommandItem>
              {TIME_OPTIONS.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  onSelect={() => pick(o.value)}
                >
                  {o.label}
                  {value === o.value ? (
                    <Check className="ml-auto size-3.5" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Event type</Label>
      <div className="flex items-center gap-2">
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
        {selected ? selected.label : "General (gray)"}
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Edit event" : "Create event"}
          </DialogTitle>
          <DialogDescription>
            {existing
              ? "Update this calendar event."
              : "Adds an event to a day on the school calendar."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Family Night, field trip, early release…"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Date</Label>
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
                <Label className="text-xs">Starts</Label>
                <TimeSelect
                  value={start}
                  onChange={setStart}
                  ariaLabel="Start time"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Ends</Label>
                <TimeSelect
                  value={end}
                  onChange={setEnd}
                  ariaLabel="End time"
                />
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="ue-allday" className="text-xs font-normal">
              All day
            </Label>
            <Switch
              id="ue-allday"
              size="sm"
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
            <Label htmlFor="ue-mandatory" className="text-xs font-normal">
              Mandatory attendance
            </Label>
            <Switch
              id="ue-mandatory"
              size="sm"
              checked={mandatory}
              onCheckedChange={setMandatory}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="ue-volunteer" className="text-xs font-normal">
              Counts toward parent volunteer hours
            </Label>
            <Switch
              id="ue-volunteer"
              size="sm"
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
        </div>
        <DialogFooter>
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
