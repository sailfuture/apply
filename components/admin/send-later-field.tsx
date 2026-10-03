"use client";

import { Clock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * "Send later" for a text composer: a checkbox and, once ticked, a
 * date-and-time picker. The value is the browser's local wall-clock
 * time as `datetime-local` gives it ("2026-09-30T09:00"); `sendAtMs`
 * turns it into an instant. Staff are in Florida, so local time is
 * school time.
 *
 * The picker holds its place while the box is unticked (hidden, not
 * removed), so ticking it never moves what's around it. Give the field
 * a row wide enough for both (about 22rem) or the picker wraps under
 * the checkbox.
 */
export function SendLaterField({
  enabled,
  onEnabledChange,
  value,
  onValueChange,
  disabled,
  id = "send-later",
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  value: string;
  onValueChange: (v: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  const ms = sendAtMs(value);
  const tooSoon = enabled && isTooSoon(ms);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <label
        htmlFor={id}
        className="flex cursor-pointer items-center gap-2 text-sm font-medium"
      >
        <Checkbox
          id={id}
          checked={enabled}
          disabled={disabled}
          onCheckedChange={(v) => onEnabledChange(v === true)}
        />
        <Clock className="size-3.5 text-muted-foreground" />
        Send later
      </label>
      <Label htmlFor={`${id}-at`} className="sr-only" aria-hidden={!enabled}>
        When to send
      </Label>
      <Input
        id={`${id}-at`}
        type="datetime-local"
        value={value}
        min={earliestPick()}
        disabled={disabled || !enabled}
        aria-hidden={!enabled}
        onChange={(e) => onValueChange(e.target.value)}
        className={cn("h-8 w-auto bg-white text-sm", !enabled && "invisible")}
      />
      {tooSoon ? (
        <span className="text-xs text-destructive">Pick a later time</span>
      ) : null}
    </div>
  );
}

// Clock reads live in helpers, not the component body (the purity lint
// bans Date.now() in render), the same way the tour markers do it.
function isTooSoon(ms: number | null): boolean {
  return ms !== null && ms < Date.now() + 60_000;
}

function earliestPick(): string {
  return toLocalInput(Date.now() + 5 * 60_000);
}

/** The instant a `datetime-local` value names, or null. */
export function sendAtMs(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** A `datetime-local` value for an instant, in the browser's zone. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Tue, Sep 30, 9:00 AM" in school time. */
export function sendAtLabel(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A sensible first pick when "Send later" is ticked: 9 AM tomorrow. */
export function defaultSendAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toLocalInput(d.getTime());
}
