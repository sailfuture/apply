"use client";

import { useState } from "react";
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
  User,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatUSPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
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

  // Selected parent for the detail modal. Click on a parent row →
  // open modal with the full record. Stays open until admin closes
  // or selects another parent.
  const [openParent, setOpenParent] = useState<Parent | null>(null);

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
          previously surfaced cross-year app status. */}
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Students</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 bg-white">
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
                  <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground text-right w-10" />
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
                  const latestYear = latestYearByStudent.get(s.id);
                  const href = latestYear
                    ? `/admin/enrolled/${s.id}?yearId=${latestYear}`
                    : null;
                  return (
                    <TableRow
                      key={s.id}
                      className={cn(
                        s.isArchived && "bg-muted/30",
                        href && "cursor-pointer hover:bg-muted/30"
                      )}
                    >
                      <TableCell className="font-medium p-0">
                        {href ? (
                          <Link
                            href={href}
                            className="block px-4 py-3 hover:underline"
                          >
                            {name}
                          </Link>
                        ) : (
                          <span className="block px-4 py-3">{name}</span>
                        )}
                      </TableCell>
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
        <CardContent className="px-3 pb-3 bg-white">
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

      {/* Applications table retired — clicking a student row in the
          card above takes admin into the per-student enrolled detail
          page, where per-year status + drill-down lives. Cross-year
          family workspace still reachable via the "Open year"
          buttons elsewhere; this overview surface stays focused on
          the family-level summary. */}

      <ParentDetailModal
        parent={openParent}
        onClose={() => setOpenParent(null)}
      />
    </div>
  );
}

/**
 * Parent detail modal — opens from a row click on the Parents
 * table. Shows the full bio + contact + address fields the table
 * can't surface inline without going wide. Email/phone are
 * actionable links inside the modal too.
 */
function ParentDetailModal({
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
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="size-4 text-muted-foreground" aria-hidden="true" />
            {fullName}
          </DialogTitle>
          <DialogDescription>
            {parent?.relationship
              ? `${parent.relationship} · Parent record #${parent.id}`
              : `Parent record #${parent?.id ?? ""}`}
          </DialogDescription>
        </DialogHeader>
        {parent ? (
          <dl className="space-y-3 text-sm">
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
      </DialogContent>
    </Dialog>
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

