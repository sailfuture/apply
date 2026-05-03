"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import useSWR from "swr";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Matches the actual `/api/school-years` payload shape — the field is
 * `year_name`, not `name`. Previous interface used `name` and the picker
 * rendered empty labels because of the mismatch.
 */
interface SchoolYear {
  id: number;
  year_name: string;
  isActive?: boolean;
  isNextYear?: boolean;
  isPast?: boolean;
  isFuture?: boolean;
}

export function YearSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentYearId = searchParams.get("yearId");

  const { data: yearsRaw, isLoading } = useSWR<SchoolYear[]>(
    "/api/school-years",
    fetcher
  );

  // Sort: upcoming/next year first, then active, then future, then past.
  // Within each group, newer years (higher year_name string) come first.
  const years = useMemo(() => {
    if (!Array.isArray(yearsRaw)) return [];
    const rank = (y: SchoolYear) => {
      if (y.isNextYear) return 0;
      if (y.isActive) return 1;
      if (y.isFuture) return 2;
      return 3; // past or unflagged
    };
    return [...yearsRaw].sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return (b.year_name ?? "").localeCompare(a.year_name ?? "");
    });
  }, [yearsRaw]);

  const defaultYear = useMemo(
    () =>
      years.find((y) => y.isNextYear) ??
      years.find((y) => y.isActive) ??
      years[0] ??
      null,
    [years]
  );

  // Auto-select the default year on first load if the URL doesn't already
  // carry a `?yearId=`. Keeps the admin tool focused on the upcoming year
  // by default per spec.
  useEffect(() => {
    if (!currentYearId && defaultYear) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("yearId", String(defaultYear.id));
      router.replace(`${pathname}?${params.toString()}`);
    }
  }, [currentYearId, defaultYear, pathname, router, searchParams]);

  if (isLoading) {
    return <Skeleton className="h-9 w-full" />;
  }

  if (years.length === 0) {
    return null;
  }

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("yearId", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Select
      value={currentYearId ?? String(defaultYear?.id ?? "")}
      onValueChange={handleChange}
    >
      <SelectTrigger className="w-full bg-white">
        <SelectValue placeholder="Select year" />
      </SelectTrigger>
      <SelectContent>
        {years.map((year) => (
          <SelectItem key={year.id} value={String(year.id)}>
            {year.year_name || `Year #${year.id}`}
            {year.isNextYear ? " · Upcoming" : year.isActive ? " · Active" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
