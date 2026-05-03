"use client";

import { useCallback } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import type { XanoReapplyFamilyProgress } from "@/lib/xano";

const fetcher = async (url: string): Promise<XanoReapplyFamilyProgress | null> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch reapply progress (${res.status})`);
  return res.json();
};

export type ReapplyProgressSection =
  | "isFamilyDetails"
  | "isStudentDetails"
  | "isScholarship"
  | "isTransportation";

/**
 * Reads (and creates on first access) the per-family per-year
 * `reapply_family_progress` row. Mirrors `useFamilyProgress` and
 * `useStudentRegistrationProgress` so the section-completion pattern
 * stays uniform across the three lifecycle progress tables.
 */
export function useReapplyFamilyProgress(yearId: number | null | undefined) {
  const key = yearId
    ? `/api/reapply-family-progress?yearId=${yearId}`
    : null;
  const { data, error, isLoading, mutate } =
    useSWR<XanoReapplyFamilyProgress | null>(key, fetcher, {
      revalidateOnFocus: false,
      dedupingInterval: 10000,
    });

  const { trackAutosave } = useApplicationFlow();

  const setSection = useCallback(
    async (section: ReapplyProgressSection, value: boolean) => {
      if (!yearId || !key) return;
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
        mutate(saved, { revalidate: false });
      } catch (err) {
        mutate();
        throw err;
      }
    },
    [yearId, key, trackAutosave, mutate]
  );

  /** Hard-submit the re-application — flips `isSubmitted: true` so admin
   *  review can take over. */
  const submit = useCallback(async () => {
    if (!yearId || !key) return;
    const saved = await trackAutosave(
      fetch(key, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isSubmitted: true }),
      }).then(async (res) => {
        if (!res.ok) throw new Error(`Submit failed (${res.status})`);
        return res.json();
      })
    );
    mutate(saved, { revalidate: false });
    return saved as XanoReapplyFamilyProgress;
  }, [yearId, key, trackAutosave, mutate]);

  return {
    progress: data ?? null,
    loading: isLoading,
    error,
    setSection,
    submit,
    refresh: mutate,
  };
}

/** Imperative revalidation from anywhere. */
export function mutateReapplyFamilyProgress(yearId: number) {
  return globalMutate(`/api/reapply-family-progress?yearId=${yearId}`);
}
