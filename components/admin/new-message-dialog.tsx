"use client";

import { Fragment, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Loader2, MessageSquarePlus, Search, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { adminFetcher } from "@/lib/admin-fetcher";
import type {
  GroupAudienceResponse,
  GroupContact,
  GroupStage,
} from "@/app/api/admin/messages/group/audience/route";

interface PickedContact {
  type: GroupContact["type"];
  id: number;
  name: string;
}

/** Same stage vocabulary + chip order as the group composer. */
const STAGE_FILTERS: Array<{ value: GroupStage; label: string }> = [
  { value: "enrolled", label: "Enrolled" },
  { value: "registration", label: "Registration" },
  { value: "application", label: "Applying" },
  { value: "inquiry", label: "Inquiries" },
  { value: "camp", label: "Camp" },
  { value: "visit", label: "Visits" },
];

const STAGE_LABEL: Record<GroupStage, string> = {
  enrolled: "Enrolled",
  registration: "Registration",
  application: "Application",
  inquiry: "Inquiry",
  camp: "Camp",
  visit: "Visit",
};

/** Section headings per contact TYPE — identical to the group list. */
const TYPE_HEADING: Record<GroupContact["type"], string> = {
  family: "Families",
  inquiry: "Inquiries",
  camp: "Summer camp",
  visit: "Campus visits",
};

const GRADES = [8, 9, 10, 11, 12] as const;

/**
 * "New message" — contact picker for the global SMS inbox, rebuilt on
 * the SAME audience feed and layout as the group composer (user
 * request): year-scoped contacts deduped to their furthest stage,
 * stage + grade filter chips, sticky type section headers, inquiry
 * interest stars. Clicking a row opens that contact's thread — even
 * unsendable rows open (the thread shows history and explains why
 * texting is unavailable).
 */
export function NewMessageDialog({
  onPick,
}: {
  /** Open this contact's thread in the host inbox. */
  onPick: (contact: PickedContact) => void;
}) {
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const [open, setOpen] = useState(false);

  // Same feed the group composer uses — fetched only while open.
  const { data, isLoading } = useSWR<GroupAudienceResponse>(
    open && yearId
      ? `/api/admin/messages/group/audience?yearId=${yearId}`
      : null,
    adminFetcher
  );
  const contacts = useMemo(() => data?.contacts ?? [], [data]);

  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<GroupStage[]>([]);
  const [gradeFilter, setGradeFilter] = useState<number[]>([]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (stageFilter.length > 0 && !stageFilter.includes(c.stage)) {
        return false;
      }
      if (
        gradeFilter.length > 0 &&
        !c.grades.some((g) => gradeFilter.includes(g))
      ) {
        return false;
      }
      if (!q) return true;
      return `${c.name} ${c.personName} ${c.students}`
        .toLowerCase()
        .includes(q);
    });
  }, [contacts, search, stageFilter, gradeFilter]);

  function pick(c: GroupContact) {
    setOpen(false);
    setSearch("");
    onPick({ type: c.type, id: c.id, name: c.name });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="bg-white"
        onClick={() => setOpen(true)}
      >
        <MessageSquarePlus className="size-3.5 mr-1.5" />
        New message
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setSearch("");
        }}
      >
        <DialogContent className="flex h-[85vh] max-h-[820px] flex-col gap-4 sm:max-w-4xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>New message</DialogTitle>
            <DialogDescription>
              Pick a contact to open their text thread — each appears
              once, at the furthest stage they&rsquo;ve reached.
            </DialogDescription>
          </DialogHeader>

          {/* Search */}
          <div className="relative shrink-0">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search families, parents, or students…"
              className="pl-8"
            />
          </div>

          {/* Stage chips — same vocabulary as the group composer. */}
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Stage
            </span>
            {STAGE_FILTERS.map((s) => {
              const on = stageFilter.includes(s.value);
              return (
                <button
                  key={s.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setStageFilter((prev) =>
                      prev.includes(s.value)
                        ? prev.filter((x) => x !== s.value)
                        : [...prev, s.value]
                    )
                  }
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                    on
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Grade chips */}
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Grade
            </span>
            {GRADES.map((g) => {
              const on = gradeFilter.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setGradeFilter((prev) =>
                      prev.includes(g)
                        ? prev.filter((x) => x !== g)
                        : [...prev, g]
                    )
                  }
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                    on
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  )}
                >
                  {g}th
                </button>
              );
            })}
          </div>

          {/* Contact list — same chrome as the group composer's list:
              sticky type headers, name + stars, detail line. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md border bg-white">
            {!yearId ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                Pick a school year above to load contacts.
              </div>
            ) : isLoading && !data ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                No contacts match these filters.
              </div>
            ) : (
              <ul className="divide-y">
                {filtered.map((c, i) => {
                  const showTypeHeader =
                    i === 0 || filtered[i - 1].type !== c.type;
                  return (
                    <Fragment key={c.key}>
                      {showTypeHeader ? (
                        <li className="sticky top-0 z-10 border-b bg-muted/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                          {TYPE_HEADING[c.type]}
                        </li>
                      ) : null}
                      <li>
                        <button
                          type="button"
                          onClick={() => pick(c)}
                          className={cn(
                            "flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/40",
                            // Unsendable rows fade but stay clickable —
                            // the thread shows history and explains why
                            // texting is unavailable.
                            !c.sendable && "opacity-50"
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {c.name}
                              </span>
                              {c.type === "inquiry" ? (
                                <span
                                  className="flex shrink-0 items-center gap-px"
                                  aria-label={
                                    (c.rating ?? 0) > 0
                                      ? `${c.rating} of 5 stars`
                                      : "Not rated"
                                  }
                                >
                                  {[1, 2, 3, 4, 5].map((n) => (
                                    <Star
                                      key={n}
                                      className={cn(
                                        "size-3",
                                        n <= (c.rating ?? 0)
                                          ? "fill-amber-400 text-amber-400"
                                          : "text-muted-foreground/30"
                                      )}
                                    />
                                  ))}
                                </span>
                              ) : null}
                              {c.outstanding ? (
                                <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-red-700">
                                  Balance
                                </span>
                              ) : null}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {[
                                c.personName,
                                c.students ? c.students : null,
                                STAGE_LABEL[c.stage],
                              ]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </span>
                          </span>
                          {!c.sendable ? (
                            <span className="shrink-0 self-center text-[10px] text-muted-foreground/60">
                              {c.optedOut ? "Opted out" : "No number"}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    </Fragment>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {filtered.length} shown
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
