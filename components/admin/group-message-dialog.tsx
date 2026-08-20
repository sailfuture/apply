"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Link2,
  Loader2,
  Phone,
  Plus,
  Search,
  Send,
  Star,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { adminFetcher } from "@/lib/admin-fetcher";
import { sortYearsOldestFirst } from "@/lib/school-years";
import { formatUSPhone, validateUSPhone } from "@/lib/phone";
import type {
  GroupAudienceResponse,
  GroupContact,
  GroupStage,
} from "@/app/api/admin/messages/group/audience/route";

interface SchoolYear {
  id: number;
  year_name: string;
  isActive?: boolean;
  isPast?: boolean;
}

/** Stage badge styling — the ladder reads furthest-along first, same
 *  order the audience endpoint sorts by. */
const STAGE_BADGE: Record<GroupStage, { label: string; className: string }> = {
  enrolled: {
    label: "Enrolled",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  registration: {
    label: "Registration",
    className: "border-blue-200 bg-blue-50 text-blue-800",
  },
  application: {
    label: "Application",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
  inquiry: {
    label: "Inquiry",
    className: "border-violet-200 bg-violet-50 text-violet-800",
  },
  camp: {
    label: "Camp",
    className: "border-teal-200 bg-teal-50 text-teal-800",
  },
  visit: {
    label: "Liability Waiver Visit",
    className: "border-rose-200 bg-rose-50 text-rose-800",
  },
  tasco: {
    label: "TASCO",
    className: "border-orange-200 bg-orange-50 text-orange-800",
  },
};

/** Section headings for the recipient list — one per contact TYPE, in
 *  the order the audience endpoint sorts (families → inquiries → camp
 *  → visits → TASCO). */
const TYPE_HEADING: Record<GroupContact["type"], string> = {
  family: "Families",
  inquiry: "Inquiries",
  camp: "Summer camp",
  visit: "Liability waiver visits",
  tasco: "TASCO summer visits",
};

const GRADES = [8, 9, 10, 11, 12] as const;

/** Stage filter chips — one per rung of the ladder, so "everyone at
 *  camp" or "all enrolled families" is chip + select-all-shown. */
const STAGE_FILTERS: Array<{ value: GroupStage; label: string }> = [
  { value: "enrolled", label: "Enrolled" },
  { value: "registration", label: "Registration" },
  { value: "application", label: "Applying" },
  { value: "inquiry", label: "Inquiries" },
  { value: "camp", label: "Camp" },
  { value: "visit", label: "Liability Waiver Visit" },
  { value: "tasco", label: "TASCO" },
];

/**
 * Stage vocabulary the search box understands — typing "enrolled",
 * "applicants", or "camp" narrows to that stage even though no
 * contact is literally NAMED that. Matched by prefix, and only for
 * queries of 3+ characters so short name fragments ("en", "ca")
 * don't accidentally flood the list with a whole stage.
 */
const STAGE_SEARCH_ALIASES: Record<GroupStage, string[]> = {
  enrolled: ["enrolled", "enrollment"],
  registration: ["registration", "registering", "registered"],
  application: ["application", "applications", "applying", "applicant", "applicants"],
  inquiry: ["inquiry", "inquiries"],
  camp: ["camp", "campers", "summer"],
  visit: ["visit", "visits", "visitors", "waiver", "waivers", "liability"],
  tasco: ["tasco", "recreation", "rec center"],
};

function matchesStageAlias(stage: GroupStage, q: string): boolean {
  if (q.length < 3) return false;
  return STAGE_SEARCH_ALIASES[stage].some((a) => a.startsWith(q));
}

/**
 * Per-recipient personalization token. SMS has no rich formatting
 * (bold/italics don't exist in the protocol), so "robust" composing
 * means links + personalization: the server replaces this token with
 * each recipient's first name at send time ("there" when the record
 *  has no name). Kept in one regex so the dialog's preview note and
 * the server's replacement can't drift.
 */
export const FIRST_NAME_TOKEN = "{{first_name}}";
const FIRST_NAME_RE = /\{\{\s*first_name\s*\}\}/i;

/** Which slice of the directory a composer instance works over —
 *  the enrolled messages page and the recruitment messages page each
 *  mount a scoped composer so staff can't accidentally blast across
 *  the boundary. "all" preserves the original everything view. */
export type GroupScope = "all" | "enrolled" | "recruitment";

/**
 * Group SMS composer — audience built by hand instead of coarse stage
 * filters. The full contact directory for the year loads once
 * (`/api/admin/messages/group/audience`), deduped so a household only
 * appears at its furthest stage (enrolled > registration >
 * application > inquiry > camp) with a stage badge saying where they
 * are. Staff then search, narrow by incoming grade (8th–12th) or
 * outstanding balance, and check off recipients — or select-all the
 * current view. Send posts the explicit contact list; opted-out and
 * no-number contacts can't be selected at all.
 *
 * Scoped variants: `scope="enrolled"` narrows to enrolled families
 * and swaps the lead-oriented filters (stage, rating) for the
 * enrolled ones (crew, bus stop, grade, balance); `scope="recruitment"`
 * is the complement — every not-yet-enrolled contact, with stage and
 * rating filters and no crew/bus rows.
 */
export function GroupMessageDialog({
  onSent,
  scope = "all",
  defaultYearId,
}: {
  onSent?: () => void;
  scope?: GroupScope;
  /** Year to preselect — the messages pages pass their URL year so
   *  the composer's audience matches the page's slice (the dialog's
   *  own fallback, the active year, can differ from the nav's
   *  default, the upcoming year). Still changeable in the dialog. */
  defaultYearId?: number;
}) {
  const [open, setOpen] = useState(false);
  const { data: yearsData } = useSWR(
    open ? "/api/admin/school-years" : null,
    adminFetcher
  );
  const years = useMemo<SchoolYear[]>(
    () => sortYearsOldestFirst(Array.isArray(yearsData) ? yearsData : []),
    [yearsData]
  );

  const [yearId, setYearId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<GroupStage[]>([]);
  const [gradeFilter, setGradeFilter] = useState<number[]>([]);
  // Crew chips — narrow a blast to one crew's families ("just Crew E").
  // Options derive from the loaded audience so renamed/added crews
  // appear without a code change; the row hides when no family has a
  // crew assignment for the year.
  const [crewFilter, setCrewFilter] = useState<string[]>([]);
  // Bus-stop chips — narrow to families with a bus rider at the
  // selected stop(s). Same derive-from-audience pattern as crews.
  const [busStopFilter, setBusStopFilter] = useState<string[]>([]);
  const [onlyOutstanding, setOnlyOutstanding] = useState(false);
  // Minimum star rating (0 = any). Ratings live on LEAD rows (inquiry
  // / camp / visit / TASCO), so any minimum > 0 narrows to rated leads.
  const [minRating, setMinRating] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Manually-typed recipients — bare 10-digit numbers with no record
  // behind them. Sent as `adhoc` contacts (id = the number itself).
  const [adhocNumbers, setAdhocNumbers] = useState<string[]>([]);
  const [adhocInput, setAdhocInput] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  // Send is two-step: the footer button opens this confirm, which
  // restates who + what before anything actually fires.
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Composer toolbar state — link inserter popover + cursor-aware
  // insertion into the textarea.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  /** Insert a snippet at the textarea cursor (or append), keeping
   *  focus so composing flows on. */
  function insertAtCursor(snippet: string) {
    const el = textareaRef.current;
    setBody((prev) => {
      if (!el) return prev + snippet;
      const start = el.selectionStart ?? prev.length;
      const end = el.selectionEnd ?? prev.length;
      const next = prev.slice(0, start) + snippet + prev.slice(end);
      // Restore the caret after React re-renders the value.
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + snippet.length;
        el.setSelectionRange(pos, pos);
      });
      return next;
    });
  }

  function insertLink() {
    const url = linkUrl.trim();
    if (!url) return;
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    insertAtCursor(
      (body.length > 0 && !body.endsWith(" ") ? " " : "") + withScheme + " "
    );
    setLinkUrl("");
    setLinkOpen(false);
  }
  // Idempotency key for the blast — minted per compose session so a
  // retry after a timeout resumes the SAME blast server-side (contacts
  // already texted are skipped) instead of double-texting.
  const [blastId, setBlastId] = useState("");

  useEffect(() => {
    if (open) setBlastId(crypto.randomUUID());
  }, [open]);

  // Default year once the list loads: the caller's year when given
  // (keeps the composer aligned with the page it sits on), otherwise
  // the active year.
  useEffect(() => {
    if (!yearId && years.length) {
      const preferred =
        defaultYearId != null
          ? years.find((y) => y.id === defaultYearId)
          : undefined;
      const fallback = years.find((y) => y.isActive) ?? years[0];
      const pick = preferred ?? fallback;
      if (pick) setYearId(String(pick.id));
    }
  }, [years, yearId, defaultYearId]);

  const { data: audienceData, isLoading: loadingAudience } =
    useSWR<GroupAudienceResponse>(
      open && yearId
        ? `/api/admin/messages/group/audience?yearId=${yearId}`
        : null,
      adminFetcher
    );
  const contacts = useMemo<GroupContact[]>(() => {
    const all = audienceData?.contacts ?? [];
    // Scope boundary: enrolled = enrolled families only; recruitment =
    // everyone who ISN'T an enrolled family (leads + families still
    // applying/registering). "all" keeps the original combined view.
    if (scope === "enrolled") {
      return all.filter(
        (c) => c.type === "family" && c.stage === "enrolled"
      );
    }
    if (scope === "recruitment") {
      return all.filter(
        (c) => !(c.type === "family" && c.stage === "enrolled")
      );
    }
    return all;
  }, [audienceData, scope]);
  const contactByKey = useMemo(
    () => new Map(contacts.map((c) => [c.key, c])),
    [contacts]
  );

  // Year switch invalidates the audience — drop any selection made
  // against the previous year's list (and any crew/bus narrowing,
  // since both are per-year assignments).
  function changeYear(v: string) {
    setYearId(v);
    setSelected(new Set());
    setCrewFilter([]);
    setBusStopFilter([]);
  }

  const crewOptions = useMemo(
    () =>
      [...new Set(contacts.flatMap((c) => c.crews ?? []))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [contacts]
  );
  const busStopOptions = useMemo(
    () =>
      [...new Set(contacts.flatMap((c) => c.busStops ?? []))].sort(
        (a, b) => a.localeCompare(b)
      ),
    [contacts]
  );

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
      if (
        crewFilter.length > 0 &&
        !(c.crews ?? []).some((cr) => crewFilter.includes(cr))
      ) {
        return false;
      }
      if (
        busStopFilter.length > 0 &&
        !(c.busStops ?? []).some((b) => busStopFilter.includes(b))
      ) {
        return false;
      }
      if (onlyOutstanding && !c.outstanding) return false;
      if (minRating > 0 && (c.rating ?? 0) < minRating) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.personName.toLowerCase().includes(q) ||
        c.students.toLowerCase().includes(q) ||
        // Stage words work in search too — "enrolled", "applicants",
        // "camp"… narrow to that stage.
        matchesStageAlias(c.stage, q)
      );
    });
  }, [
    contacts,
    search,
    stageFilter,
    gradeFilter,
    crewFilter,
    busStopFilter,
    onlyOutstanding,
    minRating,
  ]);

  const selectedContacts = useMemo(
    () =>
      [...selected]
        .map((k) => contactByKey.get(k))
        .filter((c): c is GroupContact => Boolean(c)),
    [selected, contactByKey]
  );

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllShown() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of filtered) {
        if (c.sendable) next.add(c.key);
      }
      return next;
    });
  }

  /** Add the typed number as an ad-hoc recipient (validated, deduped —
   *  against both the manual list and any directory contact already
   *  matching that number). */
  function addAdhocNumber() {
    const { valid, digits } = validateUSPhone(adhocInput);
    if (!valid || digits.length !== 10) {
      toast.error("Enter a valid 10-digit US phone number.");
      return;
    }
    if (adhocNumbers.includes(digits)) {
      setAdhocInput("");
      return;
    }
    setAdhocNumbers((prev) => [...prev, digits]);
    setAdhocInput("");
  }

  const segments = body.length === 0 ? 0 : Math.ceil(body.length / 160);
  const sendCount = selectedContacts.length + adhocNumbers.length;
  const canSend =
    Boolean(yearId) && body.trim().length > 0 && sendCount > 0 && !sending;

  // "9 Enrolled · 3 Applying · 2 Camp" — restated in the confirm so a
  // mis-built audience is visible before anything sends.
  const stageBreakdown = useMemo(() => {
    const counts = new Map<GroupStage, number>();
    for (const c of selectedContacts) {
      counts.set(c.stage, (counts.get(c.stage) ?? 0) + 1);
    }
    const parts = STAGE_FILTERS.filter((s) => counts.has(s.value)).map(
      (s) => `${counts.get(s.value)} ${s.label}`
    );
    if (adhocNumbers.length > 0) {
      parts.push(
        `${adhocNumbers.length} manual number${adhocNumbers.length === 1 ? "" : "s"}`
      );
    }
    return parts.join(" · ");
  }, [selectedContacts, adhocNumbers]);

  const hasNameToken = FIRST_NAME_RE.test(body);
  // Example fill for the confirm's personalization note — the first
  // selected recipient's first name makes the token concrete.
  const exampleFirstName =
    selectedContacts[0]?.personName.split(" ")[0] || "there";

  /** Closing the composer resets the search box so the next open
   *  starts from the full list (selection + draft persist on purpose
   *  — an accidental dismiss shouldn't destroy a half-built blast). */
  function handleOpenChange(o: boolean) {
    setOpen(o);
    if (!o) setSearch("");
  }

  async function send() {
    if (!canSend) return;
    setSending(true);
    try {
      const res = await fetch("/api/admin/messages/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yearId: Number(yearId),
          contacts: [
            ...selectedContacts.map((c) => ({ type: c.type, id: c.id })),
            // Manually-typed numbers ride along as ad-hoc contacts —
            // the 10-digit number doubles as the contact id.
            ...adhocNumbers.map((d) => ({
              type: "adhoc" as const,
              id: Number(d),
            })),
          ],
          body: body.trim(),
          blastId,
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error ?? `Send failed (${res.status})`);
      toast.success(
        `Group text sent to ${d.sent} ${
          d.sent === 1 ? "contact" : "contacts"
        }${d.failed ? ` (${d.failed} failed)` : ""}.`
      );
      setBody("");
      setSelected(new Set());
      setAdhocNumbers([]);
      setOpen(false);
      onSent?.();
    } catch (err) {
      console.error("Group send failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't send group text."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Users className="size-4 mr-1.5" />
        New group message
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        {/* Large fixed-size panel (Slack-settings style) — the dialog
            claims most of the viewport and the recipient list flexes
            to absorb the height, so filtering/searching never resizes
            the frame. Sized generously (user request) so the recipient
            list shows a real page of names. */}
        <DialogContent className="flex h-[92vh] max-h-[1040px] flex-col gap-4 sm:max-w-6xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {scope === "enrolled"
                ? "New group message — enrolled families"
                : scope === "recruitment"
                  ? "New group message — recruitment"
                  : "New group message"}
            </DialogTitle>
            <DialogDescription>
              Search and check off recipients — each contact appears once,
              at the furthest stage they&rsquo;ve reached. Opted-out
              contacts and those without a mobile number can&rsquo;t be
              selected.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {/* Year + search on one row */}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={yearId} onValueChange={changeYear}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="School year" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y.id} value={String(y.id)}>
                      {y.year_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search families, parents, or students…"
                  type="search"
                  autoComplete="off"
                  className="pl-8"
                />
              </div>
            </div>

            {/* Stage narrowing chips — camp / inquiries / applying /
                registration / enrolled. Pair with "Select all shown"
                for one-click "text everyone at this stage" blasts.
                Empty = every stage. Hidden on the enrolled-scoped
                composer (everyone there IS enrolled); the recruitment
                scope drops the Enrolled chip (its audience can't
                contain any). */}
            {scope !== "enrolled" ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Stage
              </span>
              {STAGE_FILTERS.filter(
                (s) => scope !== "recruitment" || s.value !== "enrolled"
              ).map((s) => {
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
            ) : null}

            {/* Grade + balance narrowing chips */}
            <div className="flex flex-wrap items-center gap-1.5">
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
              {/* Crew chips — packet crew assignments for the year.
                  Hidden entirely until at least one family has one,
                  and on the recruitment scope (crews belong to
                  enrolled life, not the funnel). */}
              {scope !== "recruitment" && crewOptions.length > 0 ? (
                <>
                  <span className="mx-1 h-4 w-px bg-border" aria-hidden />
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Crew
                  </span>
                  {crewOptions.map((crew) => {
                    const on = crewFilter.includes(crew);
                    return (
                      <button
                        key={crew}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setCrewFilter((prev) =>
                            prev.includes(crew)
                              ? prev.filter((x) => x !== crew)
                              : [...prev, crew]
                          )
                        }
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                          on
                            ? "border-foreground bg-foreground text-background"
                            : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                        )}
                      >
                        {/* "Crew E" chips read as just "E" next to the
                            CREW row label. */}
                        {crew.replace(/^crew\s+/i, "")}
                      </button>
                    );
                  })}
                </>
              ) : null}
              {/* Bus-stop chips — families with a bus rider at the
                  selected stop(s). Same derive-from-audience pattern
                  as crews; hidden until a family has a bus election,
                  and on the recruitment scope. */}
              {scope !== "recruitment" && busStopOptions.length > 0 ? (
                <>
                  <span className="mx-1 h-4 w-px bg-border" aria-hidden />
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Bus stop
                  </span>
                  {busStopOptions.map((stop) => {
                    const on = busStopFilter.includes(stop);
                    return (
                      <button
                        key={stop}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setBusStopFilter((prev) =>
                            prev.includes(stop)
                              ? prev.filter((x) => x !== stop)
                              : [...prev, stop]
                          )
                        }
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                          on
                            ? "border-foreground bg-foreground text-background"
                            : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                        )}
                      >
                        {stop}
                      </button>
                    );
                  })}
                </>
              ) : null}
              {scope !== "recruitment" ? (
                <>
                  <span className="mx-1 h-4 w-px bg-border" aria-hidden />
                  <button
                    type="button"
                    aria-pressed={onlyOutstanding}
                    onClick={() => setOnlyOutstanding((v) => !v)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                      onlyOutstanding
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                    )}
                  >
                    Outstanding balance
                  </button>
                </>
              ) : null}
              {/* Minimum star rating — narrows to leads rated at least
                  N stars (ratings live on inquiry/camp/visit/TASCO
                  rows). Clicking the active chip clears it. Hidden on
                  the enrolled scope — families carry no rating. */}
              {scope !== "enrolled" ? (
                <>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden />
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Rating
              </span>
              {[1, 2, 3, 4, 5].map((n) => {
                const on = minRating === n;
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setMinRating(on ? 0 : n)}
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                      on
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                    )}
                    title={`Rated ${n}${n < 5 ? " or more" : ""} stars`}
                  >
                    {n}
                    <Star
                      className={cn(
                        "size-3",
                        on ? "fill-background" : "fill-amber-400 text-amber-400"
                      )}
                    />
                    {n < 5 ? "+" : ""}
                  </button>
                );
              })}
                </>
              ) : null}
            </div>

            {/* Recipient list — flexes to fill the fixed dialog frame,
                so filtering changes what scrolls, never the layout. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md border bg-white">
              {loadingAudience ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : !yearId ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  Pick a school year to load contacts.
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  No contacts match these filters.
                </div>
              ) : (
                <ul className="divide-y">
                  {filtered.map((c, i) => {
                    const badge = STAGE_BADGE[c.stage];
                    const checked = selected.has(c.key);
                    // Section header whenever the contact TYPE changes
                    // — the list is already sorted families → inquiries
                    // → camp → visits, so this yields one heading per
                    // type (user request).
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
                        <label
                          className={cn(
                            "flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-muted/40",
                            // Unsendable rows fade hard — they're
                            // context, not candidates.
                            !c.sendable && "cursor-not-allowed opacity-40"
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            disabled={!c.sendable}
                            onCheckedChange={() => toggle(c.key)}
                            className="mt-0.5"
                            aria-label={`Select ${c.name}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {c.name}
                              </span>
                              {/* Lead interest stars (inquiry / camp /
                                  visit / TASCO) — always rendered so
                                  warm leads pop; unrated rows show 5
                                  muted stars. */}
                              {c.type !== "family" ? (
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
                            {/* Person · students · phone · stage — the
                                stage reads as part of the detail line
                                (dot-separated) rather than a badge. */}
                            <span className="block truncate text-xs text-muted-foreground">
                              {[
                                c.personName,
                                c.students ? c.students : null,
                                c.phone || null,
                                badge.label,
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
                        </label>
                        </li>
                      </Fragment>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Manual numbers — text a number that isn't on any list.
                Added numbers show as removable chips and send as
                ad-hoc contacts (they thread by phone in the inbox). */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-56">
                <Phone className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={adhocInput}
                  onChange={(e) => setAdhocInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addAdhocNumber();
                    }
                  }}
                  placeholder="Add a phone number…"
                  className="h-8 pl-8 text-sm"
                  inputMode="tel"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 bg-white px-2 text-xs"
                onClick={addAdhocNumber}
                disabled={!adhocInput.trim()}
              >
                <Plus className="size-3.5 mr-1" />
                Add number
              </Button>
              {adhocNumbers.map((d) => (
                <span
                  key={d}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs font-medium tabular-nums"
                >
                  {formatUSPhone(d)}
                  <button
                    type="button"
                    onClick={() =>
                      setAdhocNumbers((prev) => prev.filter((x) => x !== d))
                    }
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={`Remove ${formatUSPhone(d)}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>

            {/* Selection controls */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {filtered.length} shown · {sendCount} selected
              </span>
              <span className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={selectAllShown}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Select all shown
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(new Set());
                    setAdhocNumbers([]);
                  }}
                  className="underline underline-offset-2 hover:text-foreground"
                  disabled={sendCount === 0}
                >
                  Clear
                </button>
              </span>
            </div>

            <div className="space-y-1.5">
              {/* SMS is plain text — no bold/italics exist in the
                  protocol — so the toolbar offers what texts CAN do:
                  links (clickable on phones) and per-recipient
                  personalization. */}
              <div className="flex items-center justify-between gap-2">
                <Label>Message</Label>
                <div className="flex items-center gap-1.5">
                  <Popover open={linkOpen} onOpenChange={setLinkOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 bg-white px-2 text-xs"
                      >
                        <Link2 className="size-3.5 mr-1" />
                        Link
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-80 space-y-2 p-3"
                    >
                      <p className="text-xs text-muted-foreground">
                        URLs send as plain text and are tappable on the
                        family&rsquo;s phone.
                      </p>
                      <div className="flex items-center gap-2">
                        <Input
                          value={linkUrl}
                          onChange={(e) => setLinkUrl(e.target.value)}
                          placeholder="sailfuture.org/…"
                          className="h-8"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              insertLink();
                            }
                          }}
                        />
                        <Button
                          type="button"
                          size="sm"
                          className="h-8"
                          onClick={insertLink}
                          disabled={!linkUrl.trim()}
                        >
                          Insert
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 bg-white px-2 text-xs"
                    title={`Inserts ${FIRST_NAME_TOKEN} — replaced with each recipient's first name at send time`}
                    onClick={() => insertAtCursor(FIRST_NAME_TOKEN)}
                  >
                    <UserRound className="size-3.5 mr-1" />
                    First name
                  </Button>
                </div>
              </div>
              <Textarea
                ref={textareaRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  // Shift+Enter (or Cmd/Ctrl+Enter) submits — same
                  // convention as the thread + activity composers.
                  // Lands on the confirm step, never a direct send.
                  if (
                    e.key === "Enter" &&
                    (e.shiftKey || e.metaKey || e.ctrlKey)
                  ) {
                    e.preventDefault();
                    if (canSend) setConfirmOpen(true);
                  }
                }}
                rows={4}
                placeholder="Type the text every selected contact will receive…"
              />
              <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                <span>
                  {hasNameToken
                    ? `${FIRST_NAME_TOKEN} fills in per recipient (e.g. "${exampleFirstName}").`
                    : ""}
                </span>
                <span className="shrink-0 tabular-nums">
                  {body.length} chars{segments ? ` · ${segments} seg` : ""}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={!canSend}
              title="Shift+Enter in the message box also opens this"
            >
              {sending ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Sending
                </>
              ) : (
                <>
                  <Send className="size-3.5 mr-1.5" />
                  {sendCount > 0 ? `Send to ${sendCount}` : "Send"}
                  <kbd className="ml-2 rounded border border-current/30 px-1 py-px font-sans text-[10px] font-normal opacity-70">
                    Shift ⏎
                  </kbd>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Final confirmation — a group text can't be unsent, so restate
          exactly who (count + stage breakdown) and what (the message,
          verbatim) before firing. */}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => !sending && setConfirmOpen(o)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Send this text to {sendCount}{" "}
              {sendCount === 1 ? "contact" : "contacts"}?
            </AlertDialogTitle>
            {/* Deliberately lean — the audience and message are right
                behind this modal in the composer; the confirm just
                restates the count + mix and warns it can't be unsent. */}
            <AlertDialogDescription>
              {stageBreakdown || "No recipients selected"}
              {hasNameToken
                ? ` · ${FIRST_NAME_TOKEN} fills in per recipient`
                : ""}
              . This can&rsquo;t be unsent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={sending || !canSend}
              onClick={(e) => {
                e.preventDefault();
                void send().then(() => setConfirmOpen(false));
              }}
            >
              {sending ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Sending
                </>
              ) : (
                `Send to ${sendCount}`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
