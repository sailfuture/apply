"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Plus, X } from "lucide-react";
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
import { msToSchoolTimeInput, schoolTimeToMs } from "@/lib/school-calendar";
import {
  EVENT_TYPES,
  HOURS_TYPES,
  formatHours,
  hoursBetween,
  type EventType,
  type HoursType,
  type RecruitmentEvent,
} from "@/lib/recruitment-events";
import {
  LocationInput,
  TimeSelect,
} from "@/components/admin/event-upsert-dialog";

/** Radix Select can't carry an empty-string item value. */
const NO_TYPE = "none";

/**
 * New / Edit recruitment event. Times are the school's clock; the
 * hours field fills itself from the start and end times until the
 * admin types their own number (setup and travel count too). Files
 * are added from the event's sheet, not here.
 */
export function RecruitmentEventUpsertDialog({
  existing,
  staffOptions,
  defaultDate,
  onDone,
}: {
  /** null = create. */
  existing: RecruitmentEvent | null;
  /** Names the staff picker offers; typed names are allowed too. */
  staffOptions: string[];
  /** Prefilled date for a new event ("YYYY-MM-DD"). */
  defaultDate?: string;
  /** Resolves once the page has refetched, so the spinner runs until
   *  the saved row is on screen. */
  onDone: (saved: boolean) => void | Promise<void>;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [date, setDate] = useState(existing?.event_date ?? defaultDate ?? "");
  const [startHHMM, setStartHHMM] = useState(
    msToSchoolTimeInput(existing?.start_time)
  );
  const [endHHMM, setEndHHMM] = useState(msToSchoolTimeInput(existing?.end_time));
  const [hours, setHours] = useState(
    existing && existing.hours > 0 ? formatHours(existing.hours) : ""
  );
  // Once the admin edits hours by hand the times stop overwriting it.
  const [hoursTouched, setHoursTouched] = useState(
    !!existing && existing.hours > 0
  );
  const [hoursType, setHoursType] = useState<HoursType | "">(
    existing?.hours_type ?? ""
  );
  const [eventType, setEventType] = useState<EventType | "">(
    existing?.event_type ?? ""
  );
  const [paid, setPaid] = useState(existing?.paid ?? false);
  const [staff, setStaff] = useState<string[]>(existing?.staff ?? []);
  const [location, setLocation] = useState(existing?.location ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [eventLink, setEventLink] = useState(existing?.event_link ?? "");
  const [applicationLink, setApplicationLink] = useState(
    existing?.application_link ?? ""
  );
  const [saving, setSaving] = useState(false);

  const startMs = date && startHHMM ? schoolTimeToMs(date, startHHMM) : 0;
  const endMs = date && endHHMM ? schoolTimeToMs(date, endHHMM) : 0;
  const timesInverted = startMs > 0 && endMs > 0 && endMs <= startMs;

  function applyTimes(nextStart: string, nextEnd: string) {
    setStartHHMM(nextStart);
    setEndHHMM(nextEnd);
    if (hoursTouched || !date) return;
    const h = hoursBetween(
      nextStart ? schoolTimeToMs(date, nextStart) : 0,
      nextEnd ? schoolTimeToMs(date, nextEnd) : 0
    );
    setHours(h > 0 ? formatHours(h) : "");
  }

  const hoursNumber = hours.trim() === "" ? 0 : Number(hours);
  const hoursValid = Number.isFinite(hoursNumber) && hoursNumber >= 0;
  const valid =
    name.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !timesInverted &&
    hoursValid;

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        event_date: date,
        start_time: startMs,
        end_time: endMs,
        hours: hoursValid ? hoursNumber : 0,
        hours_type: hoursType,
        event_type: eventType,
        paid,
        staff,
        location: location.trim(),
        description: description.trim(),
        event_link: eventLink.trim(),
        application_link: applicationLink.trim(),
      };
      const res = await fetch(
        existing
          ? `/api/admin/recruitment-events/${existing.id}`
          : "/api/admin/recruitment-events",
        {
          method: existing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      await onDone(true);
      toast.success(existing ? "Event updated." : "Event added.");
    } catch (err) {
      console.error("Failed to save recruitment event:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && void onDone(false)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Edit event" : "New recruitment event"}
          </DialogTitle>
          <DialogDescription>
            An outreach event staff attend — a festival, tabling shift,
            church visit or school fair. Times are the school&rsquo;s
            clock.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rec-name">
              Event name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="rec-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="St. Pete Science Festival"
              autoFocus={!existing}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rec-date">
                Date <span className="text-red-500">*</span>
              </Label>
              <Input
                id="rec-date"
                type="date"
                value={date}
                onChange={(e) => {
                  const next = e.target.value;
                  setDate(next);
                  if (!hoursTouched && next) {
                    const h = hoursBetween(
                      startHHMM ? schoolTimeToMs(next, startHHMM) : 0,
                      endHHMM ? schoolTimeToMs(next, endHHMM) : 0
                    );
                    setHours(h > 0 ? formatHours(h) : "");
                  }
                }}
                className="bg-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-hours">Hours</Label>
              <Input
                id="rec-hours"
                type="number"
                inputMode="decimal"
                step="0.25"
                min="0"
                value={hours}
                onChange={(e) => {
                  setHours(e.target.value);
                  setHoursTouched(true);
                }}
                placeholder={startHHMM && endHHMM ? "" : "2.5"}
                aria-invalid={!hoursValid}
                className="bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start</Label>
              <TimeSelect
                value={startHHMM}
                onChange={(v) => applyTimes(v, endHHMM)}
                ariaLabel="Start time"
              />
            </div>
            <div className="space-y-1.5">
              <Label>End</Label>
              <TimeSelect
                value={endHHMM}
                onChange={(v) => applyTimes(startHHMM, v)}
                ariaLabel="End time"
              />
            </div>
          </div>
          {timesInverted ? (
            <p className="-mt-2 text-xs text-red-600">
              The end time must be after the start time.
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label>When</Label>
            {/* Segmented: one of two answers, not an on/off toggle. */}
            <div
              role="group"
              aria-label="Working hours or outside"
              className="inline-flex h-9 items-center rounded-lg bg-muted p-[3px]"
            >
              {HOURS_TYPES.map((t) => {
                const on = hoursType === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setHoursType(on ? "" : t.value)}
                    className={cn(
                      "inline-flex h-full items-center rounded-md px-3 text-sm font-medium transition-colors",
                      on
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={eventType || NO_TYPE}
                onValueChange={(v) =>
                  setEventType(v === NO_TYPE ? "" : (v as EventType))
                }
              >
                <SelectTrigger className="w-full bg-white">
                  <SelectValue placeholder="Set type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TYPE}>
                    <span className="text-muted-foreground">Not set</span>
                  </SelectItem>
                  {EVENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-paid">Paid</Label>
              <div className="flex h-9 items-center gap-2">
                <Switch id="rec-paid" checked={paid} onCheckedChange={setPaid} />
                <span className="text-sm text-muted-foreground">
                  {paid ? "Staff were paid for this" : "Not paid"}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Staff</Label>
            <StaffPicker
              value={staff}
              options={staffOptions}
              onChange={setStaff}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Location</Label>
            <LocationInput
              value={location}
              onChange={setLocation}
              placeholder="Largo Central Park"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rec-description">Description</Label>
            <Textarea
              id="rec-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Hands-on exhibit and tabling"
              rows={3}
              className="bg-white"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rec-event-link">Event link</Label>
              <Input
                id="rec-event-link"
                value={eventLink}
                onChange={(e) => setEventLink(e.target.value)}
                placeholder="eventbrite.com/e/…"
                type="url"
                inputMode="url"
                className="bg-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-application-link">Application link</Label>
              <Input
                id="rec-application-link"
                value={applicationLink}
                onChange={(e) => setApplicationLink(e.target.value)}
                placeholder="Vendor / exhibitor application"
                type="url"
                inputMode="url"
                className="bg-white"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            className="bg-white"
            disabled={saving}
            onClick={() => void onDone(false)}
          >
            Cancel
          </Button>
          <Button disabled={!valid || saving} onClick={() => void save()}>
            {saving ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Saving
              </>
            ) : existing ? (
              "Save changes"
            ) : (
              "Add event"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Multi-select of staff names: chips for the chosen, a searchable
 * popover list for the rest, and an "Add" row for a name that isn't
 * in the list (the column is free text).
 */
function StaffPicker({
  value,
  options,
  onChange,
}: {
  value: string[];
  options: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedKeys = useMemo(
    () => new Set(value.map((v) => v.toLowerCase())),
    [value]
  );
  const available = useMemo(
    () => options.filter((o) => !selectedKeys.has(o.toLowerCase())),
    [options, selectedKeys]
  );
  const typed = query.trim().replace(/\s+/g, " ");
  const typedIsNew =
    typed.length > 0 &&
    !selectedKeys.has(typed.toLowerCase()) &&
    !options.some((o) => o.toLowerCase() === typed.toLowerCase());

  function add(name: string) {
    const n = name.trim().replace(/\s+/g, " ");
    if (!n || selectedKeys.has(n.toLowerCase())) return;
    onChange([...value, n]);
    setQuery("");
  }

  return (
    <div className="space-y-2">
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pl-2.5 pr-1 text-xs font-medium"
            >
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => onChange(value.filter((v) => v !== name))}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-white"
          >
            <Plus className="size-3.5" />
            {value.length === 0 ? "Add staff" : "Add another"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <Command>
            <CommandInput
              placeholder="Search or type a name…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList className="max-h-56">
              <CommandEmpty>
                {typed ? "No one by that name — add below." : "No names yet."}
              </CommandEmpty>
              <CommandGroup>
                {available.map((name) => (
                  <CommandItem
                    key={name}
                    value={name}
                    onSelect={() => add(name)}
                  >
                    {name}
                  </CommandItem>
                ))}
              </CommandGroup>
              {typedIsNew ? (
                <CommandGroup forceMount>
                  <CommandItem
                    value={`__add__ ${typed}`}
                    onSelect={() => add(typed)}
                    className="gap-2"
                  >
                    <Check className="size-3.5 text-muted-foreground" />
                    Add &ldquo;{typed}&rdquo;
                  </CommandItem>
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
