import { useCallback } from "react";
import useSWR, { mutate as globalMutate, useSWRConfig } from "swr";
import { useIsClient } from "@/hooks/use-is-client";

// All routes that call these hooks are gated by `clerkMiddleware` in
// `proxy.ts` — the request can't reach the page without a valid session.
// We used to wrap each SWR key in a `useAuthedKey` that also waited for
// the client-side Clerk SDK to hydrate (`isLoaded && isSignedIn`) before
// firing, but that delayed every fetch by ~1-2s on cold loads while the
// SDK downloaded from the Clerk CDN. The session cookie is already in
// the browser by the time these hooks mount, so we fire fetches
// immediately and let the API endpoints enforce auth.

// One wrinkle with firing immediately: Clerk's session JWT (the
// `__session` cookie) is short-lived (~60s) and only refreshed by
// clerk-js once it has hydrated. A fetch that races that refresh — a
// cold load after the tab sat idle, or an SWR focus/interval
// revalidation firing right as the tab wakes — presents an expired
// token and gets a 401 from the API. Recoverable, but SWR's error
// backoff made recovery take seconds. `refreshSessionToken` below
// waits for clerk-js and forces a token mint (which also rewrites the
// session cookie), so the one retry succeeds immediately. The browser
// still logs the initial 401 in the console; that line is cosmetic.

/** Wait for clerk-js to hydrate (up to ~3s), then force-mint a fresh
 *  session token so the retried request carries a valid cookie. */
async function refreshSessionToken(): Promise<void> {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    Clerk?: {
      session?: {
        getToken(opts?: { skipCache?: boolean }): Promise<string | null>;
      } | null;
    };
  };
  const deadline = Date.now() + 3000;
  while (!w.Clerk?.session && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
  }
  try {
    await w.Clerk?.session?.getToken({ skipCache: true });
  } catch {
    // Ignore — the retried fetch will surface the real failure.
  }
}

/** `fetch` for parent-side GETs that retries a 401 once after refreshing
 *  the Clerk session token (see comment above). Resolves with the
 *  Response, ok or not — pages that read the body themselves use this
 *  and decide what a non-2xx means. */
export async function apiFetch(url: string): Promise<Response> {
  let res = await fetch(url);
  if (res.status === 401) {
    await refreshSessionToken();
    res = await fetch(url);
  }
  return res;
}

/** Shared parent-side SWR fetcher: `apiFetch`, then throws on !ok so
 *  SWR treats any non-2xx as an error and retries it. */
export const apiFetcher = async (url: string) => {
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
};

const fetcher = apiFetcher;

/** `{ enabled: false }` holds the fetch (SWR key `null`). The header
 *  passes it on `/sign-in` and `/sign-up`: there is no session yet, so
 *  every call would 401, wait on clerk-js, retry, and 401 again — and
 *  the same key was then read as settled on the first page after
 *  sign-in. Defaults to enabled everywhere else. */
export interface ApiHookOptions {
  enabled?: boolean;
}

export function useFamily(opts?: ApiHookOptions) {
  return useSWR(opts?.enabled === false ? null : "/api/families", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10000,
  });
}

export function useSchoolYears(opts?: ApiHookOptions) {
  return useSWR(
    opts?.enabled === false ? null : "/api/school-years",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );
}

/**
 * Revalidates on focus, deliberately matching `useApplications`.
 * These two are consumed together — the dashboard joins applications
 * back to their student rows — and when only one of them refreshes,
 * the join silently drops rows for students the stale list has never
 * heard of. That's how a freshly-created mid-year registration went
 * missing from the parent's dashboard after they navigated away and
 * back.
 */
export function useStudents(opts?: ApiHookOptions) {
  return useSWR(opts?.enabled === false ? null : "/api/students", fetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 10000,
  });
}

/**
 * All `registration_student_registration` packets for the authenticated
 * parent's family for the given school year. Used by parent-facing
 * tuition pages to read per-student billing values
 * (`monthly_amount`, `sufs_amount`, `opportunity_award_amount`,
 * `tuition_sub_total`, `annual_fee`) — those values moved from the
 * application row onto the per-year packet, so the dashboard /
 * apply-flow tuition surfaces fetch them from here.
 *
 * Revalidates on focus + every 30s, same cadence as
 * `useApplications` — admin can edit per-student amounts on the
 * Scholarship Determination card while the parent has the tuition
 * page open and the new figures should appear without a manual
 * reload.
 */
