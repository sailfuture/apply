"use client";

import useSWR from "swr";
import { CheckCircle2, Mail, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import type { XanoEmailNotification } from "@/lib/xano";

/**
 * Admin "Sent emails" card. Shows the audit log for every Resend
 * send attempt scoped to a (family, year). Rendered on the family
 * registration detail page below the section list so admin can
 * confirm what's been delivered.
 *
 * Reads from `/api/admin/email-notifications?familyId=&yearId=` —
 * the underlying Xano table is `registration_email_notifications`,
 * written by `lib/emails/send.ts` after every send.
 */

interface Props {
  familyId: number;
  yearId: number;
}

interface Response {
  rows: XanoEmailNotification[];
}

export function EmailNotificationsCard({ familyId, yearId }: Props) {
  const endpoint = `/api/admin/email-notifications?familyId=${familyId}&yearId=${yearId}`;
  const { data, error, isLoading, mutate } = useSWR<Response>(
    endpoint,
    adminFetcher,
    { revalidateOnFocus: false }
  );

  const rows = data?.rows ?? [];

  return (
    <div className="rounded-md border bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">Sent emails</p>
          {!isLoading && !error ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {rows.length}
            </span>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() => mutate()}
          disabled={isLoading}
        >
          <RefreshCw className="size-3 mr-1.5" aria-hidden="true" />
          Refresh
        </Button>
      </div>
      {isLoading ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          Loading sent emails…
        </div>
      ) : error ? (
        <div className="px-4 py-6 text-sm text-red-700 bg-red-50 border-t border-red-200">
          Couldn&rsquo;t load the email log:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          No emails sent yet for this family and year. Status-driven
          notifications fire automatically when admin or the parent
          flips an application status (received, accepted, denied,
          registration submitted, enrolled); reminder emails run on
          the daily cron.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                Sent
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                Template
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                Recipients
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Row({ row }: { row: XanoEmailNotification }) {
  const date = new Date(row.created_at);
  const dateStr = date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const recipientList = row.recipient_emails
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <tr className="hover:bg-muted/20">
      <td className="px-4 py-3 align-top whitespace-nowrap text-xs tabular-nums text-muted-foreground">
        {dateStr}
      </td>
      <td className="px-4 py-3 align-top">
        <div className="font-medium text-sm">{templateLabel(row.template)}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {row.subject}
        </div>
      </td>
      <td className="px-4 py-3 align-top">
        <div className="text-xs">
          {recipientList.length > 0 ? recipientList.join(", ") : "—"}
        </div>
        {row.cc_emails ? (
          <div className="text-[11px] text-muted-foreground mt-0.5">
            CC: {row.cc_emails}
          </div>
        ) : null}
      </td>
      <td className="px-4 py-3 align-top">
        <StatusPill status={row.status} />
        {row.status === "failed" && row.error_message ? (
          <div className="text-[11px] text-red-700 mt-1">
            {row.error_message}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: string }) {
  const config = (() => {
    switch (status) {
      case "sent":
        return {
          label: "Sent",
          tone: "bg-emerald-50 text-emerald-700 ring-emerald-200",
          Icon: CheckCircle2,
        };
      case "failed":
        return {
          label: "Failed",
          tone: "bg-red-50 text-red-700 ring-red-200",
          Icon: XCircle,
        };
      case "dry_run":
        return {
          label: "Dry run",
          tone: "bg-muted text-muted-foreground ring-border",
          Icon: Mail,
        };
      default:
        return {
          label: status,
          tone: "bg-muted text-muted-foreground ring-border",
          Icon: Mail,
        };
    }
  })();
  const Icon = config.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1",
        config.tone
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {config.label}
    </span>
  );
}

/** Map the template `tag` used in `lib/emails/send.ts` to a
 *  human-friendly label. New templates added in
 *  `lib/emails/templates.ts` should also get a label here so the
 *  table doesn't fall back to the raw kebab-case tag. */
function templateLabel(tag: string): string {
  switch (tag) {
    case "application-received":
      return "Application received";
    case "accepted":
      return "Accepted";
    case "registration-received":
      return "Registration received";
    case "enrolled":
      return "Officially enrolled";
    case "not-accepted":
      return "Not accepted";
    case "draft-reminder":
      return "Draft reminder";
    case "enrollment-reminder":
      return "Enrollment agreement reminder";
    case "back-to-school":
      return "Back-to-school";
    default:
      return tag;
  }
}
