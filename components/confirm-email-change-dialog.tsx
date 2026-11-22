"use client";

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
 * Confirmation before a parent changes their own email on the Family or
 * Registration step.
 *
 * That email is also what they sign in with, and the change takes
 * effect at once with no verification message, so a slip of the keyboard
 * could lock them out. The forms used to apply it on blur (and the
 * registration step on its autosave timer, mid-typing). Now the field
 * only proposes the change; this dialog is what commits it, and the API
 * ignores a changed sign-in email that doesn't carry
 * `confirm_email_change: true`.
 *
 * Open while `to` is set. The caller closes it (by clearing `to`) once
 * the save has finished — the action button does not close it on click,
 * so the dialog stays up, disabled, for the duration of the save.
 */
export function ConfirmEmailChangeDialog({
  from,
  to,
  busy,
  onConfirm,
  onCancel,
}: {
  /** The current sign-in email. */
  from: string;
  /** The proposed one, or null when nothing is pending. */
  to: string | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog
      open={to !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Change your sign-in email?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                You sign in with{" "}
                <span className="font-medium text-foreground break-all">
                  {from || "your current email"}
                </span>
                . After this change you will sign in with{" "}
                <span className="font-medium text-foreground break-all">
                  {to}
                </span>
                , and emails from the school will go there.
              </p>
              <p>
                Please check the new address carefully. If it is mistyped
                you won&apos;t be able to sign in.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep current email</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              // Stay open until the save has finished (the caller
              // closes the dialog); Radix would close it on click.
              e.preventDefault();
              onConfirm();
            }}
          >
            {busy ? "Changing…" : "Change email"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
