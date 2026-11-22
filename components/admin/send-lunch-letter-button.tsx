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
 * "Send lunch letter": emails the family's primary parent a PandaDoc
 * signing link for the free and reduced lunch letter. For families who
 * are past the registration steps (already submitted or enrolled) and so
 * will never meet the step in the portal. Sibling of
 * `SendLiabilityWaiverButton`; confirms first because it puts a document
 * in a family's inbox.
 */
export function SendLunchLetterButton({
  familyId,
  yearId,
  familyName,
  recipientEmail,
  recipientName,
  alreadySent,
  onSent,
}: {
  familyId: number;
  yearId: number;
  familyName: string;
  /** Display only: the server resolves the real recipient itself. */
  recipientEmail: string;
  recipientName?: string;
  /** An envelope is already out, so this is a resend. */
  alreadySent: boolean;
  /** Refetch hook, awaited before the spinner clears so the button
   *  doesn't go idle above a card still showing the old state. */
  onSent?: () => void | Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const label = alreadySent ? "Resend lunch letter" : "Send lunch letter";

  async function run() {
    setSending(true);
    try {
      const res = await fetch("/api/admin/pandadoc/send-lunch-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId, yearId }),
      });
      const body = (await res.json().catch(() => null)) as {
        sentTo?: string;
        cc?: string[];
        error?: string;
      } | null;
      if (!res.ok) {
        // A 409 means it turned out to be signed already: the server
        // refreshed the row, so show that state rather than a stale card.
        if (res.status === 409) await onSent?.();
        throw new Error(
          body?.error ?? `Couldn't send the lunch letter (${res.status})`
        );
      }
      const cc = body?.cc ?? [];
      toast.success(
        `Lunch letter sent to ${body?.sentTo ?? recipientEmail}.` +
          (cc.length ? ` Copied to ${cc.join(", ")}.` : "")
      );
      setOpen(false);
      await onSent?.();
    } catch (err) {
      console.error("[SendLunchLetterButton]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't send the lunch letter."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={alreadySent ? "outline" : "default"}
        className={alreadySent ? "bg-white" : undefined}
        disabled={sending || !recipientEmail}
        onClick={() => setOpen(true)}
        title={
          recipientEmail
            ? `${label} to ${recipientEmail}`
            : "No primary parent email on file to send the lunch letter to"
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
              {alreadySent ? "Resend" : "Send"} the {familyName} lunch letter?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  PandaDoc will email a signing link to{" "}
                  <span className="font-medium text-foreground">
                    {recipientName ? `${recipientName} · ` : ""}
                    {recipientEmail}
                  </span>
                  . They can complete it from the email with no portal login,
                  and the admissions inbox is copied.
                </p>
                {alreadySent ? (
                  <p>
                    The lunch letter already out for this family will be
                    cancelled, so only the new link works.
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={sending}
              onClick={(e) => {
                // Stay mounted through the request: the PandaDoc chain
                // takes a few seconds.
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
                <>Yes, {alreadySent ? "resend" : "send"} it</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
