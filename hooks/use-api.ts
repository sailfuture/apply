import useSWR, { mutate as globalMutate } from "swr";
import { useAuth } from "@clerk/nextjs";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
};

function useAuthedKey(key: string | null): string | null {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded || !isSignedIn) return null;
  return key;
}

export function useFamily() {
  return useSWR(useAuthedKey("/api/families"), fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10000,
  });
}

export function useSchoolYears() {
  return useSWR(useAuthedKey("/api/school-years"), fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });
}

export function useStudents() {
  return useSWR(useAuthedKey("/api/students"), fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10000,
  });
}

export function useApplications() {
  return useSWR(useAuthedKey("/api/applications"), fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10000,
  });
}

export function useScholarship(familyId: number | null, yearId: number | null) {
  const key =
    familyId && yearId
      ? `/api/scholarship?familyId=${familyId}&yearId=${yearId}`
      : null;
  return useSWR(useAuthedKey(key), fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10000,
  });
}

export function useBusStops() {
  return useSWR(useAuthedKey("/api/bus-stops"), fetcher, {
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
