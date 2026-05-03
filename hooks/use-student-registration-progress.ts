"use client";

import { useCallback } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import type { XanoStudentRegistrationProgress } from "@/lib/xano";

const fetcher = async (
  url: string
): Promise<XanoStudentRegistrationProgress | null> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch registration progress (${res.status})`);
  return res.json();
};

export type RegistrationProgressSection =
  | "isTuition"
  | "isEnrollment"
  | "isRegistration"
  | "isVolunteerHours";

/**
 * Reads the per-family per-year `registration_student_registration_progress`
 * row and exposes helpers to flip any of the three section bools. The GET
 * endpoint creates the row on first access, so `data` is non-null once SWR
 * settles.
 *
 * Mirrors `useFamilyProgress` exactly in shape — if you've used that hook,
 * this one works the same way. They target different tables because the
 * application and registration lifecycles are separate.
 */
export function useStudentRegistrationProgress(
  yearId: number | null | undefined
) {
  const key = yearId
    ? `/api/student-registration-progress?yearId=${yearId}`
    : null;
  const { data, error, isLoading, mutate } =
    useSWR<XanoStudentRegistrationProgress | null>(key, fetcher, {
      revalidateOnFocus: false,
      dedupingInterval: 10000,
    });

  const { trackAutosave } = useApplicationFlow();

  /** Low-level PATCH — writes any subset of whitelisted fields on the row.
   *  Used when we need to flip a bool AND persist another field in the same
   *  request (e.g. the tuition signature lands with `isTuition: true`). */
  const patchProgress = useCallback(
    async (
      patch: Partial<
        Pick<
          XanoStudentRegistrationProgress,
          | "isTuition"
          | "isEnrollment"
          | "isRegistration"
          | "isVolunteerHours"
          | "tuition_scholarship_signature"
          | "signature_data_volunteer"
          | "volunteer_signature_data"
          | "name_volunteer"
          | "monthly_tuition_payment"
          | "monthly_transportation_payment"
          | "enrollment_agreement_pandadoc_id"
          | "enrollment_agreement_status"
          | "enrollment_agreement_sent"
          | "enrollment_agreement_pdf_url"
          | "is_enrollment_agreement_signed"
          | "signature_data"
          | "name"
          | "submitted_date"
          | "isSubmitted"
          | "registration_type_id"
        >
      >
    ) => {
      if (!yearId || !key) return;
      // Optimistic — merge the patch into the cache so downstream readers
      // (sidenav, button state) see the change immediately.
      mutate(
        (curr) => (curr ? { ...curr, ...patch } : curr),
        { revalidate: false }
      );
      try {
        const saved = await trackAutosave(
          fetch(key, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          }).then(async (res) => {
            if (!res.ok) throw new Error(`Save failed (${res.status})`);
            return res.json();
          })
        );
        // Commit the server's version (last_edited + potentially
        // submitted_date if the server just latched the final section).
        mutate(saved, { revalidate: false });
        return saved as XanoStudentRegistrationProgress;
      } catch (err) {
        mutate();
        throw err;
      }
    },
    [yearId, key, trackAutosave, mutate]
  );

  const setSection = useCallback(
    (section: RegistrationProgressSection, value: boolean) =>
      patchProgress({ [section]: value }),
    [patchProgress]
  );

  /** Hard-submit the registration — flips `isSubmitted: true` so the
   *  enrolled-family dashboard takes over on the year overview. Mirror of
   *  `useFamilyProgress.submit()` on the application side. */
  const submit = useCallback(async () => {
    return patchProgress({ isSubmitted: true });
  }, [patchProgress]);

  return {
    progress: data ?? null,
    loading: isLoading,
    error,
    setSection,
    patchProgress,
    submit,
    refresh: mutate,
  };
}

/** Imperative revalidation from anywhere (e.g. after a save on another page). */
export function mutateStudentRegistrationProgress(yearId: number) {
  return globalMutate(`/api/student-registration-progress?yearId=${yearId}`);
}
