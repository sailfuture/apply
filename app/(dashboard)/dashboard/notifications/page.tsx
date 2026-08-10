"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Bell, Loader2, Mail } from "lucide-react";
import { DashboardPageHeader } from "@/components/dashboard-page-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetcher } from "@/hooks/use-api";
import { getLocalReadAt, setLocalReadAt } from "@/lib/notifications";
import { formatUSPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type {
  ParentNotificationEntry,
  ParentNotificationsResponse,
} from "@/app/api/notifications/route";
import type { ParentEmailContent } from "@/app/api/notifications/email/[id]/route";

type Filter = "all" | "email" | "sms";

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(ms) === dayKey(today.getTime())) return "Today";
  if (dayKey(ms) === dayKey(yesterday.getTime())) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

/**
 * Notifications & Messages — messenger-style activity log of every
 * email and text the school has sent the family (plus their text
 * replies), grouped by day, NEWEST first — the latest message is at
 * the top on load and scrolling down walks back through history
 * (feed order, not chat order: parents come here to see what's new,
 * not to re-read June).
 * Emails open in a viewer dialog with the full delivered content
 * (fetched from Resend). Opening the page stamps the family's read
 * watermark, clearing the dashboard's unread badge.
 */
export default function NotificationsPage() {
  const searchParams = useSearchParams();
  const yearIdParam = searchParams.get("yearId");
  const dashboardHref = yearIdParam
    ? `/dashboard?yearId=${yearIdParam}`
    : "/dashboard";

  const { data, mutate } = useSWR<ParentNotificationsResponse>(
    "/api/notifications",
    apiFetcher,
    { revalidateOnFocus: true, dedupingInterval: 10000 }
  );

  const [filter, setFilter] = useState<Filter>("all");
  const [emailView, setEmailView] = useState<ParentNotificationEntry | null>(
    null
  );
  const smsNumber = data?.sms_number ?? "";

  // Freeze the read watermark as it was BEFORE this visit stamps it,
  // so the "new" highlights stay visible for the whole session.
  // Guarded set-state-during-render (React's documented pattern for
  // deriving state from the first arrival of data) — runs exactly
  // once, when `data` first resolves.
  const [watermark, setWatermark] = useState<number | null>(null);
  if (data && watermark === null) {
    setWatermark(Math.max(data.read_at || 0, getLocalReadAt()));
  }

  const stampedRef = useRef(false);
  useEffect(() => {
    if (!data || stampedRef.current) return;
    stampedRef.current = true;
    // Mark everything read: local mirror immediately (clears the
    // dashboard badge on this device), server stamp best-effort
    // (clears it everywhere once the Xano column is wired).
    setLocalReadAt(Date.now());
    void fetch("/api/notifications/read", { method: "POST" })
      .then(() => mutate())
      .catch(() => {});
  }, [data, mutate]);

  const counts = useMemo(() => {
    const all = data?.entries ?? [];
    return {
      email: all.filter((e) => e.kind === "email").length,
      sms: all.filter((e) => e.kind === "sms").length,
    };
  }, [data]);

  // Feed order: newest first, grouped by day (today's divider on
  // top, each day's latest message first). Older messages are a
  // scroll down, not a hunt.
  const dayGroups = useMemo(() => {
    const filtered = (data?.entries ?? [])
      .filter((e) => filter === "all" || e.kind === filter)
      .slice()
      .sort((a, b) => b.at - a.at);
    const groups: { key: string; label: string; items: ParentNotificationEntry[] }[] =
      [];
    for (const e of filtered) {
      const k = dayKey(e.at);
      const last = groups[groups.length - 1];
      if (last && last.key === k) last.items.push(e);
      else groups.push({ key: k, label: dayLabel(e.at), items: [e] });
    }
    return groups;
  }, [data, filter]);

  const loading = !data;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
      <DashboardPageHeader
        backHref={dashboardHref}
        backLabel="Back to Dashboard"
        breadcrumb={[
          { label: "Dashboard", href: dashboardHref },
          { label: "Notifications" },
        ]}
        title="Notifications & Messages"
        subtitle="Every email and text message from the school, plus your replies — one running conversation."
      />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-7 w-64 rounded-full" />
          <Skeleton className="h-14 w-3/4 rounded-2xl" />
          <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
          <Skeleton className="h-16 w-2/3 rounded-2xl" />
          <Skeleton className="h-14 w-3/4 rounded-2xl" />
        </div>
      ) : (data?.entries.length ?? 0) === 0 ? (
        <div className="rounded-xl border bg-white px-6 py-12 text-center">
          <Bell className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing here yet — emails and text messages from the school
            will appear as they&rsquo;re sent.
          </p>
        </div>
      ) : (
        <>
          {/* Filter pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip
              on={filter === "all"}
              onClick={() => setFilter("all")}
              label={`All (${counts.email + counts.sms})`}
            />
            <FilterChip
              on={filter === "email"}
              onClick={() => setFilter("email")}
              label={`Emails (${counts.email})`}
            />
            <FilterChip
              on={filter === "sms"}
              onClick={() => setFilter("sms")}
              label={`Text messages (${counts.sms})`}
            />
          </div>

          {/* Messenger log */}
          <div className="space-y-6">
            {dayGroups.map((g) => (
              <div key={g.key} className="space-y-3">
                {/* Day divider */}
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {g.label}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                {g.items.map((e) => (
                  <EntryBubble
                    key={e.key}
                    entry={e}
                    unread={watermark !== null && e.at > watermark}
                    onOpenEmail={() => setEmailView(e)}
                  />
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {emailView ? (
        <EmailViewerDialog
          key={emailView.key}
          entry={emailView}
          onClose={() => setEmailView(null)}
        />
      ) : null}

      <p className="text-xs text-muted-foreground text-center pt-4 border-t">
        Need to reach us?{" "}
        {smsNumber ? (
          <>
            Text us at{" "}
            <a
              href={`sms:${smsNumber}`}
              className="text-primary underline underline-offset-2"
            >
              {formatUSPhone(smsNumber)}
            </a>{" "}
            (replies come straight to this thread), or email{" "}
          </>
        ) : (
          <>Text this thread back from your phone, or email{" "}</>
        )}
        <a
          href="mailto:dean@sailfuture.org"
          className="text-primary underline underline-offset-2"
        >
          dean@sailfuture.org
        </a>
        .
      </p>
    </div>
  );
}

function FilterChip({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
        on
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

/**
 * One log entry, messenger-style: school messages sit left (email =
 * card bubble that opens the full email; SMS = plain bubble), the
 * family's text replies sit right in the primary color. Unread
 * entries from before this visit carry a blue dot.
 */
function EntryBubble({
  entry,
  unread,
  onOpenEmail,
}: {
  entry: ParentNotificationEntry;
  unread: boolean;
  onOpenEmail: () => void;
}) {
  const isReply = entry.direction === "inbound";

  if (entry.kind === "email") {
    return (
      <div className="flex justify-start">
        <button
          type="button"
          onClick={onOpenEmail}
          disabled={entry.email_id === null}
          className={cn(
            "group max-w-[85%] rounded-2xl rounded-tl-sm border bg-white px-4 py-3 text-left shadow-sm transition-colors sm:max-w-[70%]",
            entry.email_id !== null
              ? "cursor-pointer hover:border-foreground/30 hover:bg-muted/20"
              : "cursor-default"
          )}
        >
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Mail className="size-3.5" />
            Email
            {unread ? (
              <span className="size-1.5 rounded-full bg-blue-500" aria-label="New" />
            ) : null}
          </p>
          <p className="mt-1 text-sm font-medium">{entry.subject}</p>
          <p className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              {entry.email_id !== null ? (
                <span className="text-primary underline-offset-2 group-hover:underline">
                  Read email
                </span>
              ) : (
                "Sent by email"
              )}
            </span>
            <span className="tabular-nums">{fmtTime(entry.at)}</span>
          </p>
        </button>
      </div>
    );
  }

  return (
    <div className={cn("flex", isReply ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm sm:max-w-[70%]",
          isReply
            ? "rounded-tr-sm bg-primary text-primary-foreground"
            : "rounded-tl-sm border bg-white"
        )}
      >
        <p className="whitespace-pre-wrap">{entry.body}</p>
        <p
          className={cn(
            "mt-1 flex items-center justify-end gap-1.5 text-[10px] tabular-nums",
            isReply ? "text-primary-foreground/70" : "text-muted-foreground"
          )}
        >
          {unread && !isReply ? (
            <span className="size-1.5 rounded-full bg-blue-500" aria-label="New" />
          ) : null}
          {fmtTime(entry.at)}
        </p>
      </div>
    </div>
  );
}

/**
 * Email-content fetcher that preserves the server's message. The
 * shared `apiFetcher` collapses every failure to "API error <status>",
 * but this endpoint's 410 ("no longer available — we only keep the
 * full message for a short time") is copy the parent should actually
 * read.
 */
const emailFetcher = async (url: string): Promise<ParentEmailContent> => {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (body as { error?: string } | null)?.error ??
        `Couldn't load this email (${res.status}).`
    );
  }
  return body as ParentEmailContent;
};

/** Full delivered email content, fetched from Resend and rendered in
 *  a sandboxed iframe (no scripts). */
function EmailViewerDialog({
  entry,
  onClose,
}: {
  entry: ParentNotificationEntry;
  onClose: () => void;
}) {
  const { data, error } = useSWR<ParentEmailContent>(
    entry.email_id !== null ? `/api/notifications/email/${entry.email_id}` : null,
    emailFetcher,
    // A 410 (content aged out of Resend's retention) is permanent —
    // retrying just delays the explanation.
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle className="text-base">{entry.subject}</DialogTitle>
          <DialogDescription className="text-xs">
            {new Date(entry.at).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            {entry.recipients
              ? ` · Sent to ${entry.recipients.split(",").join(", ")}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden bg-muted/20">
          {error ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-muted-foreground">
                {error instanceof Error
                  ? error.message
                  : "Couldn't load this email."}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="bg-white"
                onClick={onClose}
              >
                Close
              </Button>
            </div>
          ) : !data ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : data.html ? (
            // Sandboxed (no scripts, no navigation) — the HTML is
            // exactly what Resend delivered to their inbox.
            <iframe
              sandbox=""
              srcDoc={data.html}
              title={data.subject}
              className="h-[65vh] w-full border-0 bg-white"
            />
          ) : (
            <div className="h-[65vh] overflow-y-auto whitespace-pre-wrap bg-white px-5 py-4 text-sm">
              {data.text || "This email has no viewable content."}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
