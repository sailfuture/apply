"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  Pencil,
  Phone,
  RotateCcw,
  Trash2,
  Undo2,
  UserMinus,
  Users,
} from "lucide-react";
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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import {
  formatNoteTimestamp,
  formatRelativeShort,
} from "@/lib/format-note-time";
import { formatUSPhone } from "@/lib/phone";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AdminEnrolledStudentResponse } from "@/app/api/admin/enrolled/[id]/route";

/**
 * Admin Enrolled Student detail page.
 *
 * URL: `/admin/enrolled/[id]?yearId=X`
 *   `[id]` is the student id; `yearId` scopes to the student's
 *   year-specific packet (re-enrolled students have packets across
 *   multiple years).
 *
 * Single-student view — does NOT show family-level information
 * beyond a one-line context strip at the top (family name + primary
 * contact). Everything else is the student's bio + their per-year
 * application + their registration packet.
 *
 * Read-only on most fields. The one mutation here is the
 * `registrationConfirmed` toggle on the packet — admin can revert
 * the confirmation if they need to (parent can then re-edit). Other
 * edits (medical info, file uploads) belong on the parent flow;
 * admin overrides are handled on the family registration detail
 * page if needed.
 */
export default function EnrolledStudentDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const studentId = Number(params.id);

  const swrKey =
    Number.isFinite(studentId) && yearId
      ? `/api/admin/enrolled/${studentId}?yearId=${yearId}`
      : null;
  const { data, isLoading, error, mutate } =
    useSWR<AdminEnrolledStudentResponse>(swrKey, adminFetcher);

  const backHref = yearId
    ? `/admin/enrolled?yearId=${yearId}`
    : "/admin/enrolled";

  if (!yearId) {
    return (
      <div className="p-6 space-y-4">
        <BackLink href={backHref} />
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          Pick a school year above to view this student&rsquo;s details.
        </div>
      </div>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="p-6 space-y-4">
        <BackLink href={backHref} />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 space-y-4">
        <BackLink href={backHref} />
        <div className="rounded-lg border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          {error instanceof Error
            ? error.message
            : "Couldn’t load this student’s details."}
        </div>
      </div>
    );
  }

  const {
    student,
    app,
    packet,
    family,
    primary,
    parents,
    emergency_contacts,
    school_year,
  } = data;
  const fullName =
    `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() ||
    `Student #${studentId}`;

  // Edit destination — for now we route to the family's registration
  // detail with a hash anchor that scrolls right to this student's
  // packet card, so admin lands on a writable surface without a
  // dedicated student-editor page. Easy to swap to a per-student
  // editor route later.
  const editHref = family
    ? `/admin/registrations/${family.id}?yearId=${yearId}#section-registration`
    : null;

  return (
    <div className="p-6 space-y-6">
      {/* Header: H1 + family/primary sub-text + last-edited captions.
          Action row + Back button moved down to sit right above the
          first card so the header reads as pure context and the
          actions land closer to the content they affect. */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold truncate">{fullName}</h1>
        <p className="text-sm text-muted-foreground min-w-0">
          {family?.family_name ? <span>{family.family_name}</span> : null}
          {family?.family_name && primary ? <span> · </span> : null}
          {primary ? (
            <span>
              {`${primary.first_name ?? ""} ${primary.last_name ?? ""}`.trim()}
              {primary.email ? ` · ${primary.email}` : ""}
            </span>
          ) : null}
        </p>
        {/* Data staleness — most recent write to either the student
            row or the per-year packet. Two timestamps because edits
            can land on either: bio + docs land on the student row,
            medical / sizing / waiver land on the packet. Showing
            both helps admin spot mismatches ("bio updated yesterday
            but packet hasn't been touched since June"). */}
        {student.last_edited_time ? (
          <p className="text-xs text-muted-foreground/80">
            Student edited{" "}
            <span title={new Date(student.last_edited_time).toLocaleString()}>
              {formatNoteTimestamp(student.last_edited_time)}
            </span>
          </p>
        ) : null}
        {packet?.last_edited_time ? (
          <p className="text-xs text-muted-foreground/80">
            Packet edited{" "}
            <span title={new Date(packet.last_edited_time).toLocaleString()}>
              {formatNoteTimestamp(packet.last_edited_time)}
            </span>
          </p>
        ) : null}
      </div>
      {/* Action row sits right above the Student Information card.
          Order left→right: Back to list (returns to the enrolled
          roster) · Delete (soft-remove from enrolled) · Unenroll
          (formal "student has left") · View family registration
          (cross-surface jump) · Edit (far right, primary forward
          action). All five share the outline+white button family
          so they read as one consistent group. */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <BackLink href={backHref} />
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {packet ? (
            <RemoveStudentButton
              packetId={packet.id}
              studentName={fullName}
              onRemoved={() => {
                // Soft-delete: registrationConfirmed=false moves
                // the row out of the enrolled list. Push admin
                // back to the list since this student no longer
                // belongs on this page.
                void mutate();
                window.location.href = backHref;
              }}
            />
          ) : null}
          <UnenrollStudentButton
            studentId={student.id}
            studentName={fullName}
            currentlyUnenrolled={student.isArchived === true}
            existingReason={student.unenrollment_reason ?? ""}
            existingDate={student.unenrollment_date ?? ""}
            existingNotes={student.unenrollment_notes ?? ""}
            onChanged={() => {
              void mutate();
            }}
          />
          {family ? (
            <Button asChild variant="outline" size="sm" className="bg-white">
              <Link href={`/admin/families/${family.id}/overview`}>
                <Users className="size-3.5 mr-1.5" />
                Family overview
              </Link>
            </Button>
          ) : null}
          {family ? (
            <Button asChild variant="outline" size="sm" className="bg-white">
              <Link
                href={`/admin/registrations/${family.id}?yearId=${yearId}`}
              >
                View family registration
                <ExternalLink className="size-3.5 ml-1.5" />
              </Link>
            </Button>
          ) : null}
          {editHref ? (
            <Button asChild variant="outline" size="sm" className="bg-white">
              <Link href={editHref}>
                <Pencil className="size-3.5 mr-1.5" />
                Edit
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <StudentBioCard student={student} app={app} />

      {/* Family Information — parents + emergency contacts in
          two stacked tables. Same rendering shape as the family
          overview page so the two surfaces feel consistent. Lives
          between the student bio and the packet so admin's
          natural reading order is "who's the student / who's
          the family / what's their registration packet / what's
          their testing status." */}
      <FamilyInformationCard
        family={family}
        parents={parents}
        emergencyContacts={emergency_contacts}
      />

      <PacketCard
        packet={packet}
        student={student}
        schoolYear={school_year}
        onChanged={() => void mutate()}
      />

      <TestingCard app={app} />
    </div>
  );
}

/**
 * Back-to-list affordance — outline button shape (not the older
 * plain-text link variant) so it matches every other navigation
 * button on the admin surface. Same `size="sm" + bg-white +
 * outline` shape as the Edit / View family registration buttons
 * in the action row below, so the page header reads as one
 * consistent button family.
 */
function BackLink({ href }: { href: string }) {
  return (
    <Button asChild variant="outline" size="sm" className="bg-white">
      <Link href={href}>
        <ArrowLeft className="size-3.5 mr-1.5" />
        Back to enrolled students
      </Link>
    </Button>
  );
}

/**
 * Read-only student bio + per-year application context. Two columns
 * of `<DisabledField>` so the rhythm matches the admin family
 * detail page's `SectionShell` content.
 */
function StudentBioCard({
  student,
  app,
}: {
  student: AdminEnrolledStudentResponse["student"];
  app: AdminEnrolledStudentResponse["app"];
}) {
  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <CardTitle className="text-base">Student Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 py-5 bg-white">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <ReadField label="First name" value={student.first_name} />
          <ReadField label="Last name" value={student.last_name} />
          <ReadField label="Date of birth" value={student.date_of_birth} />
          <ReadField label="Gender" value={student.gender} />
          <ReadField label="Ethnicity" value={student.ethnicity} />
          <ReadField label="Incoming grade" value={app?.current_grade ?? ""} />
        </div>
        {app ? (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <ReadField
              label="Current grade"
              value={app.last_grade_completed}
            />
            <ReadField
              label="Previous school"
              value={app.current_previous_school}
            />
            <ReadField
              label="Bus transportation"
              value={app.is_bus_transportation ? "Yes" : "No"}
            />
            <ReadField
              label="Bus stop"
              value={
                app.is_bus_transportation && app.bus_stop ? app.bus_stop : "—"
              }
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Family Information card — parents + emergency contacts in two
 * stacked tables. Surfaces the broader family context on the
 * single-student detail page so admin doesn't have to bounce to
 * the family overview page for routine reference (calling a
 * parent, checking an emergency contact's address, etc.).
 *
 * The data lives on the student-detail composite response; this
 * component is purely presentational. For mutations, admin uses
 * the family registration detail page.
 */
function FamilyInformationCard({
  family,
  parents,
  emergencyContacts,
}: {
  family: AdminEnrolledStudentResponse["family"];
  parents: AdminEnrolledStudentResponse["parents"];
  emergencyContacts: AdminEnrolledStudentResponse["emergency_contacts"];
}) {
  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <CardTitle className="text-base">
          Family Information
          {family?.family_name ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              · {family.family_name}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="py-0 px-0 bg-white space-y-0">
        {/* Parents — full contact roster (not just primary). Same
            shape as the parents table on the family overview page
            so admin reads both surfaces the same way. */}
        <div className="px-5 py-3 border-b">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Parents
          </p>
        </div>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {parents.map((p) => {
                const name =
                  `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() ||
                  `Parent #${p.id}`;
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
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* Emergency contacts — separated by a divider header row
            from parents above. Same five-column shape as the
            parents table for visual consistency. */}
        <div className="px-5 py-3 border-b border-t">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Emergency Contacts
          </p>
        </div>
        {emergencyContacts.length === 0 ? (
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {emergencyContacts.map((c) => {
                const name =
                  `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() ||
                  `Contact #${c.id}`;
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
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Registration packet card — surfaces the medical / health / pickup
 * info the parent submitted, plus the file uploads on the packet.
 * The single mutation here is the `registrationConfirmed` toggle in
 * the footer, mirroring the per-student row on the family registration
 * detail page so admin can flip it from either surface.
 */
function PacketCard({
  packet,
  student,
  schoolYear,
  onChanged,
}: {
  packet: AdminEnrolledStudentResponse["packet"];
  student: AdminEnrolledStudentResponse["student"];
  schoolYear: AdminEnrolledStudentResponse["school_year"];
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  // Year suffix appended to the card title at the same font size
  // as the title itself. Bullet-separated so the year reads as a
  // peer label, not a subtitle.
  const yearSuffix = schoolYear?.year_name ? ` · ${schoolYear.year_name}` : "";

  if (!packet) {
    return (
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">
            Registration Packet{yearSuffix}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-5 bg-white">
          <p className="text-sm text-muted-foreground">
            No registration packet on file for this student. The
            family hasn&rsquo;t started the post-acceptance flow yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  async function toggleConfirmed() {
    if (!packet) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/student-registration/${packet.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            registrationConfirmed: !packet.registrationConfirmed,
          }),
        }
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Update failed (${res.status})`);
      }
      toast.success(
        packet.registrationConfirmed
          ? `${student.first_name} marked pending.`
          : `${student.first_name} marked confirmed.`
      );
      onChanged();
    } catch (err) {
      console.error("[PacketCard.toggleConfirmed]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't update.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">
            Registration Packet{yearSuffix}
          </CardTitle>
          {/* Confirmed/Pending pill + last-edited caption sit
              inline on the same horizontal axis as the title.
              `items-center gap-2` keeps both elements vertically
              centered next to each other; the caption gets a
              `whitespace-nowrap` so it doesn't fold to a second
              line on narrow widths. */}
          <div className="flex items-center gap-2 shrink-0">
            {packet.last_edited_time ? (
              <span
                className="text-[10px] text-muted-foreground/80 whitespace-nowrap"
                title={new Date(packet.last_edited_time).toLocaleString()}
              >
                Last edited {formatNoteTimestamp(packet.last_edited_time)}
              </span>
            ) : null}
            {packet.registrationConfirmed ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800">
                <CheckCircle2 className="size-2.5" />
                Confirmed
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Pending
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent
        className={cn(
          "space-y-6 py-5 bg-white transition-colors",
          packet.registrationConfirmed && "bg-muted/30"
        )}
      >
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Sizing
          </p>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <ReadField label="Shirt size" value={packet.shirt_size} />
            <ReadField label="Pant size" value={packet.pant_size} />
            <ReadField label="Swim level" value={packet.swim_level} />
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Medical
          </p>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <ReadField label="Allergies" value={packet.allergies} />
            <ReadField
              label="Dietary restrictions"
              value={packet.dietary_restrictions}
            />
            <ReadField
              label="Prescription medications"
              value={packet.prescription_medications}
            />
            <ReadField
              label="Health conditions"
              value={packet.health_conditions}
            />
            <ReadField
              label="Vision impairments"
              value={packet.vision_impairments}
            />
            <ReadField
              label="Hearing impairments"
              value={packet.hearing_impairments}
            />
            <ReadField
              label="On Medicaid"
              value={packet.is_student_on_medicaid ? "Yes" : "No"}
            />
            <ReadField
              label="Carries EpiPen"
              value={packet.carry_epi_pen ? "Yes" : "No"}
            />
          </div>
          {packet.iep_description ? (
            <ReadField
              label="IEP description"
              value={packet.iep_description}
            />
          ) : null}
          {packet.epipen_explainer ? (
            <ReadField
              label="EpiPen details"
              value={packet.epipen_explainer}
            />
          ) : null}
          {packet.additional_health_information ? (
            <ReadField
              label="Additional health information"
              value={packet.additional_health_information}
            />
          ) : null}
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Pickup &amp; counseling
          </p>
          <div className="grid gap-4 grid-cols-1">
            <ReadField
              label="Other adults approved for pickup"
              value={packet.other_adults_approved_for_pickup}
            />
            <ReadField
              label="Prohibited adults"
              value={packet.prohibited_adults}
            />
            <ReadField
              label="Acetaminophen permission"
              value={packet.permission_for_acetaminophen}
            />
            <ReadField
              label="Counseling services interest"
              value={packet.interested_in_counseling_services}
            />
          </div>
        </div>

        {/* Required Documents — table view with per-doc admin
            confirm. Same shape as the Documents to Review block
            on the family registration detail page so admin reads
            both surfaces with the same visual vocabulary. The
            optional documents (IEP, SSN card, passport, state ID)
            render below as a simpler file list since they don't
            carry an admin-confirm triplet. */}
        <EnrolledDocsToReviewTable
          student={student}
          onChanged={onChanged}
        />

        {/* Liability waiver + optional documents — separate from
            the Documents to Review table because the waiver is a
            per-packet PDF (different shape than student-row file
            arrays) and the optional documents don't carry an
            admin-confirm triplet. */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Other Documents
          </p>
          <ul className="text-sm space-y-1.5">
            <FileLine
              label="Liability waiver (signed)"
              url={packet.liability_waiver_pdf_url}
              /* Status caption — only render on packets where the
                 waiver has been kicked off but isn't fully signed
                 yet, so admin can spot "sent 6 weeks ago, never
                 returned" rows at a glance. PandaDoc completed
                 packets carry a PDF URL and the FileLine renders
                 "Open" — no caption needed in that case. */
              caption={
                !packet.liability_waiver_pdf_url &&
                packet.liability_waiver_status &&
                packet.liability_waiver_sent_at
                  ? `${packet.liability_waiver_status} · sent ${formatNoteTimestamp(
                      new Date(packet.liability_waiver_sent_at).getTime()
                    )}`
                  : undefined
              }
            />
            <FileGroup label="IEP" files={student.iep} />
            <FileGroup label="SSN card" files={student.ssn_card} />
            <FileGroup label="Passport" files={student.passport} />
            <FileGroup label="State ID" files={student.student_state_id} />
          </ul>
        </div>
      </CardContent>
      {/* Footer.
          - Pre-confirm: Confirm Packet button (admin's only way to
            flip the bool from this page).
          - Post-confirm: audit caption "Confirmed by Mr. Thompson
            · 4d" so admin sees who locked the packet and when.
            Undo isn't surfaced here intentionally — un-confirming
            a packet belongs on the family registration detail
            page's per-student Mark Pending affordance, not this
            read-only-summary surface. */}
      <div className="border-t bg-white px-5 py-3 flex items-center justify-between gap-3">
        {packet.registrationConfirmed ? (
          <p className="text-sm text-muted-foreground truncate">
            {packet.registration_confirmed_admin_name ? (
              <>
                Confirmed by{" "}
                <span className="font-medium text-foreground">
                  {packet.registration_confirmed_admin_name}
                </span>
              </>
            ) : (
              "Confirmed"
            )}
            {packet.registration_confirmed_admin_time ? (
              <span
                title={new Date(
                  packet.registration_confirmed_admin_time
                ).toLocaleString()}
              >
                {" · "}
                {formatNoteTimestamp(
                  packet.registration_confirmed_admin_time
                )}
              </span>
            ) : null}
          </p>
        ) : (
          <>
            <span className="text-sm text-muted-foreground">
              This packet hasn&rsquo;t been admin-confirmed yet.
            </span>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={toggleConfirmed}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <CheckCircle2 className="size-3.5 mr-1.5" />
              )}
              Confirm Packet
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * Initial testing — read-only summary of NWEA scheduling + the
 * admin-entered RIT scores from the family detail page. Lives on
 * this surface as a sibling card so the per-student view is a
 * single self-contained page.
 */
function TestingCard({
  app,
}: {
  app: AdminEnrolledStudentResponse["app"];
}) {
  if (!app) return null;
  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <CardTitle className="text-base">Initial Testing (NWEA)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 py-5 bg-white">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <ReadField
            label="Scheduled"
            value={app.nwea_testing_scheduled ? "Yes" : "No"}
          />
          <ReadField
            label="Complete"
            value={app.nwea_testing_complete ? "Yes" : "No"}
          />
          <ReadField
            label="Math RIT score"
            value={
              // Treat stored 0 the same as null — the Xano column
              // defaults to 0, NWEA RIT scores are realistically
              // 100–300, so a 0 is invariably the unset state and
              // should render as the em-dash placeholder rather than
              // a literal "0". Mirrors the same coercion in the
              // family-detail TestingBlock.
              app.initial_screening_nwea_math != null &&
              app.initial_screening_nwea_math !== 0
                ? String(app.initial_screening_nwea_math)
                : ""
            }
          />
          <ReadField
            label="Math test date"
            value={app.initial_screening_nwea_math_date ?? ""}
          />
          <ReadField
            label="Reading RIT score"
            value={
              app.initial_screening_nwea_reading != null &&
              app.initial_screening_nwea_reading !== 0
                ? String(app.initial_screening_nwea_reading)
                : ""
            }
          />
          <ReadField
            label="Reading test date"
            value={app.initial_screening_nwea_reading_date ?? ""}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Read-only field — labeled disabled input. Standalone here rather
 * than imported because the family detail page's `DisabledField` is
 * not exported, and the rule for both surfaces is identical:
 * `text-xs` label, `disabled` input, em-dash for empty.
 */
function ReadField({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  const display =
    value === null || value === undefined || value === ""
      ? "—"
      : String(value);
  return (
    <Field>
      <FieldLabel className="text-xs">{label}</FieldLabel>
      <Input
        value={display}
        disabled
        className="border-input bg-white text-foreground disabled:opacity-100 disabled:cursor-default"
      />
    </Field>
  );
}

/**
 * Renders one file/url row inside the Documents list. Accepts either
 * a Xano file metadata object (`{ path, url, mime, size }`) or a
 * plain URL string (used for the liability waiver PDF). Empty values
 * collapse to a muted "Not uploaded" line.
 */
function FileLine({
  label,
  file,
  url,
  caption,
}: {
  label: string;
  /** Xano file metadata blob — could be object or array (legacy). */
  file?: Record<string, unknown> | null;
  /** Direct URL fallback (used by the liability waiver PDF). */
  url?: string;
  /** Optional muted caption rendered under the label — used to show
   *  in-progress status on the waiver row ("sent · 2 weeks ago"). */
  caption?: string;
}) {
  const resolvedUrl = url || resolveFileUrl(file);
  return (
    <li className="flex items-center justify-between gap-3 border-t first:border-t-0 py-1.5">
      <div className="min-w-0">
        <span className="text-sm text-muted-foreground">{label}</span>
        {caption ? (
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
            {caption}
          </p>
        ) : null}
      </div>
      {resolvedUrl ? (
        <a
          href={resolvedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
        >
          Open
          <ExternalLink className="size-3" />
        </a>
      ) : (
        <span className="text-xs italic text-muted-foreground/70">
          Not uploaded
        </span>
      )}
    </li>
  );
}

/**
 * Documents to Review — same shape as the family-registration
 * detail's `RequiredDocumentsTable`, scoped to the enrolled
 * student detail page. Renders the four required documents
 * (immunization / birth certificate / school health / transcripts)
 * with file links + per-doc Mark Confirmed + Undo affordances.
 * PATCHes `/api/admin/students/[id]` which auto-stamps the
 * matching `*_admin_confirm_time` / `*_admin_confirm_admin` audit
 * pair on flip.
 */
function EnrolledDocsToReviewTable({
  student,
  onChanged,
}: {
  student: AdminEnrolledStudentResponse["student"];
  onChanged: () => void;
}) {
  // Track which doc's PATCH is mid-flight so each row's spinner
  // is scoped to itself rather than blanking all four buttons.
  const [savingDoc, setSavingDoc] = useState<
    | "birth_certificate_admin_confirm"
    | "school_health_form_admin_confirm"
    | "transcripts_admin_confirm"
    | "immunization_admin_confirm"
    | null
  >(null);

  type DocSpec = {
    label: string;
    files: Record<string, unknown>[];
    confirm: {
      confirmed: boolean;
      confirmed_time: number | null;
      confirmed_admin: string;
    };
    confirmKey:
      | "birth_certificate_admin_confirm"
      | "school_health_form_admin_confirm"
      | "transcripts_admin_confirm"
      | "immunization_admin_confirm";
  };

  const docs: DocSpec[] = [
    {
      label: "Birth Certificate",
      files: student.birth_certificate,
      confirm: student.document_confirms.birth_certificate,
      confirmKey: "birth_certificate_admin_confirm",
    },
    {
      label: "School Health Form",
      files: student.school_health_form,
      confirm: student.document_confirms.school_health_form,
      confirmKey: "school_health_form_admin_confirm",
    },
    {
      label: "Transcripts",
      files: student.transcripts,
      confirm: student.document_confirms.transcripts,
      confirmKey: "transcripts_admin_confirm",
    },
    {
      label: "Immunization Forms",
      files: student.immunization_forms,
      confirm: student.document_confirms.immunization_forms,
      confirmKey: "immunization_admin_confirm",
    },
  ];

  const confirmable = docs.filter((d) => d.files.length > 0);
  const confirmedCount = confirmable.filter((d) => d.confirm.confirmed).length;

  async function toggleDoc(doc: DocSpec, next: boolean) {
    setSavingDoc(doc.confirmKey);
    try {
      const res = await fetch(`/api/admin/students/${student.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [doc.confirmKey]: next }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Update failed (${res.status})`);
      }
      toast.success(
        next
          ? `${doc.label} confirmed.`
          : `${doc.label} confirmation cleared.`
      );
      onChanged();
    } catch (err) {
      console.error("[EnrolledDocsToReviewTable.toggleDoc]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't update.");
    } finally {
      setSavingDoc(null);
    }
  }

  return (
    <div className="rounded-md border bg-muted/20 overflow-hidden">
      <div className="px-4 py-2 border-b bg-muted/40 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Documents to Review
        </p>
        {confirmable.length > 0 ? (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {confirmedCount}/{confirmable.length} confirmed
          </span>
        ) : null}
      </div>
      <Table className="text-sm table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[28%] text-[10px] uppercase tracking-wider text-muted-foreground">
              Document
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              File(s)
            </TableHead>
            <TableHead className="w-[15%] text-[10px] uppercase tracking-wider text-muted-foreground">
              Confirmed by
            </TableHead>
            <TableHead className="w-[80px] text-[10px] uppercase tracking-wider text-muted-foreground">
              Time
            </TableHead>
            <TableHead className="w-[170px] text-right text-[10px] uppercase tracking-wider text-muted-foreground">
              Confirmation
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.map((doc) => {
            const hasFiles = doc.files.length > 0;
            const confirmed = doc.confirm.confirmed;
            const saving = savingDoc === doc.confirmKey;
            // Treat the legacy "0" string as the unset sentinel —
            // the `_admin_confirm_admin` column was originally an
            // int with default 0 before being retyped to text.
            const confirmedByName = (() => {
              if (!confirmed) return null;
              const name = doc.confirm.confirmed_admin?.trim();
              if (!name || name === "0") return null;
              return name;
            })();
            const confirmedWhen =
              confirmed && doc.confirm.confirmed_time
                ? formatRelativeShort(doc.confirm.confirmed_time)
                : null;
            const confirmedWhenLong =
              confirmed && doc.confirm.confirmed_time
                ? formatNoteTimestamp(doc.confirm.confirmed_time)
                : null;
            return (
              <TableRow
                key={doc.confirmKey}
                className={cn(
                  confirmed ? "bg-emerald-50/40 hover:bg-emerald-50/60" : ""
                )}
              >
                <TableCell className="align-middle">
                  <p
                    className="text-sm font-medium truncate"
                    title={doc.label}
                  >
                    {doc.label}
                  </p>
                </TableCell>
                <TableCell className="align-middle">
                  {hasFiles ? (
                    <ul className="space-y-1">
                      {doc.files.map((f, idx) => {
                        const url = resolveFileUrl(f);
                        const name =
                          typeof (f as { name?: unknown }).name === "string"
                            ? (f as { name: string }).name
                            : typeof (f as { path?: unknown }).path ===
                                "string"
                              ? (f as { path: string }).path
                              : `File ${idx + 1}`;
                        const size = (f as { size?: unknown }).size;
                        const sizeKb =
                          typeof size === "number"
                            ? `${(size / 1024).toFixed(0)} KB`
                            : null;
                        return (
                          <li
                            key={`${doc.confirmKey}-${idx}`}
                            className="flex items-center gap-2 text-sm min-w-0"
                          >
                            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                            {url ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={name}
                                className="text-foreground underline-offset-2 hover:underline inline-flex items-center gap-1 min-w-0 flex-1"
                              >
                                <span className="truncate min-w-0">{name}</span>
                                <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                              </a>
                            ) : (
                              <span
                                className="truncate min-w-0 flex-1"
                                title={name}
                              >
                                {name}
                              </span>
                            )}
                            {sizeKb ? (
                              <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                                · {sizeKb}
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-[11px] italic text-muted-foreground">
                      No file uploaded.
                    </p>
                  )}
                </TableCell>
                <TableCell className="align-middle">
                  {confirmedByName ? (
                    <p
                      className="text-sm text-muted-foreground truncate"
                      title={confirmedByName}
                    >
                      {confirmedByName}
                    </p>
                  ) : (
                    <span className="text-xs text-muted-foreground/70">—</span>
                  )}
                </TableCell>
                <TableCell className="align-middle">
                  {confirmedWhen ? (
                    <p
                      className="text-sm text-muted-foreground truncate tabular-nums"
                      title={confirmedWhenLong ?? confirmedWhen}
                    >
                      {confirmedWhen}
                    </p>
                  ) : (
                    <span className="text-xs text-muted-foreground/70">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right align-middle">
                  <div className="inline-flex items-center gap-1">
                    <Button
                      type="button"
                      variant={confirmed ? "default" : "outline"}
                      size="sm"
                      disabled={saving || confirmed || !hasFiles}
                      onClick={() => void toggleDoc(doc, true)}
                      className={cn(
                        "h-7 text-xs leading-none",
                        confirmed &&
                          "bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-100",
                        !confirmed && "bg-white"
                      )}
                      title={
                        confirmed
                          ? "Already confirmed — use the Undo button to clear"
                          : hasFiles
                            ? `Mark ${doc.label} as reviewed`
                            : "Upload the document before confirming"
                      }
                    >
                      {saving && !confirmed ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : confirmed ? (
                        <CheckCircle2 className="size-3" />
                      ) : (
                        <Circle className="size-3" />
                      )}
                      <span>
                        {confirmed ? "Confirmed" : "Mark confirmed"}
                      </span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-7 bg-white"
                      disabled={saving || !confirmed}
                      onClick={() => void toggleDoc(doc, false)}
                      title={
                        confirmed
                          ? "Undo this confirmation"
                          : "Nothing to undo"
                      }
                      aria-label={
                        confirmed
                          ? "Undo confirmation"
                          : "Undo (disabled — nothing to undo)"
                      }
                    >
                      {saving && confirmed ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="size-3.5" />
                      )}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Pick a usable URL out of Xano's file-metadata blob. Tries
 * `file.url` first, then prepends the public Xano base to `file.path`
 * — same fallback the docs review block uses, kept inline here so
 * this page doesn't import from another component file.
 */
function resolveFileUrl(file: Record<string, unknown> | null | undefined): string | null {
  if (!file || typeof file !== "object") return null;
  const url = (file as { url?: unknown }).url;
  if (typeof url === "string" && url.length > 0) return url;
  const path = (file as { path?: unknown }).path;
  if (typeof path === "string" && path.length > 0) {
    const base =
      process.env.NEXT_PUBLIC_XANO_BASE ??
      "https://xsc3-mvx7-r86m.n7e.xano.io";
    return `${base}${path}`;
  }
  return null;
}

/**
 * Renders a labeled group of files for one document category — used
 * for the document arrays that live on the student row (birth
 * certificate, transcripts, IEP, etc.). Parents can upload multiple
 * pages per category, so a single row would lose detail.
 *
 * Layout:
 *   - Empty array → single "Not uploaded" row, mirroring the old
 *     `FileLine` look so the section reads consistently.
 *   - One file → single row with truncated filename + Open link.
 *   - Multiple files → header row with the category label + count,
 *     then one indented row per file.
 *
 * Filename truncation lives in CSS (`truncate` + `max-w-*`) rather
 * than JS so the text reflows on resize and the full filename is
 * always available via the `title` attribute on hover.
 */
function FileGroup({
  label,
  files,
}: {
  label: string;
  files: Record<string, unknown>[] | null | undefined;
}) {
  const entries = Array.isArray(files) ? files : [];
  if (entries.length === 0) {
    return (
      <li className="flex items-center justify-between gap-3 border-t first:border-t-0 py-1.5">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-xs italic text-muted-foreground/70">
          Not uploaded
        </span>
      </li>
    );
  }
  if (entries.length === 1) {
    const f = entries[0];
    const url = resolveFileUrl(f);
    const name =
      typeof (f as { name?: unknown }).name === "string"
        ? ((f as { name: string }).name)
        : "";
    return (
      <li className="flex items-center justify-between gap-3 border-t first:border-t-0 py-1.5">
        <span className="text-sm text-muted-foreground shrink-0">{label}</span>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline min-w-0"
            title={name || undefined}
          >
            <span className="truncate max-w-[18rem]">
              {name || "Open"}
            </span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
        ) : (
          <span className="text-xs italic text-muted-foreground/70">
            Unavailable
          </span>
        )}
      </li>
    );
  }
  return (
    <li className="border-t first:border-t-0 py-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground/70">
          {entries.length} files
        </span>
      </div>
      <ul className="mt-1.5 space-y-1 pl-3">
        {entries.map((f, idx) => {
          const url = resolveFileUrl(f);
          const name =
            typeof (f as { name?: unknown }).name === "string"
              ? ((f as { name: string }).name)
              : `File ${idx + 1}`;
          // `path` is unique per file in Xano's vault, so it's a
          // stable key across re-renders even when `name` collides
          // (parents sometimes upload `image.png` twice).
          const path =
            typeof (f as { path?: unknown }).path === "string"
              ? ((f as { path: string }).path)
              : `idx-${idx}`;
          return (
            <li
              key={path}
              className="flex items-center justify-between gap-3"
            >
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline min-w-0"
                  title={name}
                >
                  <span className="truncate max-w-[18rem]">{name}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              ) : (
                <span className="text-xs italic text-muted-foreground/70">
                  {name} · unavailable
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/* ─────────────────────── Remove + Unenroll affordances ─────────────────────── */

/**
 * Trash-icon button that soft-removes the student from the
 * enrolled list. PATCHes the packet to `registrationConfirmed:
 * false` — the same flow the list-page trash used to wrap. Keep
 * the wording deliberate ("Remove from enrolled list") so admin
 * understands this isn't the same thing as a formal unenrollment;
 * the packet stays and admin can re-verify from the family
 * registration page if it was a mistake.
 */
function RemoveStudentButton({
  packetId,
  studentName,
  onRemoved,
}: {
  packetId: number;
  studentName: string;
  onRemoved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function runRemove() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/student-registration/${packetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationConfirmed: false }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Remove failed (${res.status})`);
      }
      toast.success(`${studentName} removed from enrolled list.`);
      onRemoved();
    } catch (err) {
      console.error("[RemoveStudentButton.runRemove] failed:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't remove.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={saving}
        onClick={() => setOpen(true)}
        className="bg-white text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
      >
        <Trash2 className="size-3.5 mr-1.5" />
        Delete
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !saving) setOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {studentName} from the enrolled list?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This clears the admin confirmation on this
              student&rsquo;s packet for the year. The packet row
              itself — uploaded documents, medical info, signatures
              — is preserved, and admin can re-verify from the
              family registration detail page if the remove was a
              mistake. Use the Unenroll button instead when the
              student is officially leaving the program.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={(e) => {
                e.preventDefault();
                void runRemove();
              }}
            >
              {saving ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5 mr-1.5" />
              )}
              Yes, remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Unenroll affordance — captures a reason, effective date, and
 * optional long-form notes in a Dialog, then PATCHes the student
 * row with `isArchived=true` + the captured fields. The Dialog
 * (rather than a plain AlertDialog) is intentional because we
 * need text inputs + a date picker inside the modal; AlertDialog's
 * shadcn shape is built for short copy + cancel/confirm.
 *
 * The unenrollment audit lives on the student row (not the
 * per-year packet) so re-enrollment attempts in future years
 * still see the prior unenrollment history. PATCH target is
 * `/api/admin/students/[id]`, which routes through the
 * `2GcBXyoA` admin API group where the columns were added.
 *
 * Re-rendering an already-unenrolled student renders this as
 * "Unenrolled — undo?" so admin has a one-click reversal path
 * (clears `isArchived=false`, wipes reason + date + notes). Once
 * the parent SWR cache revalidates with `isArchived=true`, the
 * student drops off the list page; the detail page itself stays
 * reachable by direct URL so admin can still un-unenroll if
 * needed. Reopening to edit pre-populates the form with the
 * existing values so admin can correct a typo without retyping
 * the whole thing.
 */
function UnenrollStudentButton({
  studentId,
  studentName,
  currentlyUnenrolled,
  existingReason,
  existingDate,
  existingNotes,
  onChanged,
}: {
  studentId: number;
  studentName: string;
  currentlyUnenrolled: boolean;
  /** Existing audit values — pre-populate the modal when admin
   *  re-opens it after an unenrollment lands. Empty strings /
   *  null when nothing's been captured yet. */
  existingReason: string;
  existingDate: string;
  existingNotes: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Default date = today in YYYY-MM-DD. Captured once on mount;
  // resetting the modal goes back to today rather than holding a
  // stale prior selection.
  const today = (() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  })();
  const [reason, setReason] = useState(existingReason);
  const [date, setDate] = useState(existingDate || today);
  const [notes, setNotes] = useState(existingNotes);

  function resetForm() {
    setReason(existingReason);
    setDate(existingDate || today);
    setNotes(existingNotes);
  }

  async function runUnenroll() {
    if (!reason.trim()) {
      toast.error("Reason is required.");
      return;
    }
    if (!date) {
      toast.error("Effective date is required.");
      return;
    }
    setSaving(true);
    try {
      // Unenroll atomically: clear the enrolled gate
      // (`isEnrolled=false`) AND set the archive flag
      // (`isArchived=true`) together with the audit fields.
      // Both columns flip in the same PATCH so the student
      // can't be left in an inconsistent state between writes.
      const res = await fetch(`/api/admin/students/${studentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isEnrolled: false,
          isArchived: true,
          unenrollment_reason: reason.trim(),
          unenrollment_date: date,
          unenrollment_notes: notes.trim(),
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Unenroll failed (${res.status})`);
      }
      toast.success(`${studentName} unenrolled.`);
      setOpen(false);
      onChanged();
    } catch (err) {
      console.error("[UnenrollStudentButton.runUnenroll] failed:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't unenroll.");
    } finally {
      setSaving(false);
    }
  }

  async function runReverse() {
    setSaving(true);
    try {
      // Re-enroll atomically: flip the enrolled gate back on,
      // clear the archive flag, and blank the audit columns
      // together. Mirror of `runUnenroll` so the row leaves the
      // unenrolled state in one clean step.
      const res = await fetch(`/api/admin/students/${studentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isEnrolled: true,
          isArchived: false,
          unenrollment_reason: "",
          unenrollment_date: null,
          unenrollment_notes: "",
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Reverse failed (${res.status})`);
      }
      toast.success(`${studentName} re-enrolled.`);
      onChanged();
    } catch (err) {
      console.error("[UnenrollStudentButton.runReverse] failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't reverse unenrollment."
      );
    } finally {
      setSaving(false);
    }
  }

  if (currentlyUnenrolled) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={saving}
        onClick={() => void runReverse()}
        className="bg-white"
      >
        {saving ? (
          <Loader2 className="size-3.5 mr-1.5 animate-spin" />
        ) : (
          <Undo2 className="size-3.5 mr-1.5" />
        )}
        Undo unenrollment
      </Button>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="default"
        size="sm"
        disabled={saving}
        onClick={() => setOpen(true)}
        className="bg-black text-white hover:bg-neutral-800"
      >
        <UserMinus className="size-3.5 mr-1.5" />
        Unenroll
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !saving) {
            setOpen(false);
            resetForm();
          } else if (next) {
            setOpen(true);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Unenroll {studentName}?</DialogTitle>
            <DialogDescription>
              Capture why the student is leaving and when the
              unenrollment takes effect. The packet stays in Xano
              — uploaded documents, signatures, and audit columns
              are preserved — but the student drops off the active
              enrolled list. You can undo from this same button if
              needed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field>
              <FieldLabel>Reason for unenrollment</FieldLabel>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Family relocating, transferred schools…"
              />
            </Field>
            <Field>
              <FieldLabel>Effective date</FieldLabel>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>Notes (optional)</FieldLabel>
              {/* Long-form context — anything the headline reason
                  shouldn't carry (parent conversations, follow-up
                  plans, internal flags). Multi-line input so admin
                  can capture more than one sentence without
                  cramping. */}
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional context for the audit trail…"
                rows={3}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => {
                setOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving || !reason.trim() || !date}
              onClick={() => void runUnenroll()}
              className="bg-black text-white hover:bg-neutral-800"
            >
              {saving ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <UserMinus className="size-3.5 mr-1.5" />
              )}
              Yes, unenroll
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
