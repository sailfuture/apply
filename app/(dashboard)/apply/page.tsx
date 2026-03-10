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

function getYearTypeBadge(year: SchoolYear) {
  if (year.isActive) {
    return {
      label: "Active",
      className:
        "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    };
  }
  if (year.isNextYear) {
    return {
      label: "Next Year",
      className:
        "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    };
  }
  if (year.isPast) {
    return {
      label: "Past",
      className:
        "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
    };
  }
  return null;
}

export default function ApplyIndexPage() {
  const router = useRouter();
  const [schoolYears, setSchoolYears] = useState<SchoolYear[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/school-years");
      if (res.ok) {
        const allYears: SchoolYear[] = await res.json();
        const visible = allYears.filter((y) => !y.isFuture);
        visible.sort((a, b) => {
          const aStart = a.start_date ? new Date(a.start_date).getTime() : 0;
          const bStart = b.start_date ? new Date(b.start_date).getTime() : 0;
          return bStart - aStart;
        });
        setSchoolYears(visible);
      }
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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

      <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold">Applications</h1>
          <p className="text-muted-foreground text-sm">
            Select a school year to view and manage applications.
          </p>
        </div>

        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : schoolYears.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <p className="text-muted-foreground">
              No school years available. Please contact the school.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-muted-foreground px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                    School Year
                  </th>
                  <th className="text-muted-foreground hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider sm:table-cell">
                    Dates
                  </th>
                  <th className="text-muted-foreground hidden px-4 py-3 text-right text-xs font-medium uppercase tracking-wider md:table-cell">
                    Tuition
                  </th>
                  <th className="text-muted-foreground hidden px-4 py-3 text-right text-xs font-medium uppercase tracking-wider lg:table-cell">
                    Fees
                  </th>
                  <th className="text-muted-foreground hidden px-4 py-3 text-right text-xs font-medium uppercase tracking-wider lg:table-cell">
                    Transport
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {schoolYears.map((year) => {
                  const badge = getYearTypeBadge(year);

                  return (
                    <tr
                      key={year.id}
                      onClick={() => router.push(`/apply/year/${year.id}`)}
                      className="hover:bg-muted/50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium">
                          {year.year_name}
                        </p>
                      </td>
                      <td className="text-muted-foreground hidden px-4 py-3 text-sm sm:table-cell">
                        {formatDate(year.start_date)} &mdash;{" "}
                        {formatDate(year.end_date)}
                      </td>
                      <td className="hidden px-4 py-3 text-right text-sm font-medium md:table-cell">
                        {formatCurrency(year.tuition)}
                      </td>
                      <td className="text-muted-foreground hidden px-4 py-3 text-right text-sm lg:table-cell">
                        {formatCurrency(year.annual_fees)}
                      </td>
                      <td className="text-muted-foreground hidden px-4 py-3 text-right text-sm lg:table-cell">
                        {formatCurrency(year.transportation_fees)}
                      </td>
                      <td className="px-4 py-3">
                        {badge && (
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
