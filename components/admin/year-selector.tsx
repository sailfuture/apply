"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import useSWR from "swr";
import { Loader2 } from "lucide-react";
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

/**
 * Colored status indicator per year — shown in every dropdown item AND
 * (via SelectValue mirroring the item content) on the closed trigger,
 * so which kind of year you're working in is glanceable from any admin
 * page without opening the picker. Emerald = the live school year;
 * blue = enrollment's upcoming year; gray = history / not yet open.
 * A year with no flags renders a hollow dot and no label.
 */
function yearStatus(y: SchoolYear): { label: string; dotClass: string } {
  if (y.isActive) return { label: "Active", dotClass: "bg-emerald-500" };
  if (y.isNextYear) return { label: "Upcoming", dotClass: "bg-blue-500" };
  if (y.isFuture) return { label: "Future", dotClass: "bg-slate-300" };
  if (y.isPast) return { label: "Past", dotClass: "bg-slate-400" };
  return { label: "", dotClass: "border border-slate-300 bg-transparent" };
}

export function YearSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentYearId = searchParams.get("yearId");

  // Full-screen "switching year" overlay (user request): a year
  // change swaps the data under EVERY widget on the page, and
  // without an explicit signal the half-old half-new render reads
  // as broken. Shown from the moment of selection until the route
  // transition lands, held to a minimum beat so it never strobes;
  // each page's own skeletons take over from there. The initial
  // default-year injection (the effect below) deliberately doesn't
  // trigger it.
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const switchStartedAt = useRef(0);
  useEffect(() => {
    if (!switchingTo || isPending) return;
    const MIN_OVERLAY_MS = 900;
    const remaining = Math.max(
      0,
      MIN_OVERLAY_MS - (Date.now() - switchStartedAt.current)
    );
    const t = setTimeout(() => setSwitchingTo(null), remaining);
    return () => clearTimeout(t);
  }, [switchingTo, isPending]);

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
    if (value === (currentYearId ?? String(defaultYear?.id ?? ""))) return;
    const picked = years.find((y) => String(y.id) === value);
    switchStartedAt.current = Date.now();
    setSwitchingTo(picked?.year_name || "the selected year");
    const params = new URLSearchParams(searchParams.toString());
    params.set("yearId", value);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <>
      <Select
        value={currentYearId ?? String(defaultYear?.id ?? "")}
        onValueChange={handleChange}
      >
        <SelectTrigger className="w-full bg-white">
          <SelectValue placeholder="Select year" />
        </SelectTrigger>
        <SelectContent>
          {years.map((year) => {
            const status = yearStatus(year);
            return (
              <SelectItem key={year.id} value={String(year.id)}>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`size-2 shrink-0 rounded-full ${status.dotClass}`}
                  />
                  {year.year_name || `Year #${year.id}`}
                  {status.label ? (
                    <span className="text-xs text-muted-foreground">
                      {status.label}
                    </span>
                  ) : null}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {switchingTo ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-3 rounded-lg border bg-white px-8 py-6 shadow-lg">
            <Loader2
              className="size-6 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm font-medium">
              Switching to {switchingTo}
            </p>
            <p className="text-xs text-muted-foreground">
              Loading that school year&rsquo;s data…
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
