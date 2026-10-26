"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Download, Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";

type SigningType = "addition_enrollment_agreement" | "liability_waiver";

/**
 * One PandaDoc document for a mid-year sibling — their own enrollment
 * agreement or liability waiver — signed inline. Same create → embed →
 * poll chain as the apply flow's Enrollment Agreement page, against the
 * same routes: `/api/pandadoc/create` (resumes an open envelope instead
 * of minting another), `/api/pandadoc/status` (syncs the packet when the
 * poll sees "completed"), `/api/pandadoc/download` for the signed copy.
 * The signed state itself lives on the packet; `onSigned` refetches it.
 */
export function PandaDocSigningStep({
  type,
  applicationId,
  yearId,
  documentId,
  signed,
  label,
  onSigned,
}: {
  type: SigningType;
  applicationId: number;
  yearId: number;
  /** Envelope already on the packet, if any (for the signed-copy link). */
  documentId: string | null;
  signed: boolean;
  /** "enrollment agreement" / "liability waiver" — used in copy. */
  label: string;
  onSigned: () => Promise<unknown> | void;
}) {
  const embedId = `pandadoc-embed-${type}`;
  const [starting, setStarting] = useState(false);
  const [session, setSession] = useState<{ sessionId: string; documentId: string } | null>(
    null
  );
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signingRef = useRef<{ destroy: () => void } | null>(null);
  const onSignedRef = useRef(onSigned);
  onSignedRef.current = onSigned;

  const statusUrl = (docId: string) =>
    `/api/pandadoc/status?documentId=${encodeURIComponent(docId)}&applicationId=${applicationId}&type=${type}&yearId=${yearId}`;

  async function finish() {
    if (pollingRef.current) clearTimeout(pollingRef.current);
    pollingRef.current = null;
    setSession(null);
    await onSignedRef.current();
    toast.success(`${label[0].toUpperCase()}${label.slice(1)} signed.`);
  }

  function startPolling(docId: string) {
    if (pollingRef.current) clearTimeout(pollingRef.current);
    let delay = 3000;
    const poll = async () => {
      try {
        const res = await fetch(statusUrl(docId));
        if (res.ok) {
          const data = await res.json();
          if (data.status === "completed") {
            await finish();
            return;
          }
          if (data.status === "missing") {
            pollingRef.current = null;
            setSession(null);
            toast.error("This document is no longer available. Please start again.");
            return;
          }
        }
      } catch {
        // Transient — keep polling with backoff.
      }
      delay = Math.min(delay * 1.3, 30000);
      pollingRef.current = setTimeout(poll, delay);
    };
    pollingRef.current = setTimeout(poll, delay);
  }

  async function start() {
    if (starting) return;
    setStarting(true);
    try {
      const res = await fetch("/api/pandadoc/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, applicationId, yearId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Couldn't open the document.");
      if (data?.completed) {
        // Signed earlier but never synced — the create route synced it.
        await finish();
        return;
      }
      setSession({ sessionId: data.sessionId, documentId: data.documentId });
      startPolling(data.documentId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open the document.");
    } finally {
      setStarting(false);
    }
  }

  // Mount the PandaDoc widget once a session exists.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      let target: HTMLElement | null = null;
      for (let i = 0; i < 20 && !target; i++) {
        target = document.getElementById(embedId);
        if (!target) await new Promise((r) => setTimeout(r, 100));
      }
      if (!target || cancelled) return;
      target.innerHTML = "";
      const { Signing } = await import("pandadoc-signing");
      if (cancelled) return;
      signingRef.current?.destroy();
      const signing = new Signing(embedId, { debugMode: false });
      signing.on("document.completed", () => {
        // The status poll is what records it on the packet — check now
        // instead of waiting out the backoff.
        void fetch(statusUrl(session.documentId))
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d?.status === "completed") void finish();
          })
          .catch(() => {});
      });
      signingRef.current = signing;
      await signing.open({ sessionId: session.sessionId });
    })();
    return () => {
      cancelled = true;
      signingRef.current?.destroy();
      signingRef.current = null;
    };
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
    },
    []
  );

  if (signed) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm">
          <CheckCircle2 className="size-4 text-green-600" />
          Signed
        </span>
        {documentId ? (
          <a
            href={`/api/pandadoc/download?documentId=${encodeURIComponent(documentId)}&applicationId=${applicationId}&yearId=${yearId}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            <Download className="size-3.5" />
            Signed copy
          </a>
        ) : null}
      </div>
    );
  }

  if (session) {
    return (
      <div
        className="relative rounded-lg border overflow-hidden bg-white w-full"
        style={{ height: "80vh", minHeight: 640 }}
      >
        <style>{`
          #${embedId} > *, #${embedId} iframe {
            width: 100% !important;
            height: 100% !important;
            border: none !important;
            display: block !important;
          }
        `}</style>
        <div id={embedId} className="absolute inset-0" />
      </div>
    );
  }

  return (
    <Button onClick={start} disabled={starting}>
      {starting ? (
        <Loader2 className="size-4 mr-1.5 animate-spin" />
      ) : (
        <PenLine className="size-4 mr-1.5" />
      )}
      {starting ? "Preparing…" : documentId ? `Continue signing` : `Sign ${label}`}
    </Button>
  );
}
