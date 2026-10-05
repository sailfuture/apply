"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { CalendarClock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { adminFetcher } from "@/lib/admin-fetcher";

interface AdminYear {
  id: number;
  year_name: string;
  isActive?: boolean;
  isNextYear?: boolean;
  isFuture?: boolean;
  isPast?: boolean;
}

function yearLabel(y: AdminYear): string {
  if (y.isActive) return "current";
  if (y.isNextYear) return "upcoming";
  if (y.isFuture) return "future";
  if (y.isPast) return "past";
  return "";
}

/** Current first, then upcoming, future, past — the likely
 *  destinations at the top. */
function yearRank(y: AdminYear): number {
  if (y.isActive) return 0;
  if (y.isNextYear) return 1;
  if (y.isFuture) return 2;
  if (y.isPast) return 4;
  return 3;
}

interface AdminTerm {
  id: number;
  term_name: string;
  start_date: string | null;
}

/** Sentinel Select value for "start of the year" (Radix Select can't
 *  hold an empty-string item value). */
const START_OF_YEAR = "0";

/**
 * "Starting term" picker for one student's application — which term a
 * mid-year applicant starts in. Saves on change. Renders nothing when
 * the year has no terms configured (School Calendar → Terms), since
 * there'd be nothing to pick.
 */
export function StartingTermField({
  appId,
  yearId,
  value,
  onSaved,
}: {
  appId: number;
  yearId: number;
  value: number | null | undefined;
  onSaved: () => void;
}) {
  const { data } = useSWR<AdminTerm[]>(
    `/api/admin/academic-terms?yearId=${yearId}`,
    adminFetcher
  );
  const terms = Array.isArray(data) ? data : [];
  const [saving, setSaving] = useState(false);
  // Optimistic: show the pick immediately, roll back on failure.
  const [local, setLocal] = useState<string | null>(null);
  const current = local ?? String(value || START_OF_YEAR);

  if (terms.length === 0) return null;

  async function save(next: string) {
    setLocal(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/applications/${appId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_academic_terms_id: Number(next) }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${res.status})`);
      }
      toast.success("Starting term saved.");
      onSaved();
    } catch (err) {
      console.error("[StartingTermField.save]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
      setLocal(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Field>
      <FieldLabel className="text-xs">Starting term</FieldLabel>
      <Select value={current} onValueChange={save} disabled={saving}>
        <SelectTrigger className="w-full bg-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={START_OF_YEAR}>Start of the year</SelectItem>
          {terms.map((t) => (
            <SelectItem key={t.id} value={String(t.id)}>
              {t.term_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/**
 * Header action: move an applying or registering family's whole
 * paperwork (applications, progress, scholarship, and once accepted
 * their registration packets and payment setup) to a different school
 * year — for families who filed under the wrong one. Hidden once the
 * family is enrolled; from then on moves go one student at a time
 * from the Enrolled page, which keeps billing in step. The server
 * also refuses once billing has started.
 */
export function MoveApplicationYearButton({
  familyId,
  yearId,
  familyName,
}: {
  familyId: number;
  yearId: number;
  familyName: string;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [moving, setMoving] = useState(false);
  const { data, error, isLoading } = useSWR<AdminYear[]>(
    open ? "/api/admin/school-years" : null,
    adminFetcher
  );
  // Every year but the one they're on. This used to offer only the
  // years flagged Active / Next Year, which left the dropdown empty
  // (and unclickable) whenever the family was already on one of them
  // and the other wasn't flagged.
  const options = (Array.isArray(data) ? data : [])
    .filter((y) => y.id !== yearId)
    .sort((a, b) => yearRank(a) - yearRank(b));
  const targetName = options.find((y) => String(y.id) === target)?.year_name;

  async function runMove() {
    setMoving(true);
    try {
      const res = await fetch(
        `/api/admin/families/${familyId}/application-year`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromYearId: yearId, toYearId: Number(target) }),
        }
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Move failed (${res.status})`);
      }
      toast.success(`Application moved to ${targetName}.`);
      // Full navigation so every year-scoped SWR surface re-reads.
      window.location.href = `/admin/families/${familyId}?yearId=${target}`;
    } catch (err) {
      console.error("[MoveApplicationYearButton.runMove]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't move.");
      setMoving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="bg-white"
        onClick={() => setOpen(true)}
      >
        <CalendarClock className="size-3.5 mr-1.5" />
        Change year
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (moving) return;
          setOpen(o);
          if (!o) setTarget("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {familyName || "this family"}&rsquo;s application</DialogTitle>
            <DialogDescription>
              For a family who applied under the wrong school year. Every
              student&rsquo;s application, the family&rsquo;s progress and
              scholarship application move together — plus registration
              packets and payment setup if they&rsquo;re already
              registering. Starting terms are cleared, since terms belong
              to a year — set them again after the move.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel className="text-xs">Move to</FieldLabel>
            <Select
              value={target}
              onValueChange={setTarget}
              disabled={moving || options.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    isLoading
                      ? "Loading school years…"
                      : error
                        ? "Couldn’t load school years"
                        : options.length === 0
                          ? "No other school years set up"
                          : "Pick a school year…"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {options.map((y) => {
                  const label = yearLabel(y);
                  return (
                    <SelectItem key={y.id} value={String(y.id)}>
                      {y.year_name}
                      {label ? ` (${label})` : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={moving}
            >
              Cancel
            </Button>
            <Button onClick={() => void runMove()} disabled={!target || moving}>
              {moving ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : null}
              {targetName ? `Move to ${targetName}` : "Move"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
