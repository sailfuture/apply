import useSWR, { mutate as globalMutate } from "swr";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
};

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

export function useApplications() {
  return useSWR("/api/applications", fetcher, {
    revalidateOnFocus: false,
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
