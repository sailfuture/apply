"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Bus,
  ChevronRight,
  Clipboard,
  Download,
  Loader2,
  MapPin,
  MessageSquareText,
  Pencil,
  Plus,
} from "lucide-react";
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
import { FamilyProfileSheet } from "@/components/admin/family-profile-sheet";
import { QuickTextDialog } from "@/components/admin/quick-text-dialog";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import { formatUSPhone } from "@/lib/phone";
import type {
  BusStopGroup,
  BusStopsResponse,
} from "@/app/api/admin/bus-stops/route";

/**
 * Operations → Bus Stops — one card per stop with its riders for the
 * year. Built for the morning-route workflow: each card copies as
 * TAB-separated rows (paste straight into Google Sheets and it lands
 * as real cells), the whole page exports as CSV / copies in one
 * click with a Stop column added, and each card (plus the toolbar)
 * can text its families through the group blast route. Row click
 * opens the family's contact sheet.
 */
export default function BusStopsPage() {
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  const { data, isLoading, error, mutate } = useSWR<BusStopsResponse>(
    yearId ? `/api/admin/bus-stops?yearId=${yearId}` : null,
    adminFetcher
  );
  const stops = useMemo(() => data?.stops ?? [], [data]);
  const ridingStops = useMemo(
    () => stops.filter((s) => s.riders.length > 0),
    [stops]
  );
  // Distinct {id, name} pairs — the quick-text dialog needs the name
  // as a fallback for families the messaging directory doesn't list.
  const allFamilies = useMemo(() => {
    const byId = new Map<number, string>();
    for (const s of ridingStops) {
      for (const r of s.riders) {
        if (r.family_id > 0 && !byId.has(r.family_id)) {
          byId.set(r.family_id, r.family_name);
        }
      }
    }
    return [...byId.entries()].map(([id, name]) => ({ id, name }));
  }, [ridingStops]);

  // Row click → the family's contact sheet (same one the inbox uses:
  // every parent with tap-to-call/email, plus students).
  const [profileFamilyId, setProfileFamilyId] = useState<number | null>(
    null
  );
  // "Message" targets — one stop's families, or every riding family.
  const [quickText, setQuickText] = useState<{
    title: string;
    description: string;
    families: Array<{ id: number; name: string }>;
  } | null>(null);
  // Add/edit stop dialog — `{ stop: null }` = creating a new stop.
  const [stopDialog, setStopDialog] = useState<{
    stop: BusStopGroup | null;
  } | null>(null);

  if (!yearId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view bus stops.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Bus Stops</h1>
          <p className="text-sm text-muted-foreground">
            Every stop with its riders for the year. Copy pastes as
            real cells into Google Sheets; Export downloads the same
            list as CSV.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full border bg-white px-2.5 py-1 text-xs tabular-nums text-muted-foreground">
            {data?.totalRiders ?? 0} rider
            {(data?.totalRiders ?? 0) === 1 ? "" : "s"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-white"
            onClick={() => setStopDialog({ stop: null })}
          >
            <Plus className="size-3.5 mr-1.5" aria-hidden="true" />
            Add stop
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-white"
            disabled={allFamilies.length === 0}
            onClick={() =>
              setQuickText({
                title: "Text all bus families",
                description:
                  "Every family with a bus rider this year, across all stops.",
                families: allFamilies,
              })
            }
          >
            <MessageSquareText className="size-3.5 mr-1.5" aria-hidden="true" />
            Message all
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-white"
            disabled={ridingStops.length === 0}
            onClick={() => copyTsv(buildAllTsv(ridingStops), "All stops")}
          >
            <Clipboard className="size-3.5 mr-1.5" aria-hidden="true" />
            Copy all
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-white"
            disabled={ridingStops.length === 0}
            onClick={() => downloadCsv(ridingStops)}
          >
            <Download className="size-3.5 mr-1.5" aria-hidden="true" />
            Export CSV
          </Button>
        </div>
      </div>

      {isLoading && !data ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : error || !data ? (
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          {error instanceof Error
            ? error.message
            : "Couldn't load the bus-stop rosters."}
        </div>
      ) : stops.length === 0 ? (
        <div className="rounded-lg border bg-white px-6 py-16 text-center text-sm text-muted-foreground">
          <Bus className="mx-auto mb-2 size-6 text-muted-foreground/50" />
          No bus stops configured yet — add stops to the
          <span className="font-medium text-foreground">
            {" "}
            registration_bus{" "}
          </span>
          catalog and they&rsquo;ll appear here.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {stops.map((stop) => (
            <StopCard
              key={stop.id ?? `orphan-${stop.name}`}
              stop={stop}
              onMessage={() => {
                const byId = new Map<number, string>();
                for (const r of stop.riders) {
                  if (r.family_id > 0 && !byId.has(r.family_id)) {
                    byId.set(r.family_id, r.family_name);
                  }
                }
                setQuickText({
                  title: `Text families — ${stop.name}`,
                  description: `Families with a rider at ${stop.name}.`,
                  families: [...byId.entries()].map(([id, name]) => ({
                    id,
                    name,
                  })),
                });
              }}
              onOpenFamily={setProfileFamilyId}
              onEdit={() => setStopDialog({ stop })}
            />
          ))}
        </div>
      )}

      {stopDialog ? (
        <StopUpsertDialog
          key={stopDialog.stop?.id ?? "new"}
          yearId={yearId ? Number(yearId) : undefined}
          stop={stopDialog.stop}
          onClose={() => setStopDialog(null)}
          onSaved={() => {
            setStopDialog(null);
            void mutate();
          }}
        />
      ) : null}

      {profileFamilyId != null ? (
        <FamilyProfileSheet
          familyId={profileFamilyId}
          open
          onOpenChange={(o) => {
            if (!o) setProfileFamilyId(null);
          }}
        />
      ) : null}

      {/* Keyed by title so switching stops starts a fresh draft +
          selection (and a fresh blast id). */}
      {quickText && yearId ? (
        <QuickTextDialog
          key={quickText.title}
          yearId={Number(yearId)}
          title={quickText.title}
          description={quickText.description}
          families={quickText.families}
          onClose={() => setQuickText(null)}
        />
      ) : null}
    </div>
  );
}

function StopCard({
  stop,
  onMessage,
  onOpenFamily,
  onEdit,
}: {
  stop: BusStopGroup;
  /** "Message" click — opens the quick-text dialog for this stop's
   *  families. */
  onMessage: () => void;
  /** Row click — opens the family's contact sheet. */
  onOpenFamily: (familyId: number) => void;
  /** Pencil click — opens the edit dialog. Catalog stops only. */
  onEdit: () => void;
}) {
  const times = [
    stop.pick_up_time ? `Pickup ${formatTime(stop.pick_up_time)}` : null,
    stop.drop_off_time
      ? `Drop-off ${formatTime(stop.drop_off_time)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const familyCount = new Set(stop.riders.map((r) => r.family_id)).size;
  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{stop.name}</CardTitle>
            {times ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {times}
              </p>
            ) : null}
            {stop.address ? (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{stop.address}</span>
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
              {stop.riders.length}
            </span>
            {/* Synthetic groups (orphaned stop names) have no catalog
                row to edit. */}
            {stop.id != null ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 bg-white px-2 text-xs"
                onClick={onEdit}
                title="Edit this stop's name, times, and address"
              >
                <Pencil className="size-3 mr-1" aria-hidden="true" />
                Edit
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 bg-white px-2 text-xs"
              disabled={familyCount === 0}
              onClick={onMessage}
              title={`Text the ${familyCount} famil${familyCount === 1 ? "y" : "ies"} at this stop`}
            >
              <MessageSquareText className="size-3 mr-1" aria-hidden="true" />
              Message
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 bg-white px-2 text-xs"
              disabled={stop.riders.length === 0}
              onClick={() => copyTsv(buildStopTsv(stop), stop.name)}
              title="Copy this stop's roster — pastes into Google Sheets as cells"
            >
              <Clipboard className="size-3 mr-1" aria-hidden="true" />
              Copy
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3 bg-white">
        {stop.riders.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No riders assigned.
          </p>
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[10px] text-muted-foreground w-[40%]">
                  Student
                </TableHead>
                <TableHead className="text-[10px] text-muted-foreground w-[16%]">
                  Grade
                </TableHead>
                <TableHead className="text-[10px] text-muted-foreground w-[38%]">
                  Family
                </TableHead>
                <TableHead className="w-[6%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Row click = the family's contact sheet (parents with
                  tap-to-call/email, students) — the Parent column
                  moved there so the roster stays scannable. The
                  chevron is a real button so keyboard users can reach
                  the sheet too (the row onClick is mouse convenience);
                  orphaned rows (no family FK) get neither affordance. */}
              {stop.riders.map((r) => {
                const clickable = r.family_id > 0;
                return (
                  <TableRow
                    key={r.student_id}
                    onClick={() =>
                      clickable && onOpenFamily(r.family_id)
                    }
                    className={cn(clickable && "cursor-pointer")}
                  >
                    <TableCell className="text-sm font-medium">
                      <span className="block truncate">
                        {r.student_name}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.grade || "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="block truncate">{r.family_name}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      {clickable ? (
                        <button
                          type="button"
                          aria-label={`Open ${r.family_name} contact info`}
                          className="rounded p-1 align-middle text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenFamily(r.family_id);
                          }}
                        >
                          <ChevronRight
                            className="size-4"
                            aria-hidden="true"
                          />
                        </button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ─────────────────── copy / export helpers ─────────────────── */

const RIDER_HEADERS = [
  "Student",
  "Grade",
  "Family",
  "Parent",
  "Parent phone",
] as const;

function riderCells(r: BusStopGroup["riders"][number]): string[] {
  return [
    r.student_name,
    r.grade,
    r.family_name,
    r.parent_name,
    formatUSPhone(r.parent_phone) || r.parent_phone,
  ];
}

/** One stop as TSV — tabs/newlines are what make a paste land as
 *  cells in Google Sheets rather than one text blob. */
function buildStopTsv(stop: BusStopGroup): string {
  return [
    RIDER_HEADERS.join("\t"),
    ...stop.riders.map((r) => riderCells(r).map(tsvSafe).join("\t")),
  ].join("\n");
}

function buildAllTsv(stops: BusStopGroup[]): string {
  return [
    ["Stop", ...RIDER_HEADERS].join("\t"),
    ...stops.flatMap((s) =>
      s.riders.map((r) =>
        [s.name, ...riderCells(r)].map(tsvSafe).join("\t")
      )
    ),
  ].join("\n");
}

/** Cell text can't carry the delimiters — collapse them to spaces. */
function tsvSafe(v: string): string {
  return v.replace(/[\t\n\r]+/g, " ").trim();
}

function copyTsv(tsv: string, label: string): void {
  // navigator.clipboard is secure-context-only — undefined over plain
  // http, where the member access would throw synchronously.
  if (!navigator.clipboard?.writeText) {
    toast.error("Couldn't copy — use Export CSV instead.");
    return;
  }
  void navigator.clipboard.writeText(tsv).then(
    () =>
      toast.success(
        `${label} copied — paste into Google Sheets and it lands as cells.`
      ),
    () => toast.error("Couldn't copy — use Export CSV instead.")
  );
}

function downloadCsv(stops: BusStopGroup[]): void {
  const rows = [
    ["Stop", ...RIDER_HEADERS],
    ...stops.flatMap((s) =>
      s.riders.map((r) => [s.name, ...riderCells(r)])
    ),
  ];
  const csv = rows
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  const blob = new Blob([`﻿${csv}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "bus-stops.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** "8:10 AM" from the catalog's H*100+MM clock number (810 → 8:10 AM,
 *  1445 → 2:45 PM). These are NOT timestamps — decoding them as
 *  unix-ms rendered every stop as "7:00 PM" (the epoch in Eastern
 *  time). Malformed values fall back to the raw number. */
function formatTime(hmm: number): string {
  const hours = Math.floor(hmm / 100);
  const minutes = hmm % 100;
  if (!Number.isInteger(hmm) || hmm < 0 || hours > 23 || minutes > 59) {
    return String(hmm);
  }
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

/** HMM clock number → `<input type="time">` value ("08:10"). */
function hmmToInput(v: number | null): string {
  if (!v) return "";
  const h = Math.floor(v / 100);
  const m = v % 100;
  if (h > 23 || m > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** `<input type="time">` value → HMM clock number ("" → 0 = unset). */
function inputToHmm(v: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  return m ? Number(m[1]) * 100 + Number(m[2]) : 0;
}

/** Create/edit one catalog stop — name, address, pickup and drop-off
 *  times (stored as H*100+MM clock numbers). Keyed by stop id at the
 *  call site so switching targets resets the form. */
function StopUpsertDialog({
  yearId,
  stop,
  onClose,
  onSaved,
}: {
  yearId?: number;
  /** null = create a new stop. */
  stop: BusStopGroup | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(stop?.name ?? "");
  const [address, setAddress] = useState(stop?.address ?? "");
  const [pickup, setPickup] = useState(hmmToInput(stop?.pick_up_time ?? null));
  const [dropoff, setDropoff] = useState(
    hmmToInput(stop?.drop_off_time ?? null)
  );
  const [saving, setSaving] = useState(false);
  const renamed = stop != null && name.trim() !== stop.name;

  async function save() {
    if (!name.trim() || saving) return;
    // The column stores 0 as "unset", so literal midnight can't be
    // represented — saving 00:00 would silently show as no time.
    if (pickup === "00:00" || dropoff === "00:00") {
      toast.error(
        "12:00 AM reads as “no time set” — use 12:01 AM (or clear the field) instead."
      );
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        address: address.trim(),
        pick_up_time: inputToHmm(pickup),
        drop_off_time: inputToHmm(dropoff),
        ...(stop == null && yearId ? { yearId } : {}),
      };
      const res = await fetch(
        stop == null
          ? "/api/admin/bus-stops"
          : `/api/admin/bus-stops/${stop.id}`,
        {
          method: stop == null ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const result = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(result?.error ?? `Save failed (${res.status})`);
      }
      toast.success(stop == null ? "Stop added." : "Stop updated.");
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't save the stop."
      );
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !saving && !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {stop == null ? "Add bus stop" : `Edit ${stop.name}`}
          </DialogTitle>
          <DialogDescription>
            {stop == null
              ? "Adds a stop to the catalog — it appears here and in the parents' bus-stop picker."
              : "Times and address update everywhere immediately."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label
              htmlFor="stop-name"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Stop name
            </label>
            <Input
              id="stop-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Gladden Park"
              disabled={saving}
            />
            {renamed ? (
              // Applications snapshot the stop by NAME — a rename
              // strands existing riders in an unmatched group until
              // their bus elections are updated.
              <p className="mt-1.5 text-xs text-amber-700">
                Heads up: riders are linked to the stop&rsquo;s name.
                Renaming moves this stop&rsquo;s current riders into an
                unmatched group until their bus elections are updated.
              </p>
            ) : null}
          </div>
          <div>
            <label
              htmlFor="stop-address"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Address
            </label>
            <Input
              id="stop-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="3901 30th Ave N, St. Petersburg, FL 33713"
              disabled={saving}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="stop-pickup"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Pickup time
              </label>
              <Input
                id="stop-pickup"
                type="time"
                value={pickup}
                onChange={(e) => setPickup(e.target.value)}
                disabled={saving}
              />
            </div>
            <div>
              <label
                htmlFor="stop-dropoff"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Drop-off time
              </label>
              <Input
                id="stop-dropoff"
                type="time"
                value={dropoff}
                onChange={(e) => setDropoff(e.target.value)}
                disabled={saving}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="bg-white"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving || !name.trim()}
            onClick={save}
          >
            {saving ? (
              <>
                <Loader2
                  className="size-3.5 mr-1.5 animate-spin"
                  aria-hidden="true"
                />
                Saving…
              </>
            ) : stop == null ? (
              "Add stop"
            ) : (
              "Save changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
