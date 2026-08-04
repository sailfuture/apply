"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, ChevronRight, Copy, Download, ExternalLink } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/admin/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeadTriageControls } from "@/components/admin/lead-triage";
import { LeadTourSection } from "@/components/admin/tour-section";
import { ToursPanel } from "@/components/admin/tours-panel";
import {
  InquiryNoteComposer,
  InquiryNotes,
} from "@/components/admin/inquiry-notes";
import { StarRating } from "@/components/admin/star-rating";
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatUSPhone } from "@/lib/phone";
import {
  copyCampusVisitsTable,
  downloadCampusVisitsCsv,
} from "@/lib/campus-visits-export";
import type { CampusVisitRow } from "@/app/api/admin/campus-visits/route";

/**
 * Campus Visits — the database of liability waivers signed on the
 * marketing site before a campus tour. Rows come pre-sorted
 * newest-first from `/api/admin/campus-visits`, each annotated with a
 * DERIVED academic year (the waiver table itself has no year column;
 * the API buckets the signing date against `registration_school_years`
 * windows). The year dropdown here filters on that derived label —
 * campus visits aren't tied to the global year selector because a
 * visitor isn't an applicant yet.
 *
 * Table shape matches the other recruitment lists: single-line cells,
 * relative Signed times, row click opens the visitor detail sheet
 * (which holds everything trimmed from the table — email, school,
 * academic year, and the signed waiver).
 */
