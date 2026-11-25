"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  CalendarDays,
  Check,
  ChevronsUpDown,
  ExternalLink,
  Loader2,
  Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatDateUs } from "@/lib/us-date";
import { cn } from "@/lib/utils";
import type {
  LeadEventLink,
  LeadEventSource,
  RecruitmentEvent,
} from "@/lib/lead-events";
import type { AllLeadRow } from "@/app/api/admin/all-leads/route";

const LINKS_KEY = "/api/admin/lead-events";
const FEED_KEY = "/api/admin/recruitment-feed";
const RECRUITMENT_SITE = "https://recruitment.sailfutureacademy.org";

const SOURCE_WORD: Record<LeadEventSource, string> = {
  inquiry: "inquiry",
  camp: "summer camp sign-up",
  visit: "liability waiver visit",
  tasco: "TASCO visit",
  family: "family",
};

function todayEastern() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

/**
 * "Which recruitment event did this family come from?" — a searchable
 * combobox over every event in the recruitment app
 * (recruitment.sailfutureacademy.org), the one place events live.
 * Apply stores only the link (lib/lead-events.ts).
 *
 * `variant="field"` sits in a lead sheet's details block with a small
 * label; `variant="button"` sits in the family page's header row.
 *
 * On a family with no event of its own, the event of a lead it
 * converted from shows through ("via inquiry") until one is picked.
 */
export function RecruitmentEventPicker({
  source,
  id,
  variant = "field",
}: {
  source: LeadEventSource;
  id: number;
  variant?: "field" | "button";
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: links, mutate: mutateLinks } = useSWR<LeadEventLink[]>(
    id > 0 ? LINKS_KEY : null,
    adminFetcher,
    { revalidateOnFocus: false }
  );
  // The events load only once the picker opens.
  const {
    data: events,
    error: feedError,
    isLoading: feedLoading,
  } = useSWR<RecruitmentEvent[]>(open ? FEED_KEY : null, adminFetcher, {
    revalidateOnFocus: false,
  });
  // A family inherits the event of a lead it converted from. Same key
  // as the header's LinkedLeadsButton, so SWR shares the one request.
  const { data: familyLeads } = useSWR<AllLeadRow[]>(
    source === "family" && id > 0
      ? `/api/admin/all-leads?familyId=${id}`
      : null,
    adminFetcher,
    { revalidateOnFocus: false }
  );

  const rows = Array.isArray(links) ? links : [];
  const own =
    rows
      .filter((r) => r.lead_source === source && Number(r.lead_id) === id)
      .sort((a, b) => b.created_at - a.created_at)[0] ?? null;
  const inherited =
    !own && source === "family" && Array.isArray(familyLeads)
      ? (familyLeads
          .map((l) =>
            rows.find(
              (r) =>
                r.lead_source === l.source && Number(r.lead_id) === l.id
            )
          )
          .find(Boolean) ?? null)
      : null;
  const shown = own ?? inherited;

  const groups = useMemo(() => {
    const list = Array.isArray(events) ? events : [];
    const today = todayEastern();
    const past = list
      .filter((e) => e.date && e.date <= today)
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    const upcoming = list
      .filter((e) => e.date && e.date > today)
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    const undated = list
      .filter((e) => !e.date)
      .sort((a, b) => a.title.localeCompare(b.title));
    return [
      { label: "Past events", items: past },
      { label: "Upcoming", items: upcoming },
      { label: "No date yet", items: undated },
    ].filter((g) => g.items.length > 0);
  }, [events]);

  async function save(ev: RecruitmentEvent | null) {
    setOpen(false);
    setSaving(true);
    try {
      const res = await fetch(LINKS_KEY, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          id,
          event: ev ? { id: ev.id, title: ev.title, date: ev.date } : null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Save failed (${res.status})`);
      // Keep the spinner until the refreshed link is on screen.
      await mutateLinks();
      toast.success(ev ? `Linked to ${ev.title}.` : "Event removed.");
    } catch (err) {
      console.error("[RecruitmentEventPicker.save]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save the event.");
    } finally {
      setSaving(false);
    }
  }

  const label = shown ? (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={cn("truncate", !own && "text-muted-foreground")}>
        {shown.event_title || shown.event_id}
      </span>
      {shown.event_date ? (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatDateUs(shown.event_date)}
        </span>
      ) : null}
      {!own && inherited ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          via {SOURCE_WORD[inherited.lead_source]}
        </span>
      ) : null}
    </span>
  ) : (
    <span className="truncate text-muted-foreground">
      {variant === "button" ? "Recruitment event…" : "Link to event…"}
    </span>
  );

  const trigger = (
    <PopoverTrigger asChild>
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        aria-label="Recruitment event"
        disabled={saving || id <= 0}
        size={variant === "button" ? "sm" : "default"}
        className={cn(
          "justify-between bg-white font-normal",
          variant === "field"
            ? "h-8 w-full min-w-0 px-2"
            : "max-w-80 min-w-0"
        )}
        title={
          shown
            ? `${shown.event_title}${shown.linked_by ? ` — linked by ${shown.linked_by}` : ""}`
            : undefined
        }
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {saving ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
          ) : variant === "button" ? (
            <CalendarDays className="size-3.5 shrink-0" />
          ) : null}
          {label}
        </span>
        <ChevronsUpDown className="ml-1 size-3.5 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
  );

  const picker = (
    <Popover open={open} onOpenChange={setOpen}>
      {trigger}
      <PopoverContent className="w-96 max-w-[calc(100vw-2rem)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search events by name, place, or host…" />
          <CommandList className="max-h-80">
            <CommandEmpty>
              {feedLoading
                ? "Loading events…"
                : feedError
                  ? feedError instanceof Error
                    ? feedError.message
                    : "Couldn't load the events."
                  : "No event found."}
            </CommandEmpty>
            {own ? (
              <CommandGroup>
                <CommandItem
                  value="__clear remove unlink no event"
                  onSelect={() => void save(null)}
                >
                  <Undo2 className="size-3.5 text-muted-foreground" />
                  <span className="text-sm">Remove the event</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            {groups.map((g) => (
              <CommandGroup key={g.label} heading={g.label}>
                {g.items.map((e) => (
                  <CommandItem
                    key={e.id}
                    value={`${e.title} ${e.venue ?? ""} ${e.hosts ?? ""} ${e.zip ?? ""} ${e.date ? formatDateUs(e.date) : ""} ${e.id}`}
                    onSelect={() => void save(e)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{e.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[
                          e.date
                            ? `${formatDateUs(e.date)}${e.estimated ? " (est.)" : ""}`
                            : null,
                          e.venue,
                        ]
                          .filter(Boolean)
                          .join(" · ") || e.hosts}
                      </p>
                    </div>
                    {e.attended ? (
                      <Badge className="shrink-0 bg-emerald-100 px-1.5 py-0 text-[10px] font-medium text-emerald-800">
                        Attended
                      </Badge>
                    ) : e.status === "going" ? (
                      <Badge className="shrink-0 bg-emerald-50 px-1.5 py-0 text-[10px] font-medium text-emerald-700">
                        Going
                      </Badge>
                    ) : null}
                    {own?.event_id === e.id ? (
                      <Check className="size-3.5 shrink-0" />
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <a
            href={RECRUITMENT_SITE}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 border-t px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-3" />
            Events are managed on the recruitment site
          </a>
        </Command>
      </PopoverContent>
    </Popover>
  );

  if (variant === "button") return picker;
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] text-muted-foreground">Recruitment event</p>
      {picker}
    </div>
  );
}
