"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, Loader2, Search } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { adminFetcher } from "@/lib/admin-fetcher";
import {
  ADMIN_MAX_RSVP_SPOTS,
  formatSchoolTime,
  isSignUpEvent,
  isUnlimitedSpots,
  parseDate,
} from "@/lib/school-calendar";
import { cn } from "@/lib/utils";
import type {
  AdminEvent,
  AdminEventSignup,
} from "@/app/api/admin/events/route";
import type { EventFamiliesResponse } from "@/app/api/admin/events/families/route";

/** A typed quantity box → a count; blank reads as 0. NaN when it
 *  isn't a whole number, so validation can flag it. */
function parseQty(raw: string | undefined): number {
  const text = (raw ?? "").trim();
  if (!text) return 0;
  const n = Number(text);
  return Number.isInteger(n) ? n : Number.NaN;
}

/**
 * Add a family's RSVP to an event, or edit one: parent spots, what
 * they're bringing, and the "who's coming" note. Saves the family's
 * whole sign-up at once — an item set to 0 is released.
 *
 * Admin isn't held to the event's limits the way parents are. Going
 * past the spot cap or an item's count shows a warning, and Save still
 * works: staff are the ones who set those numbers.
 */
export function EventRsvpDialog({
  event,
  yearId,
  signup,
  onSaved,
  onClose,
}: {
  event: AdminEvent;
  yearId: number;
  /** The RSVP being edited; null adds a family. */
  signup: AdminEventSignup | null;
  /** The page's refetch. Save waits on it, so the spinner runs until
   *  the change is on screen. */
  onSaved: () => Promise<unknown>;
  onClose: () => void;
}) {
  const adding = signup === null;
  const [familyId, setFamilyId] = useState<number | null>(
    signup?.family_id ?? null
  );
  const [query, setQuery] = useState("");
  const [spots, setSpots] = useState(
    String(signup?.has_rsvp ? signup.spots : 1)
  );
  const [comment, setComment] = useState(signup?.comment ?? "");
  const [qty, setQty] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      (signup?.bringing ?? []).map((b) => [b.item_id, String(b.quantity)])
    )
  );
  const [saving, setSaving] = useState(false);

  // Only the add flow needs the family list, so only it fetches.
  const { data: familyData, error: familyError } =
    useSWR<EventFamiliesResponse>(
    adding && yearId ? `/api/admin/events/families?yearId=${yearId}` : null,
    adminFetcher
  );
  const signedUp = useMemo(
    () => new Set(event.signups.map((s) => s.family_id)),
    [event.signups]
  );
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (familyData?.families ?? [])
      .filter((f) => !signedUp.has(f.id))
      .filter(
        (f) =>
          !q ||
          [f.name, ...f.parents, f.students].join(" ").toLowerCase().includes(q)
      );
  }, [familyData, signedUp, query]);
  const familyName = adding
    ? (familyData?.families.find((f) => f.id === familyId)?.name ?? "")
    : signup.family_name;

  // What other families hold — the numbers this family is added to.
  const othersSpots = event.spots_taken - (signup?.spots ?? 0);
  const spotsNum = Number(spots);
  const spotsValid =
    Number.isInteger(spotsNum) &&
    spotsNum >= 1 &&
    spotsNum <= ADMIN_MAX_RSVP_SPOTS;
  const signUpsOpen = isSignUpEvent(event.parent_spots);
  const unlimited = isUnlimitedSpots(event.parent_spots);
  const cap = event.parent_spots ?? 0;
  const spotsOver =
    signUpsOpen && !unlimited && spotsValid
      ? Math.max(othersSpots + spotsNum - cap, 0)
      : 0;
  const heldBefore = useMemo(
    () =>
      new Map((signup?.bringing ?? []).map((b) => [b.item_id, b.quantity])),
    [signup]
  );
  const qtyValid = event.items.every((it) => {
    const n = parseQty(qty[it.id]);
    return Number.isInteger(n) && n >= 0 && n <= 500;
  });

  const canSave =
    !saving && spotsValid && qtyValid && (!adding || familyId !== null);

  async function save() {
    if (!canSave || familyId === null) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/events/${event.id}/rsvps/${familyId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spots: spotsNum,
            comment: comment.trim(),
            items: event.items
              .map((it) => ({ itemId: it.id, quantity: parseQty(qty[it.id]) }))
              .filter((c) => c.quantity > 0),
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      // A failed refetch isn't a failed save — the page shows its own
      // error state for that.
      await onSaved().catch(() => undefined);
      toast.success(
        adding ? `${familyName || "Family"} added.` : "RSVP updated."
      );
      onClose();
    } catch (err) {
      console.error("Failed to save RSVP:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't save the RSVP."
      );
      setSaving(false);
    }
  }

  const when = [
    event.date
      ? parseDate(event.date).toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      : "",
    event.start_time ? formatSchoolTime(event.start_time) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>
            {adding ? "Add RSVP" : `Edit RSVP · ${signup.family_name}`}
          </DialogTitle>
          <DialogDescription>
            {event.title}
            {when ? ` · ${when}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
          {!signUpsOpen ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Parent sign-up is off for this event, so the family won&rsquo;t
              see this RSVP on their volunteer page.
            </p>
          ) : null}

          {adding ? (
            <div className="space-y-2">
              <Label htmlFor="rsvp-family-search" className="text-xs">
                Family
              </Label>
              <div className="relative">
                <Search
                  className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="rsvp-family-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search family, parent or student…"
                  type="search"
                  autoComplete="off"
                  className="bg-white pl-8"
                  autoFocus
                />
              </div>
              {familyError ? (
                <p className="rounded-md border px-3 py-4 text-sm text-muted-foreground">
                  Couldn&rsquo;t load families:{" "}
                  {familyError instanceof Error
                    ? familyError.message
                    : "unknown error"}
                </p>
              ) : !familyData ? (
                // No list yet means loading — never "everyone's signed
                // up", which an empty list would otherwise claim.
                <div className="flex justify-center rounded-md border py-6">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : candidates.length === 0 ? (
                <p className="rounded-md border px-3 py-4 text-center text-sm text-muted-foreground">
                  {query.trim()
                    ? "No enrolled family matches."
                    : "Every enrolled family is already signed up."}
                </p>
              ) : (
                <ul
                  role="listbox"
                  aria-label="Families"
                  className="max-h-56 space-y-0.5 overflow-y-auto overscroll-contain rounded-md border p-1"
                >
                  {candidates.map((f) => {
                    const on = familyId === f.id;
                    const detail = [f.parents.join(", "), f.students]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <li key={f.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={on}
                          onClick={() => setFamilyId(f.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors",
                            on ? "bg-muted" : "hover:bg-muted/50"
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center rounded-full border",
                              on
                                ? "border-foreground bg-foreground text-background"
                                : "border-border bg-white"
                            )}
                          >
                            {on ? <Check className="size-3" /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {f.name}
                            </span>
                            {detail ? (
                              <span className="block truncate text-xs text-muted-foreground">
                                {detail}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="rsvp-spots" className="text-xs">
              Parent spots
            </Label>
            <div className="flex items-center gap-3">
              <Input
                id="rsvp-spots"
                type="number"
                min="1"
                max={ADMIN_MAX_RSVP_SPOTS}
                step="1"
                value={spots}
                onChange={(e) => setSpots(e.target.value)}
                aria-invalid={!spotsValid || undefined}
                className="w-20 shrink-0 bg-white text-center tabular-nums"
              />
              <span className="text-xs text-muted-foreground">
                {signUpsOpen && !unlimited
                  ? `Other families hold ${othersSpots} of ${cap}`
                  : `Other families hold ${othersSpots}${unlimited ? " · no limit" : ""}`}
              </span>
            </div>
            {!spotsValid ? (
              <p className="text-xs text-destructive">
                Enter a whole number from 1 to {ADMIN_MAX_RSVP_SPOTS}.
              </p>
            ) : spotsOver > 0 ? (
              <p className="text-xs text-amber-700">
                Puts the event {spotsOver} over its {cap}-spot limit. You can
                still save.
              </p>
            ) : null}
          </div>

          {event.items.length > 0 ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Bringing</Label>
              <ul className="divide-y rounded-md border">
                {event.items.map((it) => {
                  const others = it.claimed - (heldBefore.get(it.id) ?? 0);
                  const n = parseQty(qty[it.id]);
                  const valid = Number.isInteger(n) && n >= 0 && n <= 500;
                  const over = valid
                    ? Math.max(others + n - it.quantity, 0)
                    : 0;
                  return (
                    <li key={it.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{it.label}</p>
                        <p
                          className={cn(
                            "text-[11px]",
                            !valid
                              ? "text-destructive"
                              : over > 0
                                ? "text-amber-700"
                                : "text-muted-foreground"
                          )}
                        >
                          {!valid
                            ? "Enter a whole number, 0 or more."
                            : over > 0
                              ? `${others + n} of ${it.quantity} with this family — ${over} over`
                              : `Other families have ${others} of ${it.quantity}`}
                        </p>
                      </div>
                      <Input
                        type="number"
                        min="0"
                        max="500"
                        step="1"
                        value={qty[it.id] ?? ""}
                        placeholder="0"
                        onChange={(e) =>
                          setQty((prev) => ({
                            ...prev,
                            [it.id]: e.target.value,
                          }))
                        }
                        aria-label={`How many: ${it.label}`}
                        aria-invalid={!valid || undefined}
                        className="w-16 shrink-0 bg-white text-center tabular-nums"
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="rsvp-comment" className="text-xs">
              Who&rsquo;s coming
            </Label>
            <Textarea
              id="rsvp-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Names of the adults attending, or anything to note."
            />
          </div>
        </div>

        <DialogFooter className="border-t px-5 py-3">
          <Button
            variant="outline"
            size="sm"
            className="bg-white"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button size="sm" disabled={!canSave} onClick={() => void save()}>
            {saving ? (
              <>
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                Saving
              </>
            ) : adding ? (
              "Add RSVP"
            ) : (
              "Save RSVP"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
