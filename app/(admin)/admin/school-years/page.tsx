"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { Plus, ChevronRight, Trash2 } from "lucide-react";
import { adminFetcher } from "@/lib/admin-fetcher";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import type { XanoSchoolYear } from "@/lib/xano";

type YearStatus = "active" | "next" | "past" | "future" | "none";

const STATUS_LABEL: Record<YearStatus, string> = {
  active: "Active",
  next: "Upcoming",
  past: "Past",
  future: "Future",
  none: "—",
};

// Status pill is monochrome — every state uses the same muted badge
// so the table reads as plain reference data, not a status dashboard.
// The status word itself carries the semantic.
const STATUS_BADGE_CLASS = "bg-muted text-muted-foreground border-border";

function deriveStatus(y: XanoSchoolYear): YearStatus {
  if (y.isActive) return "active";
  if (y.isNextYear) return "next";
  if (y.isFuture) return "future";
  if (y.isPast) return "past";
  return "none";
}

function formatCurrency(value: number | null | undefined): string {
  const safe = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return safe.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const parsed = new Date(`${d}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Admin School Years list. Replaces the previous list-with-sheet UX —
 * each row now navigates to its own detail page so the year editor can
 * host larger surfaces (the scholarship award matrix) without trying to
 * fit them in a side sheet.
 */
export default function AdminSchoolYearsPage() {
  const router = useRouter();
  const { data, isLoading, error, mutate } = useSWR<XanoSchoolYear[]>(
    "/api/admin/school-years",
    adminFetcher
  );
  const years = Array.isArray(data) ? data : [];

  const [pendingDelete, setPendingDelete] = useState<XanoSchoolYear | null>(
    null
  );
  const [creating, setCreating] = useState(false);

  /**
   * "Add School Year" creates a minimal row, then routes to the detail
   * page to fill in everything else. Trying to validate the whole year
   * before redirecting was the previous UX bottleneck — admins want to
   * land in the editor, not in a modal.
   */
  async function createNew() {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/school-years", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year_name: `New Year (${new Date().getFullYear()})`,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      const created = (await res.json()) as XanoSchoolYear;
      await mutate();
      router.push(`/admin/school-years/${created.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">School Years</h1>
          <p className="text-sm text-muted-foreground">
            Tuition, fees, scholarship amounts, deadlines, and the
            household × income award matrix for every academic year.
          </p>
        </div>
        <Button onClick={createNew} disabled={creating}>
          <Plus className="size-4 mr-1.5" />
          Add School Year
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          Failed to load school years:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : null}

      {/* Single-line cells, monochrome, all body text at `text-sm`.
          Status is its own column so it stays at the same size as
          the year label rather than visually competing with it. */}
      <div className="rounded-lg border bg-white">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Year
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Dates
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Tuition
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Annual Fees
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Transport
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                App Deadline
              </TableHead>
              <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && years.length === 0 ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  <TableCell colSpan={8}>
                    <Skeleton className="h-9 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : years.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-sm text-muted-foreground py-10"
                >
                  No school years yet. Click <strong>Add School Year</strong>{" "}
                  to create the first one.
                </TableCell>
              </TableRow>
            ) : (
              years.map((y) => {
                const status = deriveStatus(y);
                return (
                  <TableRow
                    key={y.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/admin/school-years/${y.id}`)}
                  >
                    <TableCell className="text-sm font-medium truncate">
                      {y.year_name || `Year #${y.id}`}
                    </TableCell>
                    <TableCell className="text-sm">
                      {status !== "none" ? (
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_BADGE_CLASS}`}
                        >
                          {STATUS_LABEL[status]}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm truncate">
                      {formatDate(y.start_date)} – {formatDate(y.end_date)}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {formatCurrency(y.tuition)}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {formatCurrency(y.annual_fees)}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {formatCurrency(y.transportation_fees)}
                    </TableCell>
                    <TableCell className="text-sm truncate">
                      {formatDate(y.application_deadline)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div
                        className="inline-flex gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-red-600"
                          onClick={() => setPendingDelete(y)}
                          aria-label={`Delete ${y.year_name}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() =>
                            router.push(`/admin/school-years/${y.id}`)
                          }
                          aria-label={`Open ${y.year_name}`}
                        >
                          <ChevronRight className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {pendingDelete?.year_name || "this school year"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the year from Xano. Any application
              or packet that referenced it will keep the foreign key but no
              longer resolve to a year. Only delete years that no real
              student data depends on.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={async (e) => {
                e.preventDefault();
                if (!pendingDelete) return;
                try {
                  const res = await fetch(
                    `/api/admin/school-years/${pendingDelete.id}`,
                    { method: "DELETE" }
                  );
                  if (!res.ok) {
                    const body = await res.json().catch(() => null);
                    throw new Error(body?.error ?? `Failed (${res.status})`);
                  }
                  setPendingDelete(null);
                  await mutate();
                  toast.success("School year deleted.");
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Couldn't delete."
                  );
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
