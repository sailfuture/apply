"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Bell, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  eventColor,
  formatSchoolTime,
  isSignUpEvent,
  isUnlimitedSpots,
  parseDate,
} from "@/lib/school-calendar";
import { cn } from "@/lib/utils";
import { EventRsvpDialog } from "@/components/admin/event-rsvp-dialog";
import type {
  AdminEvent,
  AdminEventItem,
  AdminEventSignup,
} from "@/app/api/admin/events/route";

/** "6:30 PM – 8:30 PM", or "All day" for an event stored without a
 *  start time. Always the school's clock. */
export function eventTimeLabel(e: {
  start_time: number | null;
  end_time: number | null;
}): string {
  if (!e.start_time) return "All day";
  const start = formatSchoolTime(e.start_time);
  return e.end_time ? `${start} – ${formatSchoolTime(e.end_time)}` : start;
}

/**
 * One event's details and sign-ups: when and where, then every RSVP
 * with what that family is bringing, then each need with the families
 * covering it. Admin can add, edit and remove RSVPs here (for a family
 * who called in, or cancelled); the event itself is edited through
 * `onEdit`.
 *
 * Takes the live SWR row (null = closed), so an edit re-renders it with
 * fresh data rather than a snapshot.
 */
export function EventDetailSheet({
  event,
  yearId,
  isPast,
  refreshing,
  onOpenChange,
  onEdit,
  onRemind,
  onChanged,
}: {
  event: AdminEvent | null;
  yearId: number;
  isPast: boolean;
  /** Dims the body while the page revalidates after an edit. */
  refreshing?: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (event: AdminEvent) => void;
  onRemind: (event: AdminEvent) => void;
  /** The page's refetch — RSVP saves wait on it before their spinners
   *  stop, so a change is on screen when they do. */
  onChanged: () => Promise<unknown>;
}) {
  return (
    <Sheet open={event !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // A step wider than the other admin sheets: the RSVP table carries
        // five columns, and "Bringing" wraps badly below this.
        className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl lg:max-w-4xl"
      >
        {event ? (
          <EventDetailBody
            // Keyed so an RSVP dialog left open can't carry over to a
            // different event.
            key={event.id}
            event={event}
            yearId={yearId}
            isPast={isPast}
            refreshing={refreshing}
            onEdit={onEdit}
            onRemind={onRemind}
            onChanged={onChanged}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function EventDetailBody({
  event,
  yearId,
  isPast,
  refreshing,
  onEdit,
  onRemind,
  onChanged,
  onClose,
}: {
  event: AdminEvent;
  yearId: number;
  isPast: boolean;
  refreshing?: boolean;
  onEdit: (event: AdminEvent) => void;
  onRemind: (event: AdminEvent) => void;
  onChanged: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [rsvpEdit, setRsvpEdit] = useState<AdminEventSignup | "new" | null>(
    null
  );
  const [removeTarget, setRemoveTarget] = useState<AdminEventSignup | null>(
    null
  );
  const [removing, setRemoving] = useState(false);

  async function removeSignup() {
    if (!removeTarget || removing) return;
    setRemoving(true);
    try {
      const res = await fetch(
        `/api/admin/events/${event.id}/rsvps/${removeTarget.family_id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Remove failed (${res.status})`);
      }
      // Hold the spinner until the row is gone from the table.
      await onChanged().catch(() => undefined);
      toast.success(`${removeTarget.family_name} removed.`);
      setRemoveTarget(null);
    } catch (err) {
      console.error("Failed to remove RSVP:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't remove the RSVP."
      );
    } finally {
      setRemoving(false);
    }
  }

  const color = eventColor(event.color);
  const signUpsOpen = isSignUpEvent(event.parent_spots);
  const longDate = event.date
    ? parseDate(event.date).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";
  const needed = event.items.reduce((s, i) => s + i.quantity, 0);
  // Over-claiming one item can't cover another, so cap each at its ask.
  const covered = event.items.reduce(
    (s, i) => s + Math.min(i.claimed, i.quantity),
    0
  );
  const parentsByFamily = new Map(
    event.signups.map((s) => [s.family_id, s.parents])
  );
  const description = (event.description ?? "").trim();
  const location = (event.location ?? "").trim();

  return (
    <>
      <SheetHeader className="border-b px-5 py-4 pr-12">
        <SheetTitle className="flex items-center gap-2 text-lg">
          <span
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              color ? color.dot : "bg-slate-300"
            )}
            aria-hidden
          />
          <span className="min-w-0">{event.title}</span>
        </SheetTitle>
        <SheetDescription>
          {longDate} · {eventTimeLabel(event)}
        </SheetDescription>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {color ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                color.chip
              )}
            >
              {color.label}
            </span>
          ) : null}
          {event.mandatory ? (
            <span className="rounded-full border border-red-200 bg-red-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-red-700">
              Mandatory
            </span>
          ) : null}
          {event.parent_volunteer_hours ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-emerald-700">
              {event.volunteer_hour_total || 0} vol hrs
            </span>
          ) : null}
          {isPast ? (
            <span className="rounded-full border bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Past
            </span>
          ) : null}
        </div>
      </SheetHeader>

      <div
        aria-busy={refreshing}
        className={cn(
          "min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5 transition-opacity",
          refreshing && "opacity-50 animate-pulse"
        )}
      >
        {/* At-a-glance numbers */}
        <div className="grid grid-cols-3 gap-3">
          <SummaryTile
            label="Families signed up"
            value={String(event.signups.length)}
            hint={signUpsOpen ? undefined : "Sign-ups off"}
          />
          <SummaryTile
            label="Parent spots"
            value={
              signUpsOpen && !isUnlimitedSpots(event.parent_spots)
                ? `${event.spots_taken} / ${event.parent_spots}`
                : String(event.spots_taken)
            }
            hint={
              isUnlimitedSpots(event.parent_spots) ? "No limit" : undefined
            }
          />
          <SummaryTile
            label="Needs claimed"
            value={needed > 0 ? `${covered} / ${needed}` : "—"}
            hint={needed === 0 ? "Nothing listed" : undefined}
            tone={needed > 0 && covered >= needed ? "done" : undefined}
          />
        </div>

        {/* Details */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Details
          </h3>
          <dl className="divide-y rounded-md border text-sm">
            <DetailRow label="Date">{longDate || "—"}</DetailRow>
            <DetailRow label="Time">{eventTimeLabel(event)}</DetailRow>
            <DetailRow label="Location">{location || "—"}</DetailRow>
            <DetailRow label="Description">
              {description ? (
                <span className="whitespace-pre-wrap">{description}</span>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Parent sign-up">
              {!signUpsOpen
                ? "Off — parents can’t RSVP"
                : isUnlimitedSpots(event.parent_spots)
                  ? "Open · no attendance limit"
                  : `Open · capped at ${event.parent_spots} spots`}
            </DetailRow>
            <DetailRow label="Volunteer credit">
              {event.parent_volunteer_hours
                ? `${event.volunteer_hour_total || 0} hours`
                : "None"}
            </DetailRow>
          </dl>
        </section>

        {/* RSVPs — one row per family */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              RSVPs ({event.signups.length})
            </h3>
            <div className="flex items-center gap-3">
              {event.signups.length > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {event.spots_taken} parent spot
                  {event.spots_taken === 1 ? "" : "s"} reserved
                </span>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className="h-7 bg-white px-2"
                onClick={() => setRsvpEdit("new")}
              >
                <Plus className="size-3.5" />
                Add RSVP
              </Button>
            </div>
          </div>
          {event.signups.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              {signUpsOpen
                ? "No families have signed up yet."
                : "Parent sign-up is off for this event. Open it under Edit event, or add a family here with Add RSVP."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table className="text-sm">
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-3">Family</TableHead>
                    <TableHead className="w-16 text-right">Spots</TableHead>
                    <TableHead>Bringing</TableHead>
                    <TableHead className="w-[24%]">Who&rsquo;s coming</TableHead>
                    <TableHead className="w-[72px] pr-3">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {event.signups.map((s) => (
                    <TableRow
                      key={s.family_id}
                      className="hover:bg-transparent [&>td]:align-top"
                    >
                      <TableCell className="pl-3 whitespace-normal">
                        <span className="block font-medium">
                          {s.family_name}
                        </span>
                        <ParentNames names={s.parents} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.has_rsvp ? (
                          s.spots
                        ) : (
                          <span
                            className="text-muted-foreground"
                            title="No RSVP on file — this family only claimed items"
                          >
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {s.bringing.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <ul className="space-y-1">
                            {s.bringing.map((b) => (
                              <li key={b.item_id} className="flex gap-1.5">
                                <span className="min-w-0">{b.label}</span>
                                <QtyPill quantity={b.quantity} />
                              </li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-pre-wrap text-muted-foreground">
                        {s.comment || "—"}
                      </TableCell>
                      <TableCell className="pr-3">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-7 p-0"
                            onClick={() => setRsvpEdit(s)}
                            aria-label={`Edit ${s.family_name} RSVP`}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-7 p-0 text-red-600 hover:text-red-700"
                            onClick={() => setRemoveTarget(s)}
                            aria-label={`Remove ${s.family_name} RSVP`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        {/* Needs — one group per item, one row per family covering it */}
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Who&rsquo;s bringing what ({event.items.length})
            </h3>
            {needed > 0 ? (
              <span className="text-xs text-muted-foreground">
                {covered} of {needed} claimed
              </span>
            ) : null}
          </div>
          {event.items.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              This event doesn&rsquo;t list anything for families to bring.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table className="text-sm">
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[45%] pl-3">Item</TableHead>
                    <TableHead className="pr-3">
                      Who&rsquo;s bringing it
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {event.items.map((item) => (
                    <ItemRows
                      key={item.id}
                      item={item}
                      parentsByFamily={parentsByFamily}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>

      <div className="flex items-center justify-between gap-2 border-t bg-white px-5 py-3">
        <Button
          variant="outline"
          className="bg-white"
          onClick={() => onRemind(event)}
        >
          <Bell className="size-3.5" />
          Send SMS
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="bg-white" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => onEdit(event)}>
            <Pencil className="size-3.5" />
            Edit event
          </Button>
        </div>
      </div>

      {rsvpEdit ? (
        <EventRsvpDialog
          event={event}
          yearId={yearId}
          signup={rsvpEdit === "new" ? null : rsvpEdit}
          onSaved={onChanged}
          onClose={() => setRsvpEdit(null)}
        />
      ) : null}

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(o) => !o && !removing && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removeTarget?.family_name ?? "this family"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget ? removalSummary(removeTarget) : ""} They
              won&rsquo;t be told; the RSVP just disappears from their
              volunteer page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Keep RSVP</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void removeSignup();
              }}
            >
              {removing ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Removing
                </>
              ) : (
                "Remove RSVP"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** What removing a family's sign-up gives back, as one sentence:
 *  "Frees 2 parent spots and releases Brownies ×1, Punch ×1." */
function removalSummary(s: AdminEventSignup): string {
  const parts: string[] = [];
  if (s.has_rsvp && s.spots > 0) {
    parts.push(`frees ${s.spots} parent spot${s.spots === 1 ? "" : "s"}`);
  }
  if (s.bringing.length > 0) {
    parts.push(
      `releases ${s.bringing.map((b) => `${b.label} ×${b.quantity}`).join(", ")}`
    );
  }
  if (parts.length === 0) return "This removes their RSVP.";
  const sentence = parts.join(" and ");
  return `This ${sentence}.`;
}

/**
 * One need as a block of rows: the item cell spans every family
 * covering it, then a closing row for whatever is still open. An item
 * nobody has claimed is a single "Nobody yet" row, so gaps are as
 * visible as the claims.
 *
 * Each family's count sits right beside its name ("brings 2"). In a
 * far-right Qty column it went unseen: one family bringing both of an
 * item's 2 read as "2 of 2 claimed" with a family missing.
 */
function ItemRows({
  item,
  parentsByFamily,
}: {
  item: AdminEventItem;
  parentsByFamily: Map<number, string[]>;
}) {
  const open = Math.max(item.quantity - item.claimed, 0);
  const done = open === 0;
  const span = item.claims.length + (open > 0 && item.claims.length > 0 ? 1 : 0);
  const itemCell = (
    <TableCell
      rowSpan={Math.max(span, 1)}
      className="border-r border-b pl-3 align-top whitespace-normal"
    >
      <span className="block font-medium">{item.label}</span>
      <span
        className={cn(
          "mt-0.5 block text-xs",
          done ? "text-emerald-700" : "text-amber-700"
        )}
      >
        {item.claimed} of {item.quantity} claimed
        {done ? " · covered" : ` · ${open} open`}
      </span>
    </TableCell>
  );

  if (item.claims.length === 0) {
    return (
      <TableRow className="hover:bg-transparent">
        {itemCell}
        <TableCell className="pr-3 align-top text-muted-foreground">
          Nobody yet
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      {item.claims.map((c, i) => {
        return (
          <TableRow key={c.family_id} className="hover:bg-transparent">
            {i === 0 ? itemCell : null}
            <TableCell className="pr-3 align-top whitespace-normal">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span>{c.family_name}</span>
                <span className="rounded-full bg-muted px-2 py-px text-[11px] font-medium tabular-nums text-foreground">
                  brings {c.quantity}
                </span>
              </span>
              <ParentNames names={parentsByFamily.get(c.family_id) ?? []} />
            </TableCell>
          </TableRow>
        );
      })}
      {open > 0 ? (
        <TableRow className="hover:bg-transparent">
          <TableCell className="pr-3 align-top tabular-nums text-amber-700">
            {open} still needed
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

/** A family's parents under its name. Each name stays whole, so a
 *  narrow column wraps between people rather than mid-name. */
function ParentNames({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <span className="block text-xs text-muted-foreground">
      {names.map((name, i) => (
        <span key={`${name}-${i}`} className="whitespace-nowrap">
          {name}
          {i < names.length - 1 ? ", " : ""}
        </span>
      ))}
    </span>
  );
}

function QtyPill({ quantity }: { quantity: number }) {
  return (
    <span className="h-fit shrink-0 rounded-full bg-muted px-1.5 py-px text-[11px] font-medium tabular-nums text-muted-foreground">
      ×{quantity}
    </span>
  );
}

function SummaryTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "done";
}) {
  return (
    <div className="rounded-md border px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "done" && "text-emerald-700"
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
