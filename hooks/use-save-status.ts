"use client";

import { useCallback, useRef, useState } from "react";

export type SaveStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved"; at: number }
  | { state: "error"; message: string };

/**
 * Small hook that tracks save status for a section. Returns the current status,
 * a `wrap(promise)` helper to run an async save with automatic state transitions,
 * and a `reset` function.
 *
 * Usage:
 *   const { status, wrap } = useSaveStatus();
 *   await wrap(fetch("/api/...", { method: "PATCH", ... }).then(r => {
 *     if (!r.ok) throw new Error(`Save failed (${r.status})`);
 *   }));
 *
 * Render <SaveStatusPill status={status} /> anywhere on the page.
 */
export function useSaveStatus() {
  const [status, setStatus] = useState<SaveStatus>({ state: "idle" });
  // Track the latest call so out-of-order resolutions don't clobber newer state.
  const callIdRef = useRef(0);

  const wrap = useCallback(async <T>(promise: Promise<T>): Promise<T> => {
    const id = ++callIdRef.current;
    setStatus({ state: "saving" });
    try {
      const result = await promise;
      if (id === callIdRef.current) {
        setStatus({ state: "saved", at: Date.now() });
      }
      return result;
    } catch (err) {
      if (id === callIdRef.current) {
        const message = err instanceof Error ? err.message : "Save failed";
        setStatus({ state: "error", message });
      }
      throw err;
    }
  }, []);

  const markSaved = useCallback(() => {
    setStatus({ state: "saved", at: Date.now() });
  }, []);

  const markError = useCallback((message: string) => {
    setStatus({ state: "error", message });
  }, []);

  const reset = useCallback(() => {
    setStatus({ state: "idle" });
  }, []);

  return { status, wrap, markSaved, markError, reset };
}
