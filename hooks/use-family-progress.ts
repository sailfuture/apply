"use client";

import { useCallback } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import type { XanoFamilyApplicationProgress } from "@/lib/xano";

const fetcher = async (url: string): Promise<XanoFamilyApplicationProgress | null> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch progress (${res.status})`);
  return res.json();
};

export type ProgressSection =
  | "family_completed"
  | "students_completed"
  | "financial_aid_completed"
  | "testing_completed";

/**
 * Reads the per-family per-year `registration_family_application_progress` row
 * and exposes a helper to flip any section boolean. The GET endpoint creates
 * the row on first access, so `data` is non-null once SWR settles.
 */
export function useFamilyProgress(yearId: number | null | undefined) {
  const key = yearId ? `/api/family-progress?yearId=${yearId}` : null;
  const { data, error, isLoading, mutate } = useSWR<XanoFamilyApplicationProgress | null>(
    key,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );

  const { trackAutosave } = useApplicationFlow();

  const setSection = useCallback(
    async (section: ProgressSection, value: boolean) => {
      if (!yearId || !key) return;
      // Optimistic update — flip the cache immediately so the button (and
      // every sidenav step reading from this cache) reflects the new state
      // without a brief flicker back to the old color while the PATCH is in
      // flight.
      mutate(
        (curr) => (curr ? { ...curr, [section]: value } : curr),
        { revalidate: false }
      );
      try {
        const saved = await trackAutosave(
          fetch(key, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [section]: value }),
          }).then(async (res) => {
            if (!res.ok) throw new Error(`Save failed (${res.status})`);
            return res.json();
          })
        );
        // Commit the server's version (includes last_edited, etc.)
        mutate(saved, { revalidate: false });
      } catch (err) {
        // Revert on failure
        mutate();
        throw err;
      }
    },
    [yearId, key, trackAutosave, mutate]
  );

  const submit = useCallback(
    async () => {
      if (!yearId || !key) return;
      // Flip isSubmitted + stamp submitted_at in one PATCH. The dashboard
      // reads isSubmitted to show the "Application Submitted" banner.
      const saved = await trackAutosave(
        fetch(key, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isSubmitted: true, submitted_at: Date.now() }),
        }).then(async (res) => {
          if (!res.ok) throw new Error(`Submit failed (${res.status})`);
          return res.json();
        })
      );
      mutate(saved, { revalidate: false });
      return saved;
    },
    [yearId, key, trackAutosave, mutate]
  );

  return {
    progress: data ?? null,
    loading: isLoading,
    error,
    setSection,
    submit,
    refresh: mutate,
  };
}

/** Imperative revalidation from anywhere (e.g. after a save on another page). */
export function mutateFamilyProgress(yearId: number) {
  return globalMutate(`/api/family-progress?yearId=${yearId}`);
}
