"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Mail,
  Phone,
  SquarePen,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatUSPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { AdminFamilyOverviewResponse } from "@/app/api/admin/family-overview/[id]/route";

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
 * URL: `/admin/families/[id]/overview` — no yearId required.
 * Action buttons on the family detail page link here when admin
 * wants the cross-year picture.
 */
export default function FamilyOverviewPage() {
  const params = useParams<{ id: string }>();
  const familyId = Number(params.id);

  const swrKey = Number.isFinite(familyId)
    ? `/api/admin/family-overview/${familyId}`
    : null;
  const { data, isLoading, error } = useSWR<AdminFamilyOverviewResponse>(
    swrKey,
    adminFetcher
  );

  if (isLoading && !data) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <BackLink />
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          {error instanceof Error
            ? error.message
            : "Couldn’t load this family’s overview."}
        </div>
      </div>
    );
  }

  const { family, parents, students, emergency_contacts, applications } = data;
  const familyName =
    family.family_name?.trim() || `Family #${family.id}`;

  // Group applications by school year id so each year reads as one
  // row in the Applications card. Year names need a lookup since
  // the application row only carries the id; the per-year detail
  // page handles that, but here we just show the id as a fallback
  // when name resolution isn't available.
  const appsByYear = new Map<number, typeof applications>();
  for (const a of applications) {
    const yid = Number(a.registration_school_years_id);
    const arr = appsByYear.get(yid) ?? [];
    arr.push(a);
    appsByYear.set(yid, arr);
  }
  const yearIdsDesc = Array.from(appsByYear.keys()).sort((a, b) => b - a);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <BackLink />

      <div className="space-y-1">
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

      {/* Parents — full bio + contact links. Lowest-id-first
          ordering so the primary parent (typically the row that
          got created first) lands at the top. */}
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Parents</CardTitle>
        </CardHeader>
        <CardContent className="py-0 px-0 bg-white">
          {parents.length === 0 ? (
            <p className="text-sm italic text-muted-foreground px-5 py-4">
              No parents on file for this family.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Name
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Email
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Phone
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Relationship
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
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
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell>
                        {p.email ? (
                          <a
                            href={`mailto:${p.email}`}
                            className="inline-flex items-center gap-1 hover:underline"
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
          active, accepted, enrolled, or unenrolled. */}
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Students</CardTitle>
        </CardHeader>
        <CardContent className="py-0 px-0 bg-white">
          {students.length === 0 ? (
            <p className="text-sm italic text-muted-foreground px-5 py-4">
              No students on file for this family.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Name
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Date of birth
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Gender
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Ethnicity
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Status
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s) => {
                  const name =
                    `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() ||
                    `Student #${s.id}`;
                  const dob = s.date_of_birth
                    ? new Date(`${s.date_of_birth}T00:00:00`).toLocaleDateString()
                    : "—";
                  return (
                    <TableRow
                      key={s.id}
                      className={cn(s.isArchived && "bg-muted/30")}
                    >
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {dob}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.gender || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.ethnicity || "—"}
                      </TableCell>
                      <TableCell>
                        <StudentStatusPills student={s} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Emergency contacts — evergreen family data. Same five-
          column shape as the parents table since the data is
          similar in shape. */}
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Emergency Contacts</CardTitle>
        </CardHeader>
        <CardContent className="py-0 px-0 bg-white">
          {emergency_contacts.length === 0 ? (
            <p className="text-sm italic text-muted-foreground px-5 py-4">
              No emergency contacts on file for this family.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Name
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Email
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Phone
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Relationship
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
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

      {/* Applications — every per-year app the family has
          submitted. Click any row to jump to the year-scoped
          family detail page. Grouped by year (descending) so
          the most recent cycle is at the top. */}
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Applications</CardTitle>
            <span className="text-xs tabular-nums text-muted-foreground">
              ({applications.length})
            </span>
          </div>
        </CardHeader>
        <CardContent className="py-0 px-0 bg-white">
          {applications.length === 0 ? (
            <p className="text-sm italic text-muted-foreground px-5 py-4">
              No applications on file for this family.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    School year
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Student
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Grade
                  </TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Status
                  </TableHead>
                  <TableHead className="text-right text-[10px] uppercase tracking-wider text-muted-foreground">
                    Open
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {yearIdsDesc.map((yearId) => {
                  const yearApps = appsByYear.get(yearId) ?? [];
                  return yearApps.map((app, idx) => {
                    const student = students.find(
                      (s) => s.id === Number(app.registration_students_id)
                    );
                    const studentName = student
                      ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() ||
                        `Student #${student.id}`
                      : `Student #${app.registration_students_id}`;
                    const status = app.isAccepted
                      ? "Accepted"
                      : app.isDenied
                        ? "Denied"
                        : app.isOffered
                          ? "Offered"
                          : app.isSubmitted
                            ? "Submitted"
                            : "Draft";
                    return (
                      <TableRow key={app.id}>
                        {/* First app in the year carries the year
                            label; subsequent apps for the same year
                            leave the cell blank so the year reads as
                            a group header. */}
                        <TableCell
                          className={cn(
                            "font-medium tabular-nums",
                            idx > 0 && "text-muted-foreground/50"
                          )}
                        >
                          {idx === 0 ? `Year ${yearId}` : ""}
                        </TableCell>
                        <TableCell>{studentName}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {app.current_grade || "—"}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            {status}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="bg-white"
                          >
                            <Link
                              href={`/admin/families/${family.id}?yearId=${yearId}`}
                            >
                              Open year
                              <ExternalLink className="size-3.5 ml-1.5" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  });
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
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

/** Back link mirroring the style on every other admin detail
 *  page so the chrome reads as one product. */
function BackLink() {
  return (
    <Button asChild variant="outline" size="sm" className="bg-white w-fit">
      <Link href="/admin/applications">
        <ArrowLeft className="size-3.5 mr-1.5" />
        Back to applications
      </Link>
    </Button>
  );
}

