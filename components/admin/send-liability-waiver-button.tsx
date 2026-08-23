"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
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

/**
 * "Send liability waiver" — the admin escape hatch for a student
 * whose registration reached enrollment without a signed waiver.
 *
 * POSTs to `/api/admin/pandadoc/send-waiver`, which creates the
 * envelope and has PandaDoc email the primary parent a signing link.
 * No portal login needed on their end, which is the point: by the
 * time admin notices a missing waiver, the family has usually
 * stopped opening the apply flow.
 *
 * The signed result lands on the same packet columns the parent-side
 * flow writes, so nothing here needs a matching display change — the
 * waiver card flips to its normal Signed state on its own once the
 * webhook fires.
 *
 * Confirms first. This puts a document in a family's inbox, so it
 * isn't a click to fire on a mis-aim, and the dialog names the exact
 * address so admin can catch a wrong primary contact before it goes.
 */
export function SendLiabilityWaiverButton({
  studentId,
  yearId,
  studentName,
  recipientEmail,
  recipientName,
  status,
  onSent,
  size = "sm",
  className,
}: {
  studentId: number;
  yearId: number;
  studentName: string;
  /** Primary parent's address, for the confirm dialog. The server
   *  resolves the real recipient itself — this is display only, so a
   *  stale page can't misdirect the send. */
  recipientEmail: string;
  recipientName?: string;
  /** Current `liability_waiver_status`. Anything non-empty means an
   *  envelope is already out and this becomes a resend. */
  status?: string | null;
  /** Refetch hook. Awaited before the spinner clears so the button
   *  doesn't go idle while the card still shows the old state. */
  onSent?: () => void | Promise<unknown>;
  size?: "sm" | "default";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const isResend = !!status;
  const label = isResend ? "Resend waiver" : "Send waiver";

  async function run() {
    setSending(true);
    try {
      const res = await fetch("/api/admin/pandadoc/send-waiver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, yearId }),
      });
      const body = (await res.json().catch(() => null)) as
        | { sentTo?: string; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(
          body?.error ?? `Couldn't send the waiver (${res.status})`
        );
      }
      toast.success(
        `Liability waiver sent to ${body?.sentTo ?? recipientEmail}.`
      );
      setOpen(false);
      // Await the refetch before dropping the spinner — the card
      // reads its status straight off the packet, and clearing early
      // leaves an idle button above a stale "Not started".
      await onSent?.();
    } catch (err) {
      console.error("[SendLiabilityWaiverButton]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't send the waiver."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={isResend ? "outline" : "default"}
        disabled={sending || !recipientEmail}
        onClick={() => setOpen(true)}
        className={className}
        title={
          recipientEmail
            ? `${label} to ${recipientEmail}`
            : "No primary parent email on file to send the waiver to"
        }
      >
        {sending ? (
          <Loader2 className="size-3.5 mr-1.5 animate-spin" />
        ) : (
          <Send className="size-3.5 mr-1.5" />
        )}
        {label}
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!sending) setOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isResend ? "Resend" : "Send"} {studentName}&rsquo;s liability
              waiver?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  PandaDoc will email a signing link to{" "}
                  <span className="font-medium text-foreground">
                    {recipientName ? `${recipientName} · ` : ""}
                    {recipientEmail}
                  </span>
                  . They can sign from the email — no portal login needed.
                </p>
                {isResend ? (
                  <p>
                    The waiver already out for {studentName} will be
                    cancelled, so only the new link works. Send this if the
                    old one was never opened or went to the wrong address.
                  </p>
                ) : null}
                <p>
                  Once signed, it appears here as the signed waiver PDF,
                  same as one the family completed during registration.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={sending}
              onClick={(e) => {
                // Keep the dialog mounted through the request — the
                // PandaDoc chain (create → draft → send) takes a few
                // seconds and the spinner belongs in front of admin.
                e.preventDefault();
                void run();
              }}
            >
              {sending ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Sending…
                </>
              ) : (
                <>Yes, {isResend ? "resend" : "send"} it</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
