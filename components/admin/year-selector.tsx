"use client";

import { useEffect } from "react";
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

interface SchoolYear {
  id: number;
  name: string;
  isActive: boolean;
  isNextYear: boolean;
}

export function YearSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentYearId = searchParams.get("yearId");

  const { data: years, isLoading } = useSWR<SchoolYear[]>(
    "/api/school-years",
    fetcher
  );

  const defaultYear =
    years?.find((y) => y.isNextYear) ?? years?.find((y) => y.isActive);

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

  if (!years || years.length === 0) {
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
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select year" />
      </SelectTrigger>
      <SelectContent>
        {years.map((year) => (
          <SelectItem key={year.id} value={String(year.id)}>
            {year.name}
            {year.isActive ? " (Active)" : ""}
            {year.isNextYear ? " (Upcoming)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
