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
import { resolveAdminYear, sortAdminYears } from "@/lib/school-year-default";
import {
  readRememberedAdminYearId,
  rememberAdminYear,
  useRememberedAdminYearId,
} from "@/lib/admin-year-memory";

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
  // Both the order and the default live in lib/school-year-default.ts,
  // shared with the server routes that answer before this component
  // has injected the year (the Messages inbox feed) — the two must
  // pick the same year or that page would re-fetch for another.
  const years = useMemo(
    () => (Array.isArray(yearsRaw) ? sortAdminYears(yearsRaw) : []),
    [yearsRaw]
  );

  // The year a URL without `?yearId=` resolves to: the one this
  // browser last worked in, else the default rule (upcoming year).
  const rememberedYearId = useRememberedAdminYearId();
  const defaultYear = useMemo(
    () => resolveAdminYear(years, rememberedYearId),
    [years, rememberedYearId]
  );

  // Fill in the year when the URL doesn't carry one (a link, bookmark
  // or typed URL that dropped it). The cookie is read here rather than
  // through the hook so a hydration render can't inject the default
  // over the remembered year.
  useEffect(() => {
    if (currentYearId || years.length === 0) return;
    const year = resolveAdminYear(years, readRememberedAdminYearId());
    if (!year) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("yearId", String(year.id));
    router.replace(`${pathname}?${params.toString()}`);
  }, [currentYearId, years, pathname, router, searchParams]);

  // Remember whatever real year is in view — picked here, switched by
  // the past-year banner, or opened from a link that names one — so
  // the next URL without a year stays on it. Except a family record:
  // its year is that application's, and opening a 2027-2028 family
  // from the current year's list mustn't move the admin's working
  // year (user request). Picking a year in this menu there still
  // does (`handleChange`).
  useEffect(() => {
    if (pathname.startsWith("/admin/families/")) return;
    const id = Number(currentYearId);
    if (years.some((y) => y.id === id)) rememberAdminYear(id);
  }, [currentYearId, years, pathname]);

  if (isLoading) {
    return <Skeleton className="h-9 w-full" />;
  }

  if (years.length === 0) {
    return null;
  }

  function handleChange(value: string) {
    if (value === (currentYearId ?? String(defaultYear?.id ?? ""))) return;
    const picked = years.find((y) => String(y.id) === value);
    if (picked) rememberAdminYear(picked.id);
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
