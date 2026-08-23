"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Keeps a pending liability waiver honest against PandaDoc.
 *
 * The webhook is what normally carries a signature back into the
 * portal, and for a waiver admin emailed it is the ONLY thing that
 * does — the parent signs on PandaDoc's own page and never opens the
 * app, so none of the parent-side polling ever runs. One missed
 * delivery and the card reads "Sent" forever over a signed PDF.
 *
 * This closes that: whenever the card renders a pending envelope it
 * asks PandaDoc directly (once per mount, silently) and syncs the
 * packet row, so simply opening the student heals the state. The
 * button is the same call on demand, for when admin knows a parent
 * just signed and doesn't want to wait on a reload.
 *
 * Renders nothing when there's no envelope to check.
 */
export function WaiverSignatureCheck({
  studentId,
  yearId,
  pandadocId,
  status,
  onChanged,
}: {
  studentId: number;
  yearId: number;
  /** Envelope currently on the packet. No id → nothing to check. */
  pandadocId: string;
  /** Current `liability_waiver_status`. A completed waiver needs no
   *  checking — the signature is already recorded. */
  status?: string | null;
  /** Refetch hook, awaited so the spinner outlives the stale render. */
  onChanged?: () => void | Promise<unknown>;
}) {
  const [checking, setChecking] = useState(false);
  // One automatic check per mount. Without this the refetch that a
  // successful sync triggers would re-render the card and fire the
  // effect again.
  const autoChecked = useRef(false);

  const pending = !!pandadocId && status !== "completed";

  const check = useCallback(
    async (manual: boolean) => {
      setChecking(true);
      try {
        const res = await fetch("/api/admin/pandadoc/waiver-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId, yearId }),
        });
        const body = (await res.json().catch(() => null)) as
          | { status?: string; changed?: boolean; error?: string }
          | null;
        if (!res.ok) {
          throw new Error(
            body?.error ?? `Couldn't check the waiver (${res.status})`
          );
        }
        if (body?.changed) {
          if (body.status === "completed") {
            toast.success("Waiver signed — the signed PDF is now on file.");
          } else if (body.status === "missing") {
            toast.warning(
              "That waiver no longer exists in PandaDoc. Send a new one."
            );
          }
          await onChanged?.();
        } else if (manual) {
          // Only speak up on an explicit click. The automatic check
          // finding nothing is the common case and doesn't deserve a
          // toast on every page view.
          toast.info("No change yet — the family hasn't signed.");
        }
      } catch (err) {
        console.error("[WaiverSignatureCheck]", err);
        // Silent on the automatic pass: a PandaDoc hiccup shouldn't
        // throw an error toast at admin for something they didn't ask
        // for. The button surfaces failures normally.
        if (manual) {
          toast.error(
            err instanceof Error ? err.message : "Couldn't check the waiver."
          );
        }
      } finally {
        setChecking(false);
      }
    },
    [studentId, yearId, onChanged]
  );

  useEffect(() => {
    if (!pending || autoChecked.current) return;
    autoChecked.current = true;
    void check(false);
  }, [pending, check]);

  if (!pending) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={checking}
      onClick={() => void check(true)}
      className="bg-white"
      title="Ask PandaDoc whether this waiver has been signed yet"
    >
      {checking ? (
        <Loader2 className="size-3.5 mr-1.5 animate-spin" />
      ) : (
        <RefreshCw className="size-3.5 mr-1.5" />
      )}
      Check for signature
    </Button>
  );
}
