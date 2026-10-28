"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { LoadingScreen } from "@/components/loading-screen";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface SchoolYear {
  id: number;
  year_name: string;
  start_date: string | null;
  end_date: string | null;
  tuition: number | null;
  annual_fees: number | null;
  transportation_fees: number | null;
  isActive: boolean;
  isPast: boolean;
  isNextYear: boolean;
  isFuture: boolean;
}

function formatCurrency(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(date: string | null): string {
  if (!date) return "TBD";
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ApplyIndexPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  // Families get exactly two choices: join the current school year
  // (the one flagged Active) or apply for the upcoming one (flagged
  // Next Year). Driven by the flags on School Years, so the labels
  // roll over on their own when admin advances the year.
  const [current, setCurrent] = useState<SchoolYear | null>(null);
  const [upcoming, setUpcoming] = useState<SchoolYear | null>(null);
  // Applications on any OTHER year (e.g. an unfinished prior cycle) —
  // listed under the two choices so this page stays their way back.
  const [otherYears, setOtherYears] = useState<SchoolYear[]>([]);
  // Years this family already has an application on — badged so a
  // mid-application family can spot theirs instantly.
  const [appYears, setAppYears] = useState<number[]>([]);
  // Of those, the years already submitted — a family that applied for
  // one year is asked before starting a second (the Hull family
  // submitted both 2026-2027 and 2027-2028 without meaning to).
  const [submittedYears, setSubmittedYears] = useState<number[]>([]);
  const [confirmYear, setConfirmYear] = useState<SchoolYear | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [yearsRes, appsRes] = await Promise.all([
        fetch("/api/school-years"),
        fetch("/api/applications"),
      ]);

      // Xano may return the year FK as a raw id or an expanded object.
      const appYearIds = new Set<number>();
      if (appsRes.ok) {
        const apps = await appsRes.json();
        if (Array.isArray(apps)) {
          for (const a of apps) {
            const raw = a?.registration_school_years_id;
            const id = Number(
              typeof raw === "object" && raw !== null ? raw.id : raw
            );
            if (Number.isFinite(id) && id > 0) appYearIds.add(id);
          }
        }
      }
      setAppYears([...appYearIds]);
      const submitted = await Promise.all(
        [...appYearIds].map(async (yid) => {
          const res = await fetch(`/api/family-progress?yearId=${yid}`).catch(
            () => null
          );
          if (!res?.ok) return null;
          const row = await res.json().catch(() => null);
          return row?.isSubmitted === true ? yid : null;
        })
      );
      setSubmittedYears(submitted.filter((y): y is number => y !== null));

      if (yearsRes.ok) {
        const allYears: SchoolYear[] = await yearsRes.json();
        const active = allYears.find((y) => y.isActive) ?? null;
        const next = allYears.find((y) => y.isNextYear) ?? null;
        const offered = new Set([active?.id, next?.id]);
        const others = allYears.filter(
          (y) => appYearIds.has(y.id) && !offered.has(y.id)
        );

        // Only one year open and nothing else on file — there's no
        // choice to make, so skip straight to it.
        const only = active && next ? null : (active ?? next);
        if (only && others.length === 0) {
          router.replace(`/apply/year/${only.id}`);
          return;
        }

        setCurrent(active);
        setUpcoming(next);
        setOtherYears(others);
      }
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Starting a year with nothing on it while another year's
  // application is submitted → confirm first.
  function choose(year: SchoolYear) {
    if (!appYears.includes(year.id) && submittedYears.length > 0) {
      setConfirmYear(year);
      return;
    }
    router.push(`/apply/year/${year.id}`);
  }
  const submittedYearNames = submittedYears
    .map(
      (id) =>
        [current, upcoming, ...otherYears].find((y) => y?.id === id)
          ?.year_name ?? null
    )
    .filter((n): n is string => !!n);

  if (loading) {
    return (
      <>
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-vertical:h-4 data-vertical:self-auto"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="/">Dashboard</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Applications</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex min-h-[40vh] items-center justify-center">
          <LoadingScreen />
        </div>
      </>
    );
  }

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-4 data-vertical:self-auto"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>Choose a School Year</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold">
            Which school year are you applying for?
          </h1>
          <p className="text-muted-foreground text-sm">
            Join us this school year, or get a head start on next year.
          </p>
        </div>

        {!current && !upcoming ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <p className="text-muted-foreground">
              No school years are open right now. Please contact the school.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {current && (
              <YearChoice
                year={current}
                heading={`Enroll for ${current.year_name}`}
                blurb="Start during the current school year."
                cta="Enroll this year"
                hasApplication={appYears.includes(current.id)}
                submitted={submittedYears.includes(current.id)}
                onSelect={() => choose(current)}
              />
            )}
            {upcoming && (
              <YearChoice
                year={upcoming}
                heading={`Apply for ${upcoming.year_name}`}
                blurb="Start at the beginning of next school year."
                cta="Apply for next year"
                hasApplication={appYears.includes(upcoming.id)}
                submitted={submittedYears.includes(upcoming.id)}
                onSelect={() => choose(upcoming)}
              />
            )}
          </div>
        )}

        {otherYears.length > 0 && (
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">
              You also have an application on file for:
            </p>
            <ul className="flex flex-wrap gap-2">
              {otherYears.map((y) => (
                <li key={y.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/apply/year/${y.id}`)}
                    className="hover:bg-muted/50 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors"
                  >
                    {y.year_name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <AlertDialog
        open={confirmYear !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmYear(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              You already applied for {submittedYearNames.join(" and ")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Starting {confirmYear?.year_name} creates a second, separate
              application. If you meant to switch years, please contact the
              school instead and we&apos;ll move your application for you.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmYear) router.push(`/apply/year/${confirmYear.id}`);
              }}
            >
              Start {confirmYear?.year_name} application
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function YearChoice({
  year,
  heading,
  blurb,
  cta,
  hasApplication,
  submitted,
  onSelect,
}: {
  year: SchoolYear;
  heading: string;
  blurb: string;
  cta: string;
  hasApplication: boolean;
  submitted: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="hover:border-foreground/40 hover:bg-muted/30 flex flex-col gap-4 rounded-lg border p-5 text-left transition-colors"
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{heading}</h2>
          {submitted ? (
            <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
              Submitted
            </span>
          ) : hasApplication ? (
            <span className="inline-flex rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400">
              Your application
            </span>
          ) : null}
        </div>
        <p className="text-muted-foreground text-sm">{blurb}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div className="col-span-2">
          <dt className="text-muted-foreground text-xs">Dates</dt>
          <dd>
            {formatDate(year.start_date)} &mdash; {formatDate(year.end_date)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Tuition</dt>
          <dd className="font-medium">{formatCurrency(year.tuition)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Fees</dt>
          <dd>{formatCurrency(year.annual_fees)}</dd>
        </div>
      </dl>
      <span className="text-primary text-sm font-medium">
        {submitted
          ? "View application"
          : hasApplication
            ? "Continue application"
            : cta}{" "}
        &rarr;
      </span>
    </button>
  );
}
