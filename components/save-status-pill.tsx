"use client";

import { useEffect, useState } from "react";
import { Loader2, Check, AlertTriangle, RefreshCw } from "lucide-react";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import type { SaveStatus } from "@/hooks/use-save-status";

interface Props {
  status: SaveStatus;
  /** Called when the user clicks "Retry" on an error state. */
  onRetry?: () => void;
}

/**
 * Compact auto-save indicator — small icon + short text. Designed to sit inline
 * with a page's subhead. All visible states share a size-3.5 icon + text-xs.
 */
export function SaveStatusPill({ status, onRetry }: Props) {
  // Tick once a minute while "saved" so the relative time stays roughly fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (status.state !== "saved") return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [status.state]);

  if (status.state === "idle") return null;

  if (status.state === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Saving…
      </span>
    );
  }

  if (status.state === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Check className="size-3.5" />
        Saved {formatRelative(status.at)}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
      <AlertTriangle className="size-3.5" />
      {status.message}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 underline underline-offset-2 hover:no-underline"
        >
          <RefreshCw className="size-3" /> Retry
        </button>
      )}
    </span>
  );
}

/**
 * Convenience wrapper that reads the global auto-save status from
 * `useApplicationFlow()` so pages don't have to thread it through.
 */
export function GlobalSaveStatusPill() {
  const { saveStatus } = useApplicationFlow();
  return <SaveStatusPill status={saveStatus} />;
}

function formatRelative(at: number): string {
  const diffMs = Math.max(0, Date.now() - at);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
