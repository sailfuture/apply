import useSWR, { mutate as globalMutate } from "swr";

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

/** Shared parent-side fetcher: throws on !ok, and retries a 401 once
 *  after refreshing the Clerk session token (see comment above). */
export const apiFetcher = async (url: string) => {
  let res = await fetch(url);
  if (res.status === 401) {
    await refreshSessionToken();
    res = await fetch(url);
  }
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
};

const fetcher = apiFetcher;

export function useFamily() {
  return useSWR("/api/families", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10000,
  });
}

export function useSchoolYears() {
  return useSWR("/api/school-years", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });
}

export function useStudents() {
  return useSWR("/api/students", fetcher, {
    revalidateOnFocus: false,
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