export default function CampusVisitsPage() {
  const { data, isLoading, error, mutate } = useSWR<CampusVisitRow[]>(
    "/api/admin/campus-visits",
    adminFetcher,
    { refreshInterval: 60_000 }
  );
  const rows = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  // Year filter options come from the data itself (derived labels),
  // newest year first — matches the newest-first row sort.
  const yearOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
      if (!seen.has(r.academic_year)) {
        seen.add(r.academic_year);
        out.push(r.academic_year);
      }
    }
    return out;
  }, [rows]);
  const [year, setYear] = useState<string>("all");
  const visible = useMemo(
    () => (year === "all" ? rows : rows.filter((r) => r.academic_year === year)),
    [rows, year]
  );

  // Search is lifted out of the DataTable (via `externalSearch`) so the
  // Copy / Export actions can operate on exactly what's on screen —
  // otherwise they'd silently ignore the search box and hand back rows
  // the user had already filtered away.
  const [search, setSearch] = useState("");
  const exportRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter((r) =>
      [r.parent_name, r.parent_email, r.parent_phone, r.student_name, r.student_school]
        .some((v) => (v ?? "").toLowerCase().includes(q))
    );
  }, [visible, search]);

  const [copied, setCopied] = useState(false);

  function handleExport() {
    if (exportRows.length === 0) {
      toast.error("Nothing to export.");
      return;
    }
    downloadCampusVisitsCsv(exportRows, year === "all" ? "all-years" : year);
    toast.success(
      `Exported ${exportRows.length} visit${exportRows.length === 1 ? "" : "s"} to CSV.`
    );
  }

  async function handleCopy() {
    if (exportRows.length === 0) {
      toast.error("Nothing to copy.");
      return;
    }
    try {
      await copyCampusVisitsTable(exportRows);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(
        `Copied ${exportRows.length} visit${exportRows.length === 1 ? "" : "s"} to the clipboard.`
      );
    } catch (err) {
      console.error("[CampusVisits.handleCopy]", err);
      toast.error("Couldn't copy to the clipboard.");
    }
  }

  const [selected, setSelected] = useState<CampusVisitRow | null>(null);
  // Re-read from the list so the open sheet reflects rating /
  // follow-up / note writes after revalidation.
  const activeRow = selected
    ? (rows.find((r) => r.id === selected.id) ?? selected)
    : null;

  // Inline star write — same endpoint every lead surface uses.
  async function setRating(row: CampusVisitRow, rating: number) {
    try {
      mutate(
        (curr) =>
          (curr ?? []).map((r) => (r.id === row.id ? { ...r, rating } : r)),
        { revalidate: false }
      );
      const res = await fetch("/api/admin/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "visit",
          id: row.id,
          interest_level: rating,
        }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      mutate();
    } catch (err) {
      console.error("Failed to save visit rating:", err);
      toast.error("Couldn't save the rating.");
      mutate();
    }
  }

  // Defined inline (not memoized) — the rating cell's closure needs
  // `setRating`'s latest SWR bindings.
  const columns: ColumnDef<CampusVisitRow>[] = [
      {
        key: "rating",
        header: "Rating",
        sortable: true,
        width: "w-[10%]",
        accessor: (r) => r.rating,
        render: (r) => (
          <StarRating
            value={r.rating}
            onChange={(v) => void setRating(r, v)}
          />
        ),
      },
      {
        key: "signed_ts",
        header: "Signed",
        sortable: true,
        width: "w-[8%]",
        render: (r) => (
          <span
            className="whitespace-nowrap text-sm tabular-nums text-muted-foreground"
            title={new Date(r.signed_ts).toLocaleString()}
          >
            {relTime(r.signed_ts)}
          </span>
        ),
      },
      {
        key: "parent_name",
        header: "Parent",
        sortable: true,
        searchable: true,
        width: "w-[16%]",
        render: (r) => (
          <span className="block truncate text-sm font-medium">
            {r.parent_name}
          </span>
        ),
      },
      {
        key: "parent_email",
        header: "Email",
        sortable: true,
        searchable: true,
        width: "w-[19%]",
        render: (r) =>
          r.parent_email ? (
            <a
              href={`mailto:${r.parent_email}`}
              className="block truncate text-sm hover:underline"
              title={r.parent_email}
              onClick={(e) => e.stopPropagation()}
            >
              {r.parent_email}
            </a>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        key: "parent_phone",
        header: "Phone",
        searchable: true,
        width: "w-[12%]",
        render: (r) =>
          r.parent_phone ? (
            <a
              href={`tel:${r.parent_phone}`}
              className="text-sm tabular-nums hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {formatUSPhone(r.parent_phone) || r.parent_phone}
            </a>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        key: "student_name",
        header: "Student",
        sortable: true,
        searchable: true,
        width: "w-[15%]",
        render: (r) => (
          <span className="block truncate text-sm">{r.student_name}</span>
        ),
      },
      {
        key: "student_grade",
        header: "Grade",
        sortable: true,
        width: "w-[7%]",
        render: (r) => (
          <span className="text-sm">
            {r.student_grade ? `Grade ${r.student_grade}` : "—"}
          </span>
        ),
      },
      {
        key: "student_school",
        header: "Current School",
        sortable: true,
        searchable: true,
        width: "w-[12%]",
        render: (r) => (
          <span className="block truncate text-sm">
            {r.student_school || "—"}
          </span>
        ),
      },
      {
        key: "marketing_opt_in",
        header: "Marketing",
        width: "w-[8%]",
        accessor: (r) => (r.marketing_opt_in ? 1 : 0),
        render: (r) =>
          r.marketing_opt_in ? (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
              Opted in
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        key: "followed_up",
        header: "Follow-up",
        sortable: true,
        width: "w-[9%]",
        accessor: (r) => (r.followed_up ? 1 : 0),
        render: (r) =>
          r.followed_up ? (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
              Followed up
            </Badge>
          ) : (
            <span
              className="text-xs text-muted-foreground"
              title={
                r.last_reach_out
                  ? `Last contacted ${new Date(r.last_reach_out).toLocaleString()}`
                  : undefined
              }
            >
              {r.last_reach_out ? relTime(r.last_reach_out) : "Needs"}
            </span>
          ),
      },
      {
        key: "id",
        header: "",
        width: "w-[36px]",
        align: "right",
        render: () => (
          <ChevronRight className="size-4 text-muted-foreground inline" />
        ),
      },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Campus Visits</h1>
          <p className="text-sm text-muted-foreground">
            Signed liability waivers and scheduled campus tours. Click a
            waiver row for the visitor&rsquo;s full details.
          </p>
        </div>
        <div className="w-44">
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="bg-white">
              <SelectValue placeholder="Academic year" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All years</SelectItem>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={y}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Two surfaces, one page: the waiver database (this card) and
          the scheduled-tours operational list. */}
      <Tabs defaultValue="waivers">
        <TabsList>
          <TabsTrigger value="waivers">Signed waivers</TabsTrigger>
          <TabsTrigger value="tours">Scheduled tours</TabsTrigger>
        </TabsList>
        <TabsContent value="tours" className="mt-4">
          <ToursPanel />
        </TabsContent>
        <TabsContent value="waivers" className="mt-4">
      <Card className="overflow-hidden bg-white py-0 gap-0">
        <CardHeader className="py-4 border-b bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">
              Signed waivers
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {exportRows.length}
                {year === "all" ? "" : ` in ${year}`}
              </span>
            </CardTitle>
            {/* Search + row actions. Copy / Export both act on exactly
                the rows the filters leave on screen. */}
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Search by parent, email, student, or school…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-full sm:w-72"
              />
              <Button
                variant="outline"
                onClick={() => void handleCopy()}
                disabled={exportRows.length === 0}
                className="bg-white"
              >
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copied ? "Copied" : "Copy table"}
              </Button>
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={exportRows.length === 0}
                className="bg-white"
              >
                <Download className="size-4" />
                Export CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 bg-white">
          {error && !data ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Couldn&rsquo;t load campus visits. Refresh to try again.
            </div>
          ) : (
            <DataTable<CampusVisitRow>
              columns={columns}
              data={visible}
              isLoading={isLoading && !data}
              externalSearch={search}
              onRowClick={(r) => setSelected(r)}
            />
          )}
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>

      {/* Visitor detail sheet — everything the table trims (email,
          school, academic year, waiver) plus the signature, and the
          shared lead triage block (rating, follow-up, comms log). */}
      {activeRow ? (
        <Sheet open onOpenChange={(o) => !o && setSelected(null)}>
          <SheetContent
            side="right"
            className="flex w-full flex-col gap-0 overflow-y-auto overscroll-contain p-0 sm:max-w-lg"
          >
            <SheetHeader className="border-b px-4 py-3">
              <SheetTitle className="text-base">
                {activeRow.parent_name || "Campus visitor"}
              </SheetTitle>
              <SheetDescription className="text-xs">
                Signed {new Date(activeRow.signed_ts).toLocaleString()}
                {activeRow.academic_year
                  ? ` · ${activeRow.academic_year}`
                  : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="border-b px-4 py-4">
              <LeadTriageControls
                scope={{ source: "visit", id: activeRow.id }}
                rating={activeRow.rating}
                isFollowedUp={activeRow.followed_up}
                lastReachOut={activeRow.last_reach_out || null}
                onChanged={() => void mutate()}
              />
            </div>

            {/* Campus tour — schedule (Google Calendar invite) or
                manage this visitor's upcoming tour. */}
            <div className="border-b px-4 py-4">
              <LeadTourSection
                scope={{ source: "visit", id: activeRow.id }}
                parentName={activeRow.parent_name}
                parentEmail={activeRow.parent_email}
                parentPhone={activeRow.parent_phone}
                studentName={activeRow.student_name}
                onChanged={() => void mutate()}
              />
            </div>

            <div className="space-y-5 px-4 py-4">
              {/* Comms log first — it's the working surface; the
                  submitted record below is reference. */}
              <section className="space-y-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Communication log
                </h3>
                <InquiryNotes
                  scope={{ source: "visit", id: activeRow.id }}
                  variant="timeline"
                />
                <div className="rounded-md border bg-muted/20 p-3">
                  <InquiryNoteComposer
                    scope={{ source: "visit", id: activeRow.id }}
                    onNoteAdded={() => void mutate()}
                  />
                </div>
              </section>

              <section className="space-y-2.5 border-t pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Parent
                </h3>
                <DetailRow label="Name" value={activeRow.parent_name} />
                <DetailRow
                  label="Email"
                  value={
                    activeRow.parent_email ? (
                      <a
                        href={`mailto:${activeRow.parent_email}`}
                        className="hover:underline"
                      >
                        {activeRow.parent_email}
                      </a>
                    ) : null
                  }
                />
                <DetailRow
                  label="Phone"
                  value={
                    activeRow.parent_phone ? (
                      <a
                        href={`tel:${activeRow.parent_phone}`}
                        className="tabular-nums hover:underline"
                      >
                        {formatUSPhone(activeRow.parent_phone) ||
                          activeRow.parent_phone}
                      </a>
                    ) : null
                  }
                />
                <DetailRow
                  label="Marketing"
                  value={
                    activeRow.marketing_opt_in ? (
                      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                        Opted in
                      </Badge>
                    ) : (
                      "Not opted in"
                    )
                  }
                />
              </section>

              <section className="space-y-2.5 border-t pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Student
                </h3>
                <DetailRow label="Name" value={activeRow.student_name} />
                <DetailRow
                  label="Grade"
                  value={
                    activeRow.student_grade
                      ? `Grade ${activeRow.student_grade}`
                      : null
                  }
                />
                <DetailRow
                  label="Current school"
                  value={activeRow.student_school}
                />
                <DetailRow
                  label="Academic year"
                  value={activeRow.academic_year}
                />
              </section>

              <section className="space-y-2.5 border-t pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Waiver
                </h3>
                <DetailRow
                  label="Signed"
                  value={new Date(activeRow.signed_ts).toLocaleString()}
                />
                {activeRow.signature_url ? (
                  <>
                    <div className="rounded-md border bg-muted/20 p-3">
                      {/* Signature capture — plain img (Xano-hosted,
                          arbitrary dimensions). */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={activeRow.signature_url}
                        alt={`Signature — ${activeRow.parent_name}`}
                        className="max-h-28 w-auto"
                      />
                    </div>
                    <a
                      href={activeRow.signature_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline underline-offset-2 hover:no-underline"
                    >
                      Open signature
                      <ExternalLink className="size-3" />
                    </a>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No signature image on file.
                  </p>
                )}
              </section>
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium">
        {value || <span className="font-normal text-muted-foreground">—</span>}
      </span>
    </div>
  );
}

/** Compact relative time ("now", "5m ago", "3h ago", "4d ago", then a
 *  date) — same vocabulary as the inbox and enrolled lists. */
function relTime(ts: number): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  if (diff < MIN) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return new Date(ts).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
