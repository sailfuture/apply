"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  CheckCircle2,
  ExternalLink,
  Mail,
  Phone,
  SquarePen,
  User,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DashboardBreadcrumb } from "@/components/dashboard-breadcrumb";
import { EmailNotificationsCard } from "@/components/admin/email-notifications-card";
import { FamilyStudentsNav, StageNav } from "@/components/admin/stage-nav";
import { adminFetcher } from "@/lib/admin-fetcher";
import { toast } from "sonner";
import { formatUSPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import {
  STATUS_META,
  deriveApplicationStatus,
} from "@/lib/application-status";
import type { AdminFamilyOverviewResponse } from "@/app/api/admin/family-overview/[id]/route";

type Parent = AdminFamilyOverviewResponse["parents"][number];

/**
 * Admin family overview — single page that shows everything about
 * a family across every school year, all in one place.
 *
 * Distinct from `/admin/families/[id]?yearId=X` which is the per-
 * year application workspace. This page is read-only summary
 * chrome: family info, parents (with contact links), students
 * (with enrollment status), emergency contacts, and every
 * application the family has ever submitted across school years.
 *
 * URL: `/admin/families/[id]/overview` — yearId is optional and
 * appears as a query param (`?yearId=N`) when admin enters from a
 * year-scoped surface. The cross-year summary always renders; the
 * year-scoped Sent emails card only renders when yearId is in the
 * URL so the audit log can filter to that year's notifications.
 */
export default function FamilyOverviewPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const familyId = Number(params.id);
  const yearIdParam = searchParams.get("yearId");
  const yearId =
    yearIdParam && Number.isFinite(Number(yearIdParam))
      ? Number(yearIdParam)
      : null;

  // Back destination — the enrolled roster (year-scoped when known),
  // matching where admin works from day to day.
  const backHref = yearId
    ? `/admin/enrolled?yearId=${yearId}`
    : "/admin/enrolled";

  const swrKey = Number.isFinite(familyId)
    ? `/api/admin/family-overview/${familyId}`
    : null;
  const { data, isLoading, error, mutate } = useSWR<AdminFamilyOverviewResponse>(
    swrKey,
    adminFetcher
  );

  // Selected parent for the detail modal. Click on a parent row →
  // open modal with the full record. Stays open until admin closes
  // or selects another parent.
  const [openParent, setOpenParent] = useState<Parent | null>(null);

  // Residential-family toggle — admin-only, family-level setting that
  // unlocks the parent dashboard's mid-year "Create New Registration"
  // add flow. Optimistic: flip this page's SWR cache immediately, then
  // revert to server truth if the PATCH fails.
  const [savingResidential, setSavingResidential] = useState(false);
  async function handleToggleResidential(next: boolean) {
    if (savingResidential) return;
    setSavingResidential(true);
    mutate(
      (cur) =>
        cur ? { ...cur, family: { ...cur.family, is_residential: next } } : cur,
      { revalidate: false }
    );
    try {
      const res = await fetch(`/api/admin/families/${familyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_residential: next }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      toast.success(
        next
          ? "Marked as a residential family."
          : "Residential family flag removed."
      );
    } catch (err) {
      console.error("Failed to update residential flag:", err);
      toast.error("Couldn't update the residential setting. Please try again.");
      mutate(); // revert to server truth
    } finally {
      setSavingResidential(false);
    }
  }

  // The nav band renders in EVERY state — familyId comes from the
  // URL, so switching between family / billing / student surfaces
  // keeps the navigation fixed in place while content loads below.
  // Layout mirrors the enrolled student page (full-width `p-6
  // space-y-6`, header block, then the band) so nothing jumps when
  // moving between the surfaces.
  const navBand = (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-4">
      <FamilyStudentsNav
        familyId={familyId}
        yearId={yearId}
        currentSection="overview"
      />
      <StageNav current="none" familyId={familyId} yearId={yearId} />
    </div>
  );

  if (isLoading && !data) {
    return (
      <div className="p-6 space-y-6">
        <div className="space-y-1 min-w-0">
          <DashboardBreadcrumb
            items={[{ label: "Enrolled Students", href: backHref }]}
          />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>
        {navBand}
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 space-y-6">
        <div className="space-y-1 min-w-0">
          <DashboardBreadcrumb
            items={[{ label: "Enrolled Students", href: backHref }]}
          />
        </div>
        {navBand}
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          {error instanceof Error
            ? error.message
            : "Couldn’t load this family’s overview."}
        </div>
      </div>
    );
  }

  const {
    family,
    parents,
    students,
    emergency_contacts,
    applications,
    application_progress,
    registration_progress,
    inquiries,
    school_years,
  } = data;
  const familyName =
    family.family_name?.trim() || `Family #${family.id}`;

  // Alphabetical by the name as displayed ("First Last"), so the list
  // reads A→Z top to bottom rather than in Xano's insertion order. A
  // large residential family runs to 20+ students; unsorted, finding
  // one means reading every row. Sorted once here, so the two tables
  // below inherit the same order.
  const sortedStudents = [...students].sort((a, b) =>
    `${a.first_name ?? ""} ${a.last_name ?? ""}`
      .trim()
      .localeCompare(`${b.first_name ?? ""} ${b.last_name ?? ""}`.trim(), "en", {
        sensitivity: "base",
      })
  );

  // Unenrolled students stay on the page but sit in their own table
  // below the roster — see the Students card comment.
  const activeStudents = sortedStudents.filter((s) => !s.isArchived);
  const unenrolledStudents = sortedStudents.filter((s) => s.isArchived);

  /** Look up a year_name from the response's `school_years` map.
   *  Falls back to "Year #N" if the map didn't include the id (Xano
   *  schoolYears fetch fell over, or the row references a stale
   *  year). Keeps the table cells stable across degraded reads. */
  const yearLabel = (yearId: number): string =>
    school_years[String(yearId)] || `Year #${yearId}`;

  // Per-student "latest year with an active app" lookup — drives the
  // Students table's clickable links. Clicking a student row jumps to
  // the per-student enrolled detail page, scoped to their most recent
  // school year. We pick the highest year id from the family's
  // applications because that's the most recently submitted cycle
  // (school years are seeded chronologically). Students with no
  // applications fall through to a non-clickable row.
  const latestYearByStudent = new Map<number, number>();
  for (const a of applications) {
    const sid = Number(a.registration_students_id);
    const yid = Number(a.registration_school_years_id);
    const prev = latestYearByStudent.get(sid) ?? 0;
    if (yid > prev) latestYearByStudent.set(sid, yid);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-1 min-w-0">
        <DashboardBreadcrumb
          items={[
            { label: "Enrolled Students", href: backHref },
            { label: familyName },
          ]}
        />
        <h1 className="text-2xl font-semibold truncate">{familyName}</h1>
        <p className="text-sm text-muted-foreground">
          Cross-year family overview · {parents.length}{" "}
          {parents.length === 1 ? "parent" : "parents"} ·{" "}
          {students.length}{" "}
          {students.length === 1 ? "student" : "students"} ·{" "}
          {emergency_contacts.length}{" "}
          {emergency_contacts.length === 1
            ? "emergency contact"
            : "emergency contacts"}
        </p>
      </div>

      {navBand}

      {/* Family settings — residential / foster flag. When on, the
          parent's enrolled dashboard surfaces a "Create New
          Registration" affordance so the family can add students
          mid-year. Family-level (not year-scoped), so it lives on the
          cross-year overview rather than a per-year workspace. */}
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Family Settings</CardTitle>
        </CardHeader>
        <CardContent className="px-5 py-4 bg-white">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <label htmlFor="residential-toggle" className="text-sm font-medium">
                Residential / Foster Family
              </label>
              <p className="text-xs text-muted-foreground max-w-prose">
                Lets this family add students throughout the year from their
                dashboard via &ldquo;Create New Registration.&rdquo; Use for
                foster placements that enroll and unenroll mid-year.
              </p>
            </div>
            <Switch
              id="residential-toggle"
              checked={family.is_residential}
              disabled={savingResidential}
              onCheckedChange={handleToggleResidential}
              aria-label="Residential family"
            />
          </div>
        </CardContent>
      </Card>

      {/* Parents — full bio + contact links. Lowest-id-first
          ordering so the primary parent (typically the row that
          got created first) lands at the top. Each row is
          clickable and opens a detail modal so admin can see the
          full bio + address without the table needing every
          column wide enough to display it. */}
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Parents</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 bg-white">
          {parents.length === 0 ? (
            <p className="text-sm italic text-muted-foreground px-2 py-4">
              No parents on file for this family.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[10px] text-muted-foreground">
                    Name
                  </TableHead>
                  <TableHead className="text-[10px] text-muted-foreground">
                    Email
                  </TableHead>
                  <TableHead className="text-[10px] text-muted-foreground">
                    Phone
                  </TableHead>
                  <TableHead className="text-[10px] text-muted-foreground">
                    Relationship
                  </TableHead>
                  <TableHead className="text-[10px] text-muted-foreground">
                    Address
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parents.map((p) => {
                  const name =
                    `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() ||
                    `Parent #${p.id}`;
                  const address = [p.address_line_1, p.city, p.state, p.zipcode]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer"
                      onClick={() => setOpenParent(p)}
                    >
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell>
                        {p.email ? (
                          // `stopPropagation` so clicking the mailto
                          // link doesn't also fire the row's modal.
                          // Same pattern on the tel link below.
                          <a
                            href={`mailto:${p.email}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 hover:underline max-w-full min-w-0"
                          >
                            <Mail className="size-3 shrink-0" />
                            <span className="truncate">{p.email}</span>
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {p.phone ? (
                          <a
                            href={`tel:${String(p.phone).replace(/\D/g, "")}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 hover:underline tabular-nums"
                          >
                            <Phone className="size-3 shrink-0" />
                            {formatUSPhone(p.phone)}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.relationship || "—"}
                      </TableCell>
                      <TableCell
                        className="text-muted-foreground max-w-xs truncate"
                        title={address}
                      >
                        {address || "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Students — every student associated with the family
          regardless of year. Archive / enrollment state surface
          as pills so admin can see at a glance which students are
          active, accepted, enrolled, or unenrolled. Each row is
          clickable and routes into the per-student enrolled detail
          page scoped to that student's most recent school year —
          replaces the standalone Applications table below that
          previously surfaced cross-year app status.

          Unenrolled students get their own table below rather than a
          greyed row mixed into this one. They stay on the page — the
          family's history matters, and a sibling who left is exactly
          the kind of context admin needs when the next one applies —
          but they aren't part of "who is here now", and reading them
          off a shared list meant checking a pill on every row. */}
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Students</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 bg-white">
          {students.length === 0 ? (
            <p className="text-sm italic text-muted-foreground px-5 py-4">
              No students on file for this family.
            </p>
          ) : activeStudents.length === 0 ? (
            <p className="text-sm italic text-muted-foreground px-5 py-4">
              Every student on this family is unenrolled — see below.
            </p>
          ) : (
            <StudentsTable
              rows={activeStudents}
              latestYearByStudent={latestYearByStudent}
            />
          )}
        </CardContent>
      </Card>

      {unenrolledStudents.length > 0 ? (
        <Card className="overflow-hidden gap-0 py-0 bg-white">
          <CardHeader className="py-3 !pb-3 border-b">
            <CardTitle className="text-base">
              Unenrolled Students
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground align-middle">
                {unenrolledStudents.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 bg-white">
            <StudentsTable
              rows={unenrolledStudents}
              latestYearByStudent={latestYearByStudent}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* Emergency contacts — evergreen family data. Same five-
          column shape as the parents table since the data is
          similar in shape. */}
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Emergency Contacts</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 bg-white">
          {emergency_contacts.length === 0 ? (
            <p className="text-sm italic text-muted-foreground px-5 py-4">
              No emergency contacts on file for this family.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[10px] text-muted-foreground">
                    Name
                  </TableHead>
                  <TableHead className="text-[10px] text-muted-foreground">
                    Email
                  </TableHead>
                  <TableHead className="text-[10px] text-muted-foreground">
                    Phone
                  </TableHead>
                  <TableHead className="text-[10px] text-muted-foreground">
                    Relationship
                  </TableHead>
                  <TableHead className="text-[10px] text-muted-foreground">
                    Address
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {emergency_contacts.map((c) => {
                  const name =
                    `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() ||
                    `Contact #${c.id}`;
                  const address = [c.address_line_1, c.city, c.state, c.zipcode]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell>
                        {c.email ? (
                          <a
                            href={`mailto:${c.email}`}
                            className="inline-flex items-center gap-1 hover:underline"
                          >
                            <Mail className="size-3 shrink-0" />
                            <span className="truncate">{c.email}</span>
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {c.phone ? (
                          <a
                            href={`tel:${String(c.phone).replace(/\D/g, "")}`}
                            className="inline-flex items-center gap-1 hover:underline tabular-nums"
                          >
                            <Phone className="size-3 shrink-0" />
                            {formatUSPhone(c.phone)}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.relationship || "—"}
                      </TableCell>
                      <TableCell
                        className="text-muted-foreground max-w-xs truncate"
                        title={address}
                      >
                        {address || "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Inquiries — pre-application touchpoints submitted via the
          public /inquiry form. We match by email (primary OR
          secondary parent) since the inquiry side only records a
          primary email. Each row deep-links to the inquiries page
          for the full record. */}
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">
            Inquiries
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              · matches any parent email on file
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 bg-white">
          {inquiries.length === 0 ? (
            <p className="text-sm italic text-muted-foreground px-2 py-4">
              No inquiries match this family&rsquo;s parent emails.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[10px] text-muted-foreground">
                    Submitted
                  </TableHead>
                  <TableHead className="text-[10px] text-muted-foreground">
                    Parent
                  </TableHead>
                  <TableHead className="text-[10px] text-muted-foreground">
                    Student
                  </TableHead>
                  <TableHead className="text-[10px] text-muted-foreground">
                    Grade
                  </TableHead>
                  <TableHead className="text-[10px] text-muted-foreground">
                    Followed Up
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inquiries.map((inq) => {
                  const parentName =
                    `${inq.primary_first_name ?? ""} ${inq.primary_last_name ?? ""}`.trim() ||
                    inq.primary_email ||
                    "—";
                  const studentName =
                    `${inq.student_first_name ?? ""} ${inq.student_last_name ?? ""}`.trim() ||
                    "—";
                  return (
                    <TableRow
                      key={inq.id}
                      className="cursor-pointer"
                      onClick={() => {
                        // Inquiries list page — admin can drill into
                        // the full inquiry record from there.
                        window.location.href = "/admin/inquiries";
                      }}
                    >
                      <TableCell className="tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateShort(inq.created_at)}
                      </TableCell>
                      <TableCell className="font-medium">{parentName}</TableCell>
                      <TableCell>{studentName}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {inq.starting_grade || inq.current_grade || "—"}
                      </TableCell>
                      <TableCell>
                        {inq.isFollowedUp ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800">
                            <CheckCircle2 className="size-2.5" />
                            Followed up
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-800">
                            <SquarePen className="size-2.5" />
                            Pending
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Applications — one row per (family, year). Status pill
          uses the same lifecycle derivation (`deriveApplicationStatus`)
          the admin Applications list uses, so the label here matches
          what admin sees in the queue. Each row deep-links to the
          per-year application workspace. */}
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Applications</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 bg-white">
          {application_progress.length === 0 ? (
            <p className="text-sm italic text-muted-foreground px-2 py-4">
              No applications on file for this family.
            </p>
          ) : (
            // Column widths match the Registrations table directly
            // below so the two surfaces read as a single tabular
            // comparison. Keep these in sync: School year 15% ·
            // col-2 20% · Status 30% · Submitted 25% · Open 10%.
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[15%] text-[10px] text-muted-foreground">
                    School Year
                  </TableHead>
                  <TableHead className="w-[20%] text-[10px] text-muted-foreground">
                    Type
                  </TableHead>
                  <TableHead className="w-[30%] text-[10px] text-muted-foreground">
                    Status
                  </TableHead>
                  <TableHead className="w-[25%] text-[10px] text-muted-foreground">
                    Submitted
                  </TableHead>
                  <TableHead className="w-[10%] text-[10px] text-muted-foreground" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {application_progress.map((ap) => {
                  const yid = Number(ap.registration_school_years_id);
                  const status = deriveApplicationStatus({
                    isSubmitted: ap.isSubmitted,
                    // The family-progress row doesn't carry per-
                    // student offer/deny flags — those live on
                    // `registration_application`. For the rollup
                    // pill we collapse to "accepted" once the
                    // family-level latch flips; "submitted" /
                    // "draft" cover the earlier states.
                    isAccepted: ap.isAccepted,
                  });
                  const meta = STATUS_META[status];
                  return (
                    <TableRow key={ap.id}>
                      <TableCell className="font-medium whitespace-nowrap">
                        {yearLabel(yid)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {ap.type ?? "New Application"}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                            meta.className
                          )}
                        >
                          {meta.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums text-xs whitespace-nowrap">
                        {ap.submitted_at
                          ? formatDateShort(ap.submitted_at)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          className="h-auto p-0 text-xs"
                        >
                          <Link href={`/admin/families/${family.id}?yearId=${yid}`}>
                            Open
                            <ExternalLink className="size-3 ml-1" aria-hidden="true" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Registrations — per-year post-acceptance progress. Each row
          reflects how far the family is through the four registration
          sections (tuition, enrollment, packet, volunteer hours) +
          whether admin has confirmed the family. Deep-links into the
          per-year registration workspace. */}
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Registrations</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 bg-white">
          {registration_progress.length === 0 ? (
            <p className="text-sm italic text-muted-foreground px-2 py-4">
              No registration packets started for this family.
            </p>
          ) : (
            // Column widths match the Applications table directly
            // above — same five-cell shape so admin scans the two
            // tables as parallel cross-year timelines.
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[15%] text-[10px] text-muted-foreground">
                    School Year
                  </TableHead>
                  <TableHead className="w-[20%] text-[10px] text-muted-foreground">
                    Sections Complete
                  </TableHead>
                  <TableHead className="w-[30%] text-[10px] text-muted-foreground">
                    Status
                  </TableHead>
                  <TableHead className="w-[25%] text-[10px] text-muted-foreground">
                    Submitted
                  </TableHead>
                  <TableHead className="w-[10%] text-[10px] text-muted-foreground" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {registration_progress.map((rp) => {
                  const yid = Number(rp.registration_school_years_id);
                  const sections = [
                    rp.isTuition,
                    rp.isEnrollment,
                    rp.isRegistration,
                    rp.isVolunteerHours,
                  ];
                  const done = sections.filter(Boolean).length;
                  return (
                    <TableRow key={rp.id}>
                      <TableCell className="font-medium whitespace-nowrap">
                        {yearLabel(yid)}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {done} / 4
                      </TableCell>
                      <TableCell>
                        {rp.isRegistrationConfirmed ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800">
                            <CheckCircle2 className="size-2.5" />
                            Confirmed
                          </span>
                        ) : rp.isSubmitted ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-800">
                            Awaiting confirmation
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            <SquarePen className="size-2.5" />
                            In progress
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums text-xs whitespace-nowrap">
                        {rp.submitted_date
                          ? formatDateShort(rp.submitted_date)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          className="h-auto p-0 text-xs"
                        >
                          <Link href={`/admin/registrations/${family.id}?yearId=${yid}`}>
                            Open
                            <ExternalLink className="size-3 ml-1" aria-hidden="true" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Sent emails — audit log of every transactional notification
          Resend has fired for this (family, year). Renders only when
          the URL carries a `yearId` query param since the log is
          year-scoped; cross-year navigation lands here without one
          and the section is skipped to keep the overview focused on
          the cross-year summary above. The card brings its own
          header + Refresh affordance so no wrapping shell is needed.
          Reads from `registration_email_notifications` written by
          `lib/emails/send.ts`. */}
      {yearId !== null ? (
        <EmailNotificationsCard familyId={familyId} yearId={yearId} />
      ) : null}

      <ParentDetailSheet
        parent={openParent}
        onClose={() => setOpenParent(null)}
      />
    </div>
  );
}

/**
 * Parent detail sheet — opens from a row click on the Parents
 * table. Shows the full bio + contact + address fields the table
 * can't surface inline without going wide. Email/phone are
 * actionable links inside the sheet too. Mirrors the inquiry detail
 * pattern (slide-out drawer rather than centered modal) so the
 * surrounding page stays in context while admin reviews details.
 */
function ParentDetailSheet({
  parent,
  onClose,
}: {
  parent: Parent | null;
  onClose: () => void;
}) {
  const open = parent !== null;
  const fullName = parent
    ? `${parent.first_name ?? ""} ${parent.last_name ?? ""}`.trim() ||
      `Parent #${parent.id}`
    : "";
  const addressLines = parent
    ? [
        parent.address_line_1,
        parent.address_line_2,
        [parent.city, parent.state, parent.zipcode].filter(Boolean).join(", "),
      ].filter(Boolean)
    : [];
  return (
    <Sheet open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0 gap-0">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle className="flex items-center gap-2">
            <User className="size-4 text-muted-foreground" aria-hidden="true" />
            {fullName}
          </SheetTitle>
          <SheetDescription>
            {parent?.relationship
              ? `${parent.relationship} · Parent record #${parent.id}`
              : `Parent record #${parent?.id ?? ""}`}
          </SheetDescription>
        </SheetHeader>
        {parent ? (
          <dl className="space-y-3 text-sm px-6 py-4 overflow-y-auto overscroll-contain">
            <DetailRow label="Email">
              {parent.email ? (
                <a
                  href={`mailto:${parent.email}`}
                  className="inline-flex items-center gap-1.5 hover:underline break-all"
                >
                  <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                  {parent.email}
                </a>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </DetailRow>
            <DetailRow label="Phone">
              {parent.phone ? (
                <a
                  href={`tel:${String(parent.phone).replace(/\D/g, "")}`}
                  className="inline-flex items-center gap-1.5 hover:underline tabular-nums"
                >
                  <Phone className="size-3.5 shrink-0 text-muted-foreground" />
                  {formatUSPhone(parent.phone)}
                </a>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </DetailRow>
            <DetailRow label="Address">
              {addressLines.length === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span className="block whitespace-pre-line">
                  {addressLines.join("\n")}
                </span>
              )}
            </DetailRow>
            <DetailRow label="Invite status">
              <span className="text-muted-foreground">
                {parent.invite_status || "—"}
              </span>
            </DetailRow>
          </dl>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3 items-start">
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground pt-0.5">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * The student roster table. Shared by the Students card and the
 * Unenrolled Students card below it so the two read as one table
 * split in half rather than two tables that drifted apart.
 */
function StudentsTable({
  rows,
  latestYearByStudent,
}: {
  rows: AdminFamilyOverviewResponse["students"];
  /** student id → most recent school year with an application; rows
   *  without one aren't clickable (there's no detail page to open). */
  latestYearByStudent: Map<number, number>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="text-[10px] text-muted-foreground">
            Name
          </TableHead>
          <TableHead className="text-[10px] text-muted-foreground">
            Date of Birth
          </TableHead>
          <TableHead className="text-[10px] text-muted-foreground">
            Gender
          </TableHead>
          <TableHead className="text-[10px] text-muted-foreground">
            Ethnicity
          </TableHead>
          <TableHead className="text-[10px] text-muted-foreground">
            Status
          </TableHead>
          <TableHead className="text-[10px] text-muted-foreground text-right w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s) => {
          const name =
            `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() ||
            `Student #${s.id}`;
          const dob = s.date_of_birth
            ? new Date(`${s.date_of_birth}T00:00:00`).toLocaleDateString()
            : "—";
          const latestYear = latestYearByStudent.get(s.id);
          // `from=overview` points the student page's back button
          // here instead of the enrolled roster.
          const href = latestYear
            ? `/admin/enrolled/${s.id}?yearId=${latestYear}&from=overview`
            : null;
          return (
            <TableRow
              key={s.id}
              // No grey fill for archived rows any more — the
              // Unenrolled table around them already says it, and
              // dimming every row in that table just made it hard
              // to read.
              className={cn(href && "cursor-pointer hover:bg-muted/30")}
            >
              <TableCell className="font-medium p-0">
                {href ? (
                  <Link href={href} className="block px-4 py-3 hover:underline">
                    {name}
                  </Link>
                ) : (
                  <span className="block px-4 py-3">{name}</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">{dob}</TableCell>
              <TableCell className="text-muted-foreground">
                {s.gender || "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {s.ethnicity || "—"}
              </TableCell>
              <TableCell>
                <StudentStatusPills student={s} />
              </TableCell>
              <TableCell className="text-right">
                {href ? (
                  <Link
                    href={href}
                    className="inline-flex text-muted-foreground hover:text-foreground"
                    aria-label={`Open ${name} detail`}
                  >
                    <ExternalLink className="size-3.5" />
                  </Link>
                ) : null}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * Status pills for a student row — surface every meaningful state
 * on the student record (accepted / enrolled / archived /
 * unenrolled) so admin can scan the column without clicking into
 * each row. Multiple pills can apply (e.g. accepted + enrolled).
 */
function StudentStatusPills({
  student,
}: {
  student: AdminFamilyOverviewResponse["students"][number];
}) {
  if (student.isArchived) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-600">
        Unenrolled
      </span>
    );
  }
  if (student.isEnrolled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800">
        <CheckCircle2 className="size-2.5" />
        Enrolled
      </span>
    );
  }
  if (student.isAccepted) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800">
        Accepted
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      <SquarePen className="size-2.5" />
      In progress
    </span>
  );
}

/** Compact date formatter shared across the per-year tables — "May
 *  17, 2026". Wraps the standard locale formatter so every row uses
 *  the same compact display without inlining the options 5 times. */
function formatDateShort(ms: number): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

/** Back link mirroring the style on every other admin detail
 *  page so the chrome reads as one product. */
