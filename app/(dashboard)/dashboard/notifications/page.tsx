"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Bell, Mail, MessageSquare, Reply } from "lucide-react";
import { DashboardPageHeader } from "@/components/dashboard-page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetcher } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import type {
  ParentNotificationEntry,
  ParentNotificationsResponse,
} from "@/app/api/notifications/route";

type Filter = "all" | "email" | "sms";

function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Notifications & Messages — the family's own communications log.
 * Every email the school has sent them and their full text-message
 * thread, merged newest-first with Email / Text filter pills.
 * Read-only; replies happen over text or email as usual.
 */
export default function NotificationsPage() {
  const searchParams = useSearchParams();
  const yearIdParam = searchParams.get("yearId");
  const dashboardHref = yearIdParam
    ? `/dashboard?yearId=${yearIdParam}`
    : "/dashboard";

  const { data } = useSWR<ParentNotificationsResponse>(
    "/api/notifications",
    apiFetcher,
    { revalidateOnFocus: true, dedupingInterval: 10000 }
  );

  const [filter, setFilter] = useState<Filter>("all");
  const entries = useMemo(() => {
    const all = data?.entries ?? [];
    if (filter === "all") return all;
    return all.filter((e) => e.kind === filter);
  }, [data, filter]);

  const counts = useMemo(() => {
    const all = data?.entries ?? [];
    return {
      email: all.filter((e) => e.kind === "email").length,
      sms: all.filter((e) => e.kind === "sms").length,
    };
  }, [data]);

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
        subtitle="Every email and text message the school has sent your family, plus your replies — newest first."
      />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-64 rounded-full" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
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

          {/* Timeline */}
          <div className="rounded-xl bg-background p-1.5 shadow-sm border">
            <div className="overflow-hidden rounded-lg border bg-white divide-y">
              {entries.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No {filter === "email" ? "emails" : "text messages"} yet.
                </p>
              ) : (
                entries.map((e) => <EntryRow key={e.key} entry={e} />)
              )}
            </div>
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground text-center pt-4 border-t">
        Need to reach us? Text this thread back from your phone, or email{" "}
        <a
          href="mailto:tward@sailfuture.org"
          className="text-primary underline underline-offset-2"
        >
          tward@sailfuture.org
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

/** One log row — icon bubble, title + preview, timestamp. */
function EntryRow({ entry }: { entry: ParentNotificationEntry }) {
  const isEmail = entry.kind === "email";
  const isReply = entry.direction === "inbound";
  return (
    <div className="flex gap-3 px-4 py-3">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          isEmail
            ? "bg-violet-50 text-violet-600"
            : isReply
              ? "bg-muted text-muted-foreground"
              : "bg-sky-50 text-sky-600"
        )}
      >
        {isEmail ? (
          <Mail className="size-4" />
        ) : isReply ? (
          <Reply className="size-4" />
        ) : (
          <MessageSquare className="size-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-medium">
            {isEmail
              ? entry.subject
              : isReply
                ? "Your reply"
                : "Text from SailFuture Academy"}
          </p>
          <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {fmtDateTime(entry.at)}
          </p>
        </div>
        {isEmail ? (
          entry.recipients ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Sent to {entry.recipients.split(",").join(", ")}
            </p>
          ) : null
        ) : (
          <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">
            {entry.body}
          </p>
        )}
      </div>
    </div>
  );
}
