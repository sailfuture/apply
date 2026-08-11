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
  const label = templateLabel(row.template);
  // Subject repeats the label on several templates ("Records
  // request" → "Records request — Ta'Quan Howard"); drop it when it
  // adds nothing so the one line we have goes to the part that
  // differs between rows.
  const subject = (row.subject ?? "").trim();
  const showSubject = subject && subject.toLowerCase() !== label.toLowerCase();
  const recipients = recipientList.length > 0 ? recipientList.join(", ") : "—";
  const ccLine = row.cc_emails?.trim() ?? "";
  const recipientTitle = ccLine ? `${recipients}\nCC: ${ccLine}` : recipients;

  // One line per row. Every cell that can overflow truncates rather
  // than wraps, with the full value on hover — `max-w-0` is what
  // makes `truncate` work inside a table cell, since an auto-width
  // cell grows to fit its content instead of clipping it.
  return (
    <tr className="hover:bg-muted/20">
      <td className="px-4 py-2 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
        {dateStr}
      </td>
      <td className="px-4 py-2 max-w-0 w-1/2">
        <div className="truncate" title={showSubject ? subject : label}>
          <span className="font-medium text-sm">{label}</span>
          {showSubject ? (
            <span className="text-xs text-muted-foreground">
              {" · "}
              {subject}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-2 max-w-0 w-1/2">
        <div className="truncate text-xs" title={recipientTitle}>
          {recipients}
          {ccLine ? (
            <span className="text-muted-foreground">
              {" · CC: "}
              {ccLine}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-2 whitespace-nowrap">
        {/* The error moves onto the pill's tooltip — it's the only
            field that can't fit, and losing the row height everywhere
            to a case that's usually absent isn't worth it. The pill
            still reads Failed / Sent at a glance.

            An `error_message` on a row that ISN'T failed is a bounce
            that didn't sink the send (one recipient of several, or a
            transient one). That gets its own amber marker rather than
            being hidden — the send succeeded, but somebody on it may
            not have received it. */}
        <span className="inline-flex items-center gap-1.5">
          <StatusPill
            status={row.status}
            title={row.error_message || undefined}
          />
          {row.status !== "failed" && row.error_message ? (
            <span
              className="cursor-help text-[10px] font-medium uppercase tracking-wide text-amber-600"
              title={row.error_message}
            >
              Delivery issue
            </span>
          ) : null}
        </span>
      </td>
    </tr>
  );
}

function StatusPill({ status, title }: { status: string; title?: string }) {
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
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1",
        config.tone,
        title && "cursor-help"
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
    case "draft-reminder":
      return "Draft reminder";
    case "enrollment-reminder":
      return "Enrollment agreement reminder";
    case "back-to-school":
      return "Back-to-school";
    case "records-request":
      return "Records request";
    default:
      return tag;
  }
}
