"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface SchoolYear {
  id: number;
  year_name: string;
  isActive?: boolean;
  isNextYear?: boolean;
  isPast?: boolean;
  isFuture?: boolean;
}

/**
 * Amber "you're in history" banner, mounted in the admin layout so it
 * rides along on EVERY admin page. Renders only when the selected
 * `?yearId=` is a previous academic year — flagged `isPast`, or an old
 * unflagged year (2023-2024-style rows pre-date the flags) — and stays
 * stuck under the fixed top nav so scrolling can't hide the warning.
 *
 * Exists because the year picker alone proved too easy to miss: an
 * admin who switched to last year to check something and forgot would
 * edit historical records thinking they were live. The current
 * (active, else upcoming) year never banners, and future years don't
 * either — the risk this guards against is misreading history as
 * live data, not peeking ahead.
 *
 * Same SWR key + fetcher as `YearSelector`, so this adds no extra
 * request.
 */
export function PastYearBanner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const yearId = Number(searchParams.get("yearId")) || 0;

  const { data } = useSWR<SchoolYear[]>("/api/school-years", fetcher);
  const years = Array.isArray(data) ? data : [];
  const selected = yearId ? years.find((y) => y.id === yearId) : undefined;
  const current =
    years.find((y) => y.isActive) ?? years.find((y) => y.isNextYear);

  const isPrevious =
    !!selected &&
    !!current &&
    selected.id !== current.id &&
    !selected.isActive &&
    !selected.isNextYear &&
    !selected.isFuture;
  if (!isPrevious) return null;

  function switchToCurrent() {
    if (!current) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("yearId", String(current.id));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    // top-14 tucks it flush under the fixed 56px top nav; z stays
    // below the nav's z-50 so open dropdowns still layer above it.
    <div className="sticky top-14 z-40 border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 lg:px-6">
        <History className="size-4 shrink-0 text-amber-700" aria-hidden="true" />
        <p className="text-sm text-amber-900">
          <span className="font-semibold">
            You&rsquo;re working in {selected.year_name}
          </span>{" "}
          — a previous academic year. Anything you change here edits
          historical records.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={switchToCurrent}
          className="ml-auto h-7 border-amber-300 bg-white text-amber-900 hover:bg-amber-100 hover:text-amber-950"
        >
          Switch to {current.year_name}
        </Button>
      </div>
    </div>
  );
}
