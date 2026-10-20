"use client";

import useSWR from "swr";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { adminFetcher } from "@/lib/admin-fetcher";
import type { EmailPreviewResponse } from "@/app/api/admin/email-preview/route";

/**
 * Admin view of one sent email, exactly as it went out.
 *
 * Keyed by the audit row (`notificationId`) when the caller has one —
 * the route serves our stored HTML copy, which never expires — and by
 * Resend message id otherwise (older activity rows). Rendered in a
 * sandboxed iframe via `srcDoc`: no scripts, no navigation, so the
 * template HTML displays as the family received it without running
 * anything.
 *
 * `subject`, `sentAt` and `recipients` are what the caller already
 * knows from the row, so the header is readable while the body loads
 * and even when the fetch fails.
 */
export interface EmailPreviewTarget {
  notificationId?: number;
  resendId?: string;
  subject: string;
  /** Unix ms. */
  sentAt?: number;
  /** Comma-separated To addresses. */
  recipients?: string;
  /** Comma-separated Cc addresses. */
  cc?: string;
}

export function EmailPreviewDialog({
  preview,
  onClose,
}: {
  preview: EmailPreviewTarget | null;
  onClose: () => void;
}) {
  const key = preview
    ? preview.notificationId
      ? `/api/admin/email-preview?notificationId=${preview.notificationId}`
      : preview.resendId
        ? `/api/admin/email-preview?id=${encodeURIComponent(preview.resendId)}`
        : null
    : null;

  const { data, error, isLoading } = useSWR<EmailPreviewResponse>(
    key,
    adminFetcher,
    // A 410 (aged out of Resend) is permanent; retrying only delays
    // the explanation.
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const subject = data?.subject || preview?.subject || "Email";
  const sentAt = data?.createdAt
    ? new Date(data.createdAt)
    : preview?.sentAt
      ? new Date(preview.sentAt)
      : null;
  const to = data?.to || preview?.recipients || "";
  const cc = data?.cc || preview?.cc || "";
  const metaParts = [
    sentAt && !Number.isNaN(sentAt.getTime())
      ? sentAt.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : null,
    to ? `To ${to}` : null,
    cc ? `Cc ${cc}` : null,
  ].filter(Boolean);

  return (
    <Dialog open={preview !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle className="text-base">{subject}</DialogTitle>
          <DialogDescription className="text-xs">
            {metaParts.length > 0 ? metaParts.join(" · ") : "Sent email"}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden bg-muted/20">
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : error || !data ? (
            <div className="flex h-64 items-center justify-center px-8 text-center">
              <p className="text-sm text-muted-foreground">
                {error instanceof Error
                  ? error.message
                  : "Couldn't load this email."}
              </p>
            </div>
          ) : data.html ? (
            <iframe
              title="Sent email preview"
              srcDoc={data.html}
              sandbox=""
              className="h-[65vh] w-full border-0 bg-white"
            />
          ) : (
            <div className="h-[65vh] overflow-y-auto whitespace-pre-wrap bg-white px-5 py-4 text-sm">
              {data.text || "This email has no stored content."}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