export function useStudentRegistrationPackets(yearId: number | null) {
  const key =
    yearId !== null ? `/api/student-registration?yearId=${yearId}` : null;
  return useSWR(key, fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 30000,
    dedupingInterval: 10000,
  });
}

export function useApplications() {
  // Revalidate on focus + every 30s. The `isAccepted` / `isOffered`
  // flags on each application row are admin-controlled (admin flips
  // them from /admin/families and /admin/registrations), and the
  // parent's lifecycle stage at /apply/year/[id] depends on them. No
  // revalidation here means the parent has to hard-reload to see
  // they've been accepted.
  return useSWR("/api/applications", fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 30000,
    dedupingInterval: 10000,
  });
}

export function useScholarship(familyId: number | null, yearId: number | null) {
  const key =
    familyId && yearId
      ? `/api/scholarship?familyId=${familyId}&yearId=${yearId}`
      : null;
  return useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10000,
  });
}

export function useBusStops() {
  return useSWR("/api/bus-stops", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60000,
  });
}

/** Reads what SWR already holds for a key; `undefined` when it holds
 *  nothing (or during the first, hydrating render — see below). */
export type ApiCacheReader = <T>(key: string) => T | undefined;

/**
 * For the apply-flow step pages, which keep an editable copy of their
 * data in local state and load it themselves (`apiFetch`) rather than
 * through the hooks above. Each of them started every visit empty,
 * behind a skeleton, until its own fetch came back — although the
 * header and the side nav had the same responses in the SWR cache all
 * along. All four steps (Family, Students, Financial Aid, Initial
 * Testing) now fill their first render from this reader and run their
 * usual load behind it.
 *
 * Reads without subscribing and never fetches. Returns `undefined`
 * for everything while the page is hydrating, so the first client
 * render matches the server's (which has no cache) — a step opened by
 * URL shows its skeleton exactly as before; only a move between steps
 * starts from the cache.
 */
export function useApiCacheReader(): ApiCacheReader {
  const { cache } = useSWRConfig();
  const isClient = useIsClient();
  return useCallback(
    <T,>(key: string) =>
      isClient ? (cache.get(key)?.data as T | undefined) : undefined,
    [cache, isClient]
  );
}

// Saves the step pages have sent that have not come back yet. Kept
// here, outside any one page, because a save is often still on the
// wire when the parent moves on: leaving a field saves it, and so does
// leaving a step. Whatever loads next (the same step again, or another
// step that shows the same rows) waits for these first, so its read
// cannot come back without them.
const pendingStepSaves = new Set<Promise<unknown>>();

/** Register a save while it is in flight. Returns `save` unchanged. */
export function trackStepSave<T>(save: Promise<T>): Promise<T> {
  pendingStepSaves.add(save);
  const done = () => {
    pendingStepSaves.delete(save);
  };
  save.then(done, done);
  return save;
}

/** How long a load or "Complete" will hold for saves still in flight.
 *  A save normally answers in a second or two; one that is stuck must
 *  not keep the next step behind its skeleton. */
const STEP_SAVE_WAIT_MS = 5000;

/** Resolves once every save registered so far has come back, whether
 *  it went through or not — or after `STEP_SAVE_WAIT_MS`, whichever is
 *  first. Past that the caller carries on as it did before this
 *  existed: the read may miss the save, "Complete" may send a field
 *  again. */
export function stepSavesSettled(): Promise<unknown> {
  if (pendingStepSaves.size === 0) return Promise.resolve();
  return Promise.race([
    Promise.allSettled([...pendingStepSaves]),
    new Promise((resolve) => setTimeout(resolve, STEP_SAVE_WAIT_MS)),
  ]);
}

export function mutateFamily() {
  return globalMutate("/api/families");
}

export function mutateStudents() {
  return globalMutate("/api/students");
}

export function mutateApplications() {
  return globalMutate("/api/applications");
}

export function mutateScholarship(familyId: number, yearId: number) {
  return globalMutate(`/api/scholarship?familyId=${familyId}&yearId=${yearId}`);
}

export function mutateAll() {
  globalMutate("/api/families");
  globalMutate("/api/students");
  globalMutate("/api/applications");
  globalMutate("/api/school-years");
}
