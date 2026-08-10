"use client";

import { useState, useRef, type ChangeEvent } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FileUp,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
  UserMinus,
  UserRound,
  Users,
  X,
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
} from "@/components/ui/file-upload";
import { RequestRecordsDialog } from "@/components/admin/request-records-dialog";
import { SyncToddleButton } from "@/components/admin/sync-toddle-button";
import { SufsAwardCard } from "@/components/admin/sufs-award-card";
import { ActivityLogSheet } from "@/components/admin/activity-log-sheet";
import { StageNav } from "@/components/admin/stage-nav";
import { InviteStatusBadge, ResendInviteButton } from "@/components/invite-status";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import {
  formatNoteTimestamp,
  formatRelativeShort,
} from "@/lib/format-note-time";
import { formatUSPhone } from "@/lib/phone";
import {
  generateSchoolEmail,
  generateSchoolPassword,
} from "@/lib/school-account";
import { PhoneInput } from "@/components/ui/phone-input";
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

  // Where the admin came FROM (the family surfaces append
  // `from=application|registration|overview` to their student
  // links) — the back button returns there instead of the enrolled
  // roster. Needs the family id, so the contextual href is computed
  // after data loads; every pre-data branch falls back to the list.
  const from = searchParams.get("from");
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

  const year = yearId ? `?yearId=${yearId}` : "";
  const familyId = family ? Number(family.id) : 0;
  const [contextBackHref, contextBackLabel] =
    from === "application" && familyId
      ? [`/admin/families/${familyId}${year}`, "Back to family application"]
      : from === "registration" && familyId
        ? [
            `/admin/registrations/${familyId}${year}`,
            "Back to family registration",
          ]
        : from === "overview" && familyId
          ? [
              `/admin/families/${familyId}/overview${year}`,
              "Back to family overview",
            ]
          : [backHref, "Back to enrolled students"];

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
            but packet hasn't been touched since June"). Rendered on a
            single line bullet-separated so the header stays compact;
            either piece is omitted when its timestamp is null. */}
        {student.last_edited_time || packet?.last_edited_time ? (
          <p className="text-xs text-muted-foreground/80">
            {student.last_edited_time ? (
              <>
                Student edited{" "}
                <span title={new Date(student.last_edited_time).toLocaleString()}>
                  {formatNoteTimestamp(student.last_edited_time)}
                </span>
              </>
            ) : null}
            {student.last_edited_time && packet?.last_edited_time ? (
              <span className="mx-1.5" aria-hidden="true">
                &bull;
              </span>
            ) : null}
            {packet?.last_edited_time ? (
              <>
                Packet edited{" "}
                <span title={new Date(packet.last_edited_time).toLocaleString()}>
                  {formatNoteTimestamp(packet.last_edited_time)}
                </span>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      {/* Action row sits right above the Student Information card.
          Grouped left→right: Back to list · the stage nav (funnel
          position, kept in its own segmented group so it doesn't
          read as just another action) · this page's actions ·
          Unenroll pinned last. Unenroll is the one destructive,
          hard-to-reverse action here, so it sits at the far right
          away from the things admin clicks routinely. The
          page-level Edit button was removed — each card ships its
          own Edit affordance anchored to its header. */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <BackLink href={contextBackHref} label={contextBackLabel} />
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {family ? (
            <StageNav
              current="enrollment"
              familyId={Number(family.id)}
              yearId={yearId}
            />
          ) : null}
          {/* Divider — separates "where am I" from "what can I do". */}
          <span className="h-6 w-px bg-border" aria-hidden />
          {/* Unified account activity stream — notes + texts + emails
              + system milestones in one timeline. Notes composed here
              tag this student. */}
          {family && yearId ? (
            <ActivityLogSheet
              familyId={Number(family.id)}
              yearId={Number(yearId)}
              noteStudentId={student.id}
              contextLabel={fullName}
            />
          ) : null}
          <RequestRecordsDialog
            defaults={{
              studentName: `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim(),
              dateOfBirth: student.date_of_birth ?? "",
              previousSchool: app?.current_previous_school ?? "",
              academicYear: school_year?.year_name ?? "",
            }}
            familyId={family ? Number(family.id) : undefined}
            yearId={yearId ? Number(yearId) : undefined}
          />
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
          {/* Push this student into Toddle (LMS) — updates the
              matching Toddle record or creates one. Grade comes from
              the packet's admin placement (falling back to the
              application's incoming grade) because Toddle requires a
              year group on create. */}
          <SyncToddleButton
            studentId={student.id}
            studentName={fullName}
            gradeLevel={
              packet?.grade_level?.trim() || app?.current_grade || null
            }
          />
          {family ? (
            <Button asChild variant="outline" size="sm" className="bg-white">
              <Link href={`/admin/families/${family.id}/overview`}>
                <Users className="size-3.5 mr-1.5" />
                Family overview
              </Link>
            </Button>
          ) : null}
          {/* Unenroll — far right, deliberately last. */}
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
        </div>
      </div>

      {/* Placement — admin-only grade + crew assignment. Sits above
          Student Information because it's the school's internal
          placement decision (not parent-facing) and is the first
          thing staff look for on an enrolled student. */}
      <PlacementCard
        packet={packet}
        schoolYear={school_year}
        onChanged={() => mutate()}
      />

      {/* School account — the enrollment year the student came in
          with plus the generated school email + starter password
          (first.last<YY>@sailfuture.org / <F><L>sfa<YYYY>!). */}
      <SchoolAccountCard student={student} onChanged={() => mutate()} />

      {/* SUFS award ID — the portal assigns it after the scholarship
          determination (often post-enrollment), so admin records it
          here on the application row without leaving this page. */}
      {app ? (
        <SufsAwardCard
          rows={[
            {
              applicationId: app.id,
              studentName:
                `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() ||
                `Student #${student.id}`,
              sufsType: app.sufs_type,
              sufsStatus: app.sufs_status,
              awardId: app.sufs_award_id || null,
            },
          ]}
          onSaved={() => void mutate()}
        />
      ) : null}

      {/* Student photo — admin uploads a headshot that's compressed in
          the browser and stored on the student row's `student_photo`
          image column. */}
      <StudentPhotoCard student={student} onChanged={() => mutate()} />

      <StudentBioCard
        student={student}
        app={app}
        onChanged={() => mutate()}
      />

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
        onChanged={() => mutate()}
      />

      <PacketCard
        packet={packet}
        student={student}
        schoolYear={school_year}
        onChanged={() => mutate()}
      />

      {/* Liability Waiver — its own card (lifted out of the packet's
          Other Documents list) so admin can find + download the
          signed waiver for this school year at a glance. Implicitly
          year-scoped: the waiver state lives on the same per-year
          packet the page is already scoped to. */}
      <LiabilityWaiverCard
        packet={packet}
        student={student}
        schoolYear={school_year}
      />

      <TestingCard
        student={student}
        app={app}
        onChanged={() => mutate()}
      />
    </div>
  );
}

/**
 * Back-to-list affordance — outline button shape (not the older
 * plain-text link variant) so it matches every other navigation
 * button on the admin surface. Same `size="sm" + bg-white +
 * outline` shape as the Edit / View family registration buttons
 * in the action row below, so the page header reads as one
 * consistent button family. Label varies with the `from` context —
 * "Back to family application" when the admin arrived from that
 * surface, etc.
 */
function BackLink({
  href,
  label = "Back to enrolled students",
}: {
  href: string;
  label?: string;
}) {
  return (
    <Button asChild variant="outline" size="sm" className="bg-white">
      <Link href={href}>
        <ArrowLeft className="size-3.5 mr-1.5" />
        {label}
      </Link>
    </Button>
  );
}

/**
 * Student Photo card — admin uploads a headshot for the student. The
 * file is converted from HEIC if needed, compressed + resized in the
 * browser, uploaded to Xano's image endpoint (`/upload/image`), and
 * the returned metadata is stored on the student row's `student_photo`
 * image column. Rendered as a round avatar with Replace / Remove.
 */
function StudentPhotoCard({
  student,
  onChanged,
}: {
  student: AdminEnrolledStudentResponse["student"];
  onChanged: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const photoUrl = resolveFileUrl(student.student_photo ?? null);
  const busy = uploading || removing;

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setUploading(true);
    try {
      // HEIC→JPEG (iPhone photos) first, then compress/resize.
      const { convertHeicToJpeg } = await import("@/lib/heic");
      const { compressStudentPhoto } = await import("@/lib/image-compress");
      const prepared = await compressStudentPhoto(await convertHeicToJpeg(file));

      const fd = new FormData();
      fd.append("file", prepared);
      const upRes = await fetch("/api/upload?kind=image", {
        method: "POST",
        body: fd,
      });
      if (!upRes.ok) {
        const body = await upRes.json().catch(() => null);
        throw new Error(body?.error ?? `Upload failed (${upRes.status})`);
      }
      const metadata = await upRes.json();

      const patchRes = await fetch(`/api/admin/students/${student.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_photo: metadata }),
      });
      if (!patchRes.ok) {
        const body = await patchRes.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${patchRes.status})`);
      }
      toast.success("Student photo updated.");
      onChanged();
    } catch (err) {
      console.error("[StudentPhotoCard.handleFile]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't upload photo.");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      const res = await fetch(`/api/admin/students/${student.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_photo: null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Remove failed (${res.status})`);
      }
      toast.success("Student photo removed.");
      onChanged();
    } catch (err) {
      console.error("[StudentPhotoCard.handleRemove]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't remove photo.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Card className="bg-white">
      <CardHeader>
        <CardTitle className="text-base">Student Photo</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-5">
          <div className="size-24 shrink-0 overflow-hidden rounded-full border bg-muted">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt="Student headshot"
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center text-muted-foreground">
                <UserRound className="size-10" aria-hidden="true" />
              </div>
            )}
          </div>
          <div className="space-y-2">
            <input
              ref={inputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.heic,.heif"
              className="hidden"
              onChange={handleFile}
              disabled={busy}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="bg-white"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                ) : (
                  <FileUp className="size-3.5 mr-1.5" />
                )}
                {photoUrl ? "Replace photo" : "Upload photo"}
              </Button>
              {photoUrl ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="bg-white text-red-600 hover:bg-red-50 hover:text-red-700"
                  disabled={busy}
                  onClick={() => void handleRemove()}
                >
                  {removing ? (
                    <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5 mr-1.5" />
                  )}
                  Remove
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              JPG, PNG, or HEIC. Automatically resized + compressed before
              saving.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Grade band SailFuture Academy serves — 8th through 12th. Stored
 *  as the short label ("8th"); the field label supplies the "grade"
 *  context. Used by the admin Placement card's grade select. */
const PLACEMENT_GRADE_OPTIONS = [
  "8th",
  "9th",
  "10th",
  "11th",
  "12th",
] as const;

/** Crew options for the admin Placement card's crew select. */
const PLACEMENT_CREW_OPTIONS = [
  "Crew A",
  "Crew B",
  "Crew C",
  "Crew D",
  "Crew E",
] as const;

/**
 * Placement card — admin-only grade level + crew assignment, shown
 * above Student Information because it's the school's internal
 * placement decision and the first thing staff look for. These
 * columns live on the per-student packet (so they're year-scoped,
 * like the rest of the packet) and are NOT part of the parent
 * registration flow — staff set them here post-acceptance.
 *
 * Crew changes are tracked: the PATCH route snapshots the prior crew
 * into `previous_crew_assignment` and stamps `crew_assignment_change`
 * server-side whenever the crew changes, and read mode surfaces that
 * as a "Previously Crew A · changed <date>" caption so staff can see
 * a student's most recent move at a glance. Editing only the grade
 * never touches the crew history.
 */
function PlacementCard({
  packet,
  schoolYear,
  onChanged,
}: {
  packet: AdminEnrolledStudentResponse["packet"];
  schoolYear: AdminEnrolledStudentResponse["school_year"];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    grade_level: packet?.grade_level ?? "",
    crew_assignment: packet?.crew_assignment ?? "",
  });
  const yearSuffix = schoolYear?.year_name ? ` · ${schoolYear.year_name}` : "";

  function enterEdit() {
    setDraft({
      grade_level: packet?.grade_level ?? "",
      crew_assignment: packet?.crew_assignment ?? "",
    });
    setEditing(true);
  }

  async function runSave() {
    if (!packet) return;
    // Diff-only patch. Server stamps previous_crew_assignment +
    // crew_assignment_change when crew_assignment changes — the
    // client only ever sends the new crew, never the audit columns.
    const patch: Record<string, string> = {};
    if (draft.grade_level !== (packet.grade_level ?? ""))
      patch.grade_level = draft.grade_level;
    if (draft.crew_assignment !== (packet.crew_assignment ?? ""))
      patch.crew_assignment = draft.crew_assignment;
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/student-registration/${packet.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${res.status})`);
      }
      toast.success("Placement saved.");
      setEditing(false);
      onChanged();
    } catch (err) {
      console.error("[PlacementCard.runSave]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">
            Placement{yearSuffix}
            <span className="ml-2 inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground align-middle">
              Admin only
            </span>
          </CardTitle>
          {packet ? (
            <CardEditToggle
              editing={editing}
              saving={saving}
              onEdit={enterEdit}
              onCancel={() => setEditing(false)}
              onSave={() => void runSave()}
            />
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 py-5 bg-white">
        {!packet ? (
          <p className="text-sm text-muted-foreground">
            No registration packet on file for this student yet, so grade
            and crew placement can&rsquo;t be set. The family hasn&rsquo;t
            started the post-acceptance flow.
          </p>
        ) : (
          <>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              {editing ? (
                <>
                  <EditSelectField
                    label="Grade level"
                    value={draft.grade_level}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, grade_level: v }))
                    }
                    options={PLACEMENT_GRADE_OPTIONS}
                    disabled={saving}
                  />
                  <EditSelectField
                    label="Crew assignment"
                    value={draft.crew_assignment}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, crew_assignment: v }))
                    }
                    options={PLACEMENT_CREW_OPTIONS}
                    disabled={saving}
                  />
                </>
              ) : (
                <>
                  <ReadField label="Grade level" value={packet.grade_level} />
                  <ReadField
                    label="Crew assignment"
                    value={packet.crew_assignment}
                  />
                </>
              )}
            </div>
            {/* Crew-change history — only when a prior crew + change
                time are on file. Hidden in edit mode to keep the
                editor focused on the two selects. */}
            {!editing &&
            packet.previous_crew_assignment &&
            packet.crew_assignment_change ? (
              <p className="text-xs text-muted-foreground">
                Previously{" "}
                <span className="font-medium text-foreground">
                  {packet.previous_crew_assignment}
                </span>
                {" · changed "}
                <span
                  title={new Date(
                    packet.crew_assignment_change
                  ).toLocaleString()}
                >
                  {formatNoteTimestamp(packet.crew_assignment_change)}
                </span>
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * School Account card — admin-only. Generates the student's school
 * Google-account email + starter password from their name and the
 * school year they FIRST enrolled in ("came in with"), then stores
 * all three on the student row. The year drives the email's
 * two-digit suffix (2024-2025 entry → "…24@sailfuture.org") and the
 * password's four-digit year ("HTsfa2024!") — a student who joins
 * late in an academic year still belongs to that year's cohort, so
 * admin picks the school year rather than us deriving it from a
 * calendar date. See lib/school-account.ts for the exact formats.
 */
function SchoolAccountCard({
  student,
  onChanged,
}: {
  student: AdminEnrolledStudentResponse["student"];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftYearId, setDraftYearId] = useState("");
  // Full year list for the picker — the detail payload only carries
  // the single viewed year, and the enrollment year is often earlier.
  const { data: years } = useSWR<Array<{ id: number; year_name: string }>>(
    "/api/admin/school-years",
    adminFetcher
  );
  const yearList = Array.isArray(years) ? years : [];
  const yearNameById = new Map(yearList.map((y) => [y.id, y.year_name]));

  const storedYearId = student.enrollment_school_years_id;
  const storedYearName = storedYearId
    ? (yearNameById.get(storedYearId) ?? "")
    : "";

  function enterEdit() {
    // Default to the stored year, else the student's earliest
    // associated school year — usually the year they first applied.
    let next = storedYearId ? String(storedYearId) : "";
    if (!next) {
      const associated = yearList
        .filter((y) => student.registration_school_years_id.includes(y.id))
        .sort((a, b) => a.year_name.localeCompare(b.year_name));
      next = associated[0] ? String(associated[0].id) : "";
    }
    setDraftYearId(next);
    setEditing(true);
  }

  const draftYearName = draftYearId
    ? (yearNameById.get(Number(draftYearId)) ?? "")
    : "";
  const previewEmail = generateSchoolEmail(
    student.first_name,
    student.last_name,
    draftYearName
  );
  const previewPassword = generateSchoolPassword(
    student.first_name,
    student.last_name,
    draftYearName
  );

  async function runSave() {
    if (!draftYearId || !previewEmail || !previewPassword) {
      toast.error("Pick the enrollment year first.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/students/${student.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollment_school_years_id: Number(draftYearId),
          school_email: previewEmail,
          school_password: previewPassword,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${res.status})`);
      }
      toast.success("School account saved.");
      setEditing(false);
      onChanged();
    } catch (err) {
      console.error("[SchoolAccountCard.runSave]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">
            School Account
            <span className="ml-2 inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground align-middle">
              Admin only
            </span>
          </CardTitle>
          <CardEditToggle
            editing={editing}
            saving={saving}
            onEdit={enterEdit}
            onCancel={() => setEditing(false)}
            onSave={() => void runSave()}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 py-5 bg-white">
        {editing ? (
          <>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
              <Field>
                <FieldLabel className="text-xs">Enrollment year</FieldLabel>
                <Select
                  value={draftYearId}
                  onValueChange={setDraftYearId}
                  disabled={saving}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select the year they came in…" />
                  </SelectTrigger>
                  <SelectContent>
                    {yearList.map((y) => (
                      <SelectItem key={y.id} value={String(y.id)}>
                        {y.year_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <ReadField label="School email" value={previewEmail ?? ""} />
              <ReadField label="Password" value={previewPassword ?? ""} />
            </div>
            <p className="text-xs text-muted-foreground">
              Email and password regenerate from the student&rsquo;s name
              and the selected enrollment year on save — a student who
              enrolls mid-year still belongs to that school year&rsquo;s
              cohort.
            </p>
          </>
        ) : (
          <>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
              <ReadField label="Enrollment year" value={storedYearName} />
              <ReadCopyField label="School email" value={student.school_email} />
              <ReadCopyField label="Password" value={student.school_password} />
            </div>
            {!student.school_email ? (
              <p className="text-xs text-muted-foreground">
                No school account generated yet — click Edit and pick the
                school year this student first enrolled in.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Read-only field with a copy-to-clipboard button — used by the
 *  School Account card for the generated email + password, which
 *  admin copies straight into the Google Workspace console. */
function ReadCopyField({ label, value }: { label: string; value: string }) {
  return (
    <Field>
      <FieldLabel className="text-xs">{label}</FieldLabel>
      <div className="flex items-center gap-1.5">
        <Input
          readOnly
          tabIndex={-1}
          value={value || "—"}
          className={cn("bg-muted/30", value && "font-mono text-[13px]")}
        />
        {value ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0 bg-white"
            title={`Copy ${label.toLowerCase()}`}
            onClick={() => {
              void navigator.clipboard.writeText(value);
              toast.success(`${label} copied.`);
            }}
          >
            <Copy className="size-3.5" />
            <span className="sr-only">Copy {label.toLowerCase()}</span>
          </Button>
        ) : null}
      </div>
    </Field>
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
  onChanged,
}: {
  student: AdminEnrolledStudentResponse["student"];
  app: AdminEnrolledStudentResponse["app"];
  /** Called after a successful edit-mode save so the parent can
   *  refetch the detail payload — keeps the read mode in sync
   *  with the now-persisted values. */
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    first_name: student.first_name ?? "",
    last_name: student.last_name ?? "",
    date_of_birth: student.date_of_birth ?? "",
    gender: student.gender ?? "",
    ethnicity: student.ethnicity ?? "",
    student_phone: student.student_phone ?? "",
    current_grade: app?.current_grade ?? "",
    last_grade_completed: app?.last_grade_completed ?? "",
    current_previous_school: app?.current_previous_school ?? "",
    is_bus_transportation: app?.is_bus_transportation === true,
    bus_stop: app?.bus_stop ?? "",
  });

  function enterEdit() {
    setDraft({
      first_name: student.first_name ?? "",
      last_name: student.last_name ?? "",
      date_of_birth: student.date_of_birth ?? "",
      gender: student.gender ?? "",
      ethnicity: student.ethnicity ?? "",
      student_phone: student.student_phone ?? "",
      current_grade: app?.current_grade ?? "",
      last_grade_completed: app?.last_grade_completed ?? "",
      current_previous_school: app?.current_previous_school ?? "",
      is_bus_transportation: app?.is_bus_transportation === true,
      bus_stop: app?.bus_stop ?? "",
    });
    setEditing(true);
  }

  async function runSave() {
    // Split the patch into two routes: bio fields go to the
    // student row, app fields (grade/school/transport) go to the
    // application row. Both fire in parallel; both refresh the
    // page on success.
    const studentPatch: Record<string, string> = {};
    if (draft.first_name !== (student.first_name ?? ""))
      studentPatch.first_name = draft.first_name.trim();
    if (draft.last_name !== (student.last_name ?? ""))
      studentPatch.last_name = draft.last_name.trim();
    if (draft.date_of_birth !== (student.date_of_birth ?? ""))
      studentPatch.date_of_birth = draft.date_of_birth.trim();
    if (draft.gender !== (student.gender ?? ""))
      studentPatch.gender = draft.gender;
    if (draft.ethnicity !== (student.ethnicity ?? ""))
      studentPatch.ethnicity = draft.ethnicity;
    if (draft.student_phone !== (student.student_phone ?? ""))
      studentPatch.student_phone = draft.student_phone;
    const appPatch: Record<string, string | boolean> = {};
    if (app) {
      if (draft.current_grade !== (app.current_grade ?? ""))
        appPatch.current_grade = draft.current_grade.trim();
      if (draft.last_grade_completed !== (app.last_grade_completed ?? ""))
        appPatch.last_grade_completed = draft.last_grade_completed.trim();
      if (
        draft.current_previous_school !== (app.current_previous_school ?? "")
      )
        appPatch.current_previous_school = draft.current_previous_school.trim();
      if (draft.is_bus_transportation !== (app.is_bus_transportation === true))
        appPatch.is_bus_transportation = draft.is_bus_transportation;
      if (draft.bus_stop !== (app.bus_stop ?? ""))
        appPatch.bus_stop = draft.bus_stop.trim();
    }
    if (
      Object.keys(studentPatch).length === 0 &&
      Object.keys(appPatch).length === 0
    ) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const promises: Array<Promise<Response>> = [];
      if (Object.keys(studentPatch).length > 0) {
        promises.push(
          fetch(`/api/admin/students/${student.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(studentPatch),
          })
        );
      }
      if (app && Object.keys(appPatch).length > 0) {
        promises.push(
          fetch(`/api/admin/applications/${app.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(appPatch),
          })
        );
      }
      const results = await Promise.all(promises);
      const failed = results.find((r) => !r.ok);
      if (failed) {
        const errBody = await failed.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${failed.status})`);
      }
      toast.success("Student details saved.");
      setEditing(false);
      onChanged();
    } catch (err) {
      console.error("[StudentBioCard.runSave]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Student Information</CardTitle>
          <CardEditToggle
            editing={editing}
            saving={saving}
            onEdit={enterEdit}
            onCancel={() => setEditing(false)}
            onSave={() => void runSave()}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-6 py-5 bg-white">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          {editing ? (
            <>
              <EditField
                label="First name"
                value={draft.first_name}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, first_name: v }))
                }
                disabled={saving}
              />
              <EditField
                label="Last name"
                value={draft.last_name}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, last_name: v }))
                }
                disabled={saving}
              />
              <EditField
                label="Date of birth"
                type="date"
                value={draft.date_of_birth}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, date_of_birth: v }))
                }
                disabled={saving}
              />
              <EditSelectField
                label="Gender"
                value={draft.gender}
                onChange={(v) => setDraft((d) => ({ ...d, gender: v }))}
                options={GENDER_OPTIONS}
                disabled={saving}
              />
              <EditSelectField
                label="Ethnicity"
                value={draft.ethnicity}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, ethnicity: v }))
                }
                options={ETHNICITY_OPTIONS}
                disabled={saving}
              />
              <Field>
                <FieldLabel className="text-xs">Student phone</FieldLabel>
                <PhoneInput
                  value={draft.student_phone}
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, student_phone: v }))
                  }
                  disabled={saving}
                />
              </Field>
              {app ? (
                <EditField
                  label="Incoming grade"
                  value={draft.current_grade}
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, current_grade: v }))
                  }
                  disabled={saving}
                />
              ) : null}
            </>
          ) : (
            <>
              <ReadField label="First name" value={student.first_name} />
              <ReadField label="Last name" value={student.last_name} />
              <ReadField label="Date of birth" value={student.date_of_birth} />
              <ReadField label="Gender" value={student.gender} />
              <ReadField label="Ethnicity" value={student.ethnicity} />
              <ReadField
                label="Student phone"
                value={
                  student.student_phone
                    ? formatUSPhone(student.student_phone)
                    : ""
                }
              />
              <ReadField
                label="Incoming grade"
                value={app?.current_grade ?? ""}
              />
            </>
          )}
        </div>
        {app ? (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            {editing ? (
              <>
                <EditField
                  label="Current grade"
                  value={draft.last_grade_completed}
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, last_grade_completed: v }))
                  }
                  disabled={saving}
                />
                <EditField
                  label="Previous school"
                  value={draft.current_previous_school}
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, current_previous_school: v }))
                  }
                  disabled={saving}
                />
                <EditSelectField
                  label="Bus transportation"
                  value={draft.is_bus_transportation ? "Yes" : "No"}
                  onChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      is_bus_transportation: v === "Yes",
                    }))
                  }
                  options={["Yes", "No"]}
                  disabled={saving}
                />
                <EditField
                  label="Bus stop"
                  value={draft.bus_stop}
                  onChange={(v) => setDraft((d) => ({ ...d, bus_stop: v }))}
                  disabled={saving || !draft.is_bus_transportation}
                />
              </>
            ) : (
              <>
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
                    app.is_bus_transportation && app.bus_stop
                      ? app.bus_stop
                      : "—"
                  }
                />
              </>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Gender options for the inline-edit Select. Mirrors the parent
 *  students form so admin can't pick a value the parent never sees. */
const GENDER_OPTIONS = [
  "Male",
  "Female",
  "Non-binary",
  "Prefer not to say",
] as const;

/** Ethnicity options for the inline-edit Select. NCES-aligned. */
const ETHNICITY_OPTIONS = [
  "American Indian or Alaska Native",
  "Asian",
  "Black or African American",
  "Hispanic or Latino",
  "Native Hawaiian or Pacific Islander",
  "White",
  "Two or More Races",
  "Prefer not to say",
] as const;

/**
 * Shared Edit / Save / Cancel toggle for card headers. Every
 * editable card on this page renders this in its CardHeader's
 * right-aligned slot. Edit mode shows blue Save + outline Cancel;
 * read mode shows the white-outline Edit button.
 */
function CardEditToggle({
  editing,
  saving,
  onEdit,
  onCancel,
  onSave,
}: {
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  if (!editing) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onEdit}
        className="bg-white"
      >
        <Pencil className="size-3.5 mr-1.5" />
        Edit
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onCancel}
        disabled={saving}
        className="bg-white"
      >
        Cancel
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={onSave}
        disabled={saving}
        className="bg-blue-600 hover:bg-blue-700 text-white"
      >
        {saving ? (
          <Loader2 className="size-3.5 mr-1.5 animate-spin" />
        ) : (
          <CheckCircle2 className="size-3.5 mr-1.5" />
        )}
        Save
      </Button>
    </div>
  );
}

/** Single editable text-style field with the same label rhythm
 *  as `ReadField`. Used inside card edit modes so the layout
 *  doesn't shift between read and edit states. */
function EditField({
  label,
  value,
  onChange,
  type = "text",
  disabled,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <Field>
      <FieldLabel className="text-xs">{label}</FieldLabel>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </Field>
  );
}

/** Editable Select field — paired with `EditField` for forms
 *  inside card edit modes. */
function EditSelectField({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly string[];
  disabled?: boolean;
}) {
  return (
    <Field>
      <FieldLabel className="text-xs">{label}</FieldLabel>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** Editable textarea — multi-line counterpart to `EditField`. Used
 *  inside packet/medical edit modes where the value is a narrative
 *  (allergies, prescription notes, additional health info, etc.). */
function EditTextarea({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field>
      <FieldLabel className="text-xs">{label}</FieldLabel>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="min-h-[80px]"
      />
    </Field>
  );
}

/**
 * Family Information card — parents + emergency contacts rendered
 * with the same disabled-input rhythm as the Student Information
 * card above. Each parent / contact gets its own labeled sub-
 * section with a per-row Edit / Save / Cancel cluster, so admin
 * can amend a single contact without entering a card-wide edit
 * mode. The single-row scope keeps the PATCH targeted at one
 * Xano row and avoids racing against concurrent edits to a
 * different parent.
 */
function FamilyInformationCard({
  family,
  parents,
  emergencyContacts,
  onChanged,
}: {
  family: AdminEnrolledStudentResponse["family"];
  parents: AdminEnrolledStudentResponse["parents"];
  emergencyContacts: AdminEnrolledStudentResponse["emergency_contacts"];
  /** Re-fetch the surrounding student-detail payload after a row
   *  save so the read mode reflects the persisted values. */
  onChanged: () => void;
}) {
  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <CardTitle className="text-base">
          Family Information
          {family?.family_name ? (
            <span className="ml-2 font-normal text-muted-foreground">
              · {family.family_name}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 py-5 bg-white">
        {/* Parents — one sub-section per parent. Same grid + field
            shape as the Student Information body so labels and
            inputs line up vertically across both cards. The Add
            parent affordance lives at the section header so admin
            can extend the family roster without leaving the card;
            new parents receive a Clerk sign-in invitation by email
            and gain the same dashboard access existing parents
            have. */}
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Parents
            </p>
            {family ? (
              <AddParentDialog
                familyId={family.id}
                onAdded={onChanged}
              />
            ) : null}
          </div>
          {parents.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              No parents on file for this family.
            </p>
          ) : (
            parents.map((p, idx) => (
              <ParentRowEditable
                key={p.id}
                parent={p}
                indexLabel={
                  parents.length > 1 ? `Parent ${idx + 1}` : null
                }
                onChanged={onChanged}
              />
            ))
          )}
        </div>

        {/* Emergency contacts — same shape as parents above. The
            section header reads the same so admin's eye treats
            both blocks as parallel rosters. Add contact button
            mirrors the Parents one so the two sections share the
            same affordance pattern; emergency contacts are
            contact-only records (no sign-in, no notifications). */}
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Emergency Contacts
            </p>
            {family ? (
              <AddEmergencyContactDialog
                familyId={family.id}
                onAdded={onChanged}
              />
            ) : null}
          </div>
          {emergencyContacts.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              No emergency contacts on file for this family.
            </p>
          ) : (
            emergencyContacts.map((c, idx) => (
              <EmergencyContactRowEditable
                key={c.id}
                contact={c}
                indexLabel={
                  emergencyContacts.length > 1
                    ? `Contact ${idx + 1}`
                    : null
                }
                onChanged={onChanged}
              />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Add-parent dialog. Mirrors the parent-side `/api/invites` add
 * flow: collects name + email + phone + relationship, POSTs to
 * `/api/admin/parents` which creates the Xano row, links it into
 * the family's `registration_parents_id` array, AND sends a Clerk
 * invitation email so the new parent can sign in.
 *
 * The new parent lands in Xano with `invite_status: "pending"`
 * until they accept the Clerk invitation; the Clerk webhook
 * flips it to "accepted" on first sign-in. Once they sign in
 * they'll see the same dashboard the existing parent sees and
 * get whatever per-family email notifications the app sends to
 * any parent on a family (the app routes notifications by the
 * family's parent roster — adding a parent expands the audience
 * automatically).
 */
function AddParentDialog({
  familyId,
  onAdded,
}: {
  familyId: number;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");

  function reset() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setRelationship("");
  }

  async function runSave() {
    if (!email.trim()) {
      toast.error("Email is required to send the sign-in invitation.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/parents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyId,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          relationship: relationship.trim(),
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Couldn't add parent (${res.status})`);
      }
      toast.success(
        "Parent added — sign-in invitation sent to their email."
      );
      reset();
      setOpen(false);
      onAdded();
    } catch (err) {
      console.error("[AddParentDialog.runSave]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't add.");
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
        onClick={() => setOpen(true)}
        className="bg-white"
      >
        <Plus className="size-3.5 mr-1.5" />
        Add parent
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !saving) {
            setOpen(false);
            reset();
          } else if (next) {
            setOpen(true);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a parent to this family</DialogTitle>
            <DialogDescription>
              Sends the parent a sign-in invitation to the email
              you enter. They&rsquo;ll see the same dashboard the
              existing parent sees and receive the same per-family
              email notifications.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <Field>
                <FieldLabel>First name</FieldLabel>
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={saving}
                  placeholder="Jane"
                />
              </Field>
              <Field>
                <FieldLabel>Last name</FieldLabel>
                <Input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={saving}
                  placeholder="Doe"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel>
                Email
                <span className="ml-1 text-red-500" aria-label="required">
                  *
                </span>
              </FieldLabel>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={saving}
                placeholder="parent@example.com"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Required — the Clerk sign-in invitation goes here.
              </p>
            </Field>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <Field>
                <FieldLabel>Phone</FieldLabel>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={saving}
                  placeholder="(555) 555-5555"
                />
              </Field>
              <Field>
                <FieldLabel>Relationship</FieldLabel>
                <Input
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  disabled={saving}
                  placeholder="Mother"
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                reset();
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void runSave()}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : null}
              Add &amp; send invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Add-emergency-contact dialog. Emergency contacts are contact-only
 * records (no Clerk login, no email notifications) — admin just
 * records them so the school has a backup person to call. Posts to
 * the existing `/api/admin/emergency-contacts` admin route which
 * attaches the new row to the family by id.
 */
function AddEmergencyContactDialog({
  familyId,
  onAdded,
}: {
  familyId: number;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");

  function reset() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setRelationship("");
  }

  async function runSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/emergency-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyId,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          relationship: relationship.trim(),
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(
          errBody?.error ?? `Couldn't add contact (${res.status})`
        );
      }
      toast.success("Emergency contact added.");
      reset();
      setOpen(false);
      onAdded();
    } catch (err) {
      console.error("[AddEmergencyContactDialog.runSave]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't add.");
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
        onClick={() => setOpen(true)}
        className="bg-white"
      >
        <Plus className="size-3.5 mr-1.5" />
        Add contact
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !saving) {
            setOpen(false);
            reset();
          } else if (next) {
            setOpen(true);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add an emergency contact</DialogTitle>
            <DialogDescription>
              Contact-only record — no sign-in invitation is sent.
              The school keeps this on file as a backup person to
              reach if the parents can&rsquo;t be contacted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <Field>
                <FieldLabel>First name</FieldLabel>
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={saving}
                  placeholder="Jane"
                />
              </Field>
              <Field>
                <FieldLabel>Last name</FieldLabel>
                <Input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={saving}
                  placeholder="Doe"
                />
              </Field>
            </div>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <Field>
                <FieldLabel>Email</FieldLabel>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={saving}
                  placeholder="(optional)"
                />
              </Field>
              <Field>
                <FieldLabel>Phone</FieldLabel>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={saving}
                  placeholder="(555) 555-5555"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel>Relationship</FieldLabel>
              <Input
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                disabled={saving}
                placeholder="Grandparent, aunt, neighbor, etc."
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                reset();
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void runSave()}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : null}
              Add contact
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Per-parent row with inline edit. Header strip carries the
 * "Parent N" label (when there are multiple) on the left and the
 * Edit / Save / Cancel cluster on the right. The body grid
 * matches the read-mode `ReadField` layout exactly so toggling
 * edit doesn't shift rows around.
 */
function ParentRowEditable({
  parent,
  indexLabel,
  onChanged,
}: {
  parent: AdminEnrolledStudentResponse["parents"][number];
  indexLabel: string | null;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    first_name: parent.first_name ?? "",
    last_name: parent.last_name ?? "",
    relationship: parent.relationship ?? "",
    email: parent.email ?? "",
    phone: parent.phone ?? "",
  });

  function enterEdit() {
    setDraft({
      first_name: parent.first_name ?? "",
      last_name: parent.last_name ?? "",
      relationship: parent.relationship ?? "",
      email: parent.email ?? "",
      phone: parent.phone ?? "",
    });
    setEditing(true);
  }

  async function runSave() {
    // Diff-only patch — keeps the request body lean and avoids
    // overwriting columns the form didn't touch (which would race
    // against concurrent edits on another open admin tab).
    const patch: Record<string, string> = {};
    if (draft.first_name.trim() !== (parent.first_name ?? "").trim())
      patch.first_name = draft.first_name.trim();
    if (draft.last_name.trim() !== (parent.last_name ?? "").trim())
      patch.last_name = draft.last_name.trim();
    if (draft.relationship.trim() !== (parent.relationship ?? "").trim())
      patch.relationship = draft.relationship.trim();
    if (draft.email.trim() !== (parent.email ?? "").trim())
      patch.email = draft.email.trim();
    if (draft.phone.trim() !== (parent.phone ?? "").trim())
      patch.phone = draft.phone.trim();
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/parents/${parent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${res.status})`);
      }
      toast.success("Parent saved.");
      setEditing(false);
      onChanged();
    } catch (err) {
      console.error("[ParentRowEditable.runSave]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  const displayName =
    `${parent.first_name ?? ""} ${parent.last_name ?? ""}`.trim() ||
    `Parent #${parent.id}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {indexLabel ? (
            <p className="truncate text-xs font-medium text-muted-foreground">
              {indexLabel}
              <span className="ml-1.5 text-foreground/70">· {displayName}</span>
            </p>
          ) : (
            <p className="truncate text-xs font-medium text-muted-foreground">
              {displayName}
            </p>
          )}
          <InviteStatusBadge
            status={parent.invite_status}
            clerkUserId={parent.clerk_user_id}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!editing && (
            <ResendInviteButton
              parentId={parent.id}
              admin
              status={parent.invite_status}
              clerkUserId={parent.clerk_user_id}
              onResent={onChanged}
            />
          )}
          <CardEditToggle
            editing={editing}
            saving={saving}
            onEdit={enterEdit}
            onCancel={() => setEditing(false)}
            onSave={() => void runSave()}
          />
        </div>
      </div>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
        {editing ? (
          <>
            <EditField
              label="First name"
              value={draft.first_name}
              onChange={(v) =>
                setDraft((d) => ({ ...d, first_name: v }))
              }
              disabled={saving}
            />
            <EditField
              label="Last name"
              value={draft.last_name}
              onChange={(v) =>
                setDraft((d) => ({ ...d, last_name: v }))
              }
              disabled={saving}
            />
            <EditField
              label="Relationship"
              value={draft.relationship}
              onChange={(v) =>
                setDraft((d) => ({ ...d, relationship: v }))
              }
              disabled={saving}
            />
            <EditField
              label="Email"
              type="email"
              value={draft.email}
              onChange={(v) => setDraft((d) => ({ ...d, email: v }))}
              disabled={saving}
            />
            <EditField
              label="Phone"
              value={draft.phone}
              onChange={(v) => setDraft((d) => ({ ...d, phone: v }))}
              disabled={saving}
            />
          </>
        ) : (
          <>
            <ReadField label="Name" value={displayName} />
            <ReadField
              label="Relationship"
              value={parent.relationship}
            />
            <ReadField label="Email" value={parent.email} />
            <ReadField
              label="Phone"
              value={parent.phone ? formatUSPhone(parent.phone) : ""}
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Per-emergency-contact row with inline edit. Same shape as
 * `ParentRowEditable`; separate component because the API
 * endpoints + persisted fields differ enough that sharing was
 * more abstraction than it was worth.
 */
function EmergencyContactRowEditable({
  contact,
  indexLabel,
  onChanged,
}: {
  contact: AdminEnrolledStudentResponse["emergency_contacts"][number];
  indexLabel: string | null;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    first_name: contact.first_name ?? "",
    last_name: contact.last_name ?? "",
    relationship: contact.relationship ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
  });

  function enterEdit() {
    setDraft({
      first_name: contact.first_name ?? "",
      last_name: contact.last_name ?? "",
      relationship: contact.relationship ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
    });
    setEditing(true);
  }

  async function runSave() {
    const patch: Record<string, string> = {};
    if (draft.first_name.trim() !== (contact.first_name ?? "").trim())
      patch.first_name = draft.first_name.trim();
    if (draft.last_name.trim() !== (contact.last_name ?? "").trim())
      patch.last_name = draft.last_name.trim();
    if (draft.relationship.trim() !== (contact.relationship ?? "").trim())
      patch.relationship = draft.relationship.trim();
    if (draft.email.trim() !== (contact.email ?? "").trim())
      patch.email = draft.email.trim();
    if (draft.phone.trim() !== (contact.phone ?? "").trim())
      patch.phone = draft.phone.trim();
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/emergency-contacts/${contact.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${res.status})`);
      }
      toast.success("Emergency contact saved.");
      setEditing(false);
      onChanged();
    } catch (err) {
      console.error("[EmergencyContactRowEditable.runSave]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  const displayName =
    `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() ||
    `Contact #${contact.id}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        {indexLabel ? (
          <p className="text-xs font-medium text-muted-foreground">
            {indexLabel}
            <span className="ml-1.5 text-foreground/70">· {displayName}</span>
          </p>
        ) : (
          <p className="text-xs font-medium text-muted-foreground">
            {displayName}
          </p>
        )}
        <CardEditToggle
          editing={editing}
          saving={saving}
          onEdit={enterEdit}
          onCancel={() => setEditing(false)}
          onSave={() => void runSave()}
        />
      </div>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
        {editing ? (
          <>
            <EditField
              label="First name"
              value={draft.first_name}
              onChange={(v) =>
                setDraft((d) => ({ ...d, first_name: v }))
              }
              disabled={saving}
            />
            <EditField
              label="Last name"
              value={draft.last_name}
              onChange={(v) =>
                setDraft((d) => ({ ...d, last_name: v }))
              }
              disabled={saving}
            />
            <EditField
              label="Relationship"
              value={draft.relationship}
              onChange={(v) =>
                setDraft((d) => ({ ...d, relationship: v }))
              }
              disabled={saving}
            />
            <EditField
              label="Email"
              type="email"
              value={draft.email}
              onChange={(v) => setDraft((d) => ({ ...d, email: v }))}
              disabled={saving}
            />
            <EditField
              label="Phone"
              value={draft.phone}
              onChange={(v) => setDraft((d) => ({ ...d, phone: v }))}
              disabled={saving}
            />
          </>
        ) : (
          <>
            <ReadField label="Name" value={displayName} />
            <ReadField
              label="Relationship"
              value={contact.relationship}
            />
            <ReadField label="Email" value={contact.email} />
            <ReadField
              label="Phone"
              value={contact.phone ? formatUSPhone(contact.phone) : ""}
            />
          </>
        )}
      </div>
    </div>
  );
}

const PACKET_SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
const PACKET_SWIM_LEVELS = [
  "None",
  "Beginner",
  "Intermediate",
  "Advanced",
] as const;
const PACKET_YES_NO = ["Yes", "No"] as const;

/**
 * Project the packet response to the editor's draft shape. Strings
 * stay strings (including the medicaid number — coerced back to
 * number on save); booleans render as "Yes" / "No" select strings.
 */
function packetToDraft(
  p: NonNullable<AdminEnrolledStudentResponse["packet"]>
) {
  return {
    shirt_size: p.shirt_size ?? "",
    pant_size: p.pant_size ?? "",
    swim_level: p.swim_level ?? "",
    is_student_on_medicaid: p.is_student_on_medicaid ? "Yes" : "No",
    medicaid_number: p.medicaid_number ? String(p.medicaid_number) : "",
    medicaid_provider: p.medicaid_provider ?? "",
    carry_epi_pen: p.carry_epi_pen ? "Yes" : "No",
    allergies: p.allergies ?? "",
    dietary_restrictions: p.dietary_restrictions ?? "",
    prescription_medications: p.prescription_medications ?? "",
    health_conditions: p.health_conditions ?? "",
    vision_impairments: p.vision_impairments ?? "",
    hearing_impairments: p.hearing_impairments ?? "",
    iep_description: p.iep_description ?? "",
    epipen_explainer: p.epipen_explainer ?? "",
    additional_health_information: p.additional_health_information ?? "",
    other_adults_approved_for_pickup:
      p.other_adults_approved_for_pickup ?? "",
    prohibited_adults: p.prohibited_adults ?? "",
    permission_for_acetaminophen: p.permission_for_acetaminophen ?? "",
    interested_in_counseling_services:
      p.interested_in_counseling_services ?? "",
  };
}

/**
 * Registration packet card — surfaces the medical / health / pickup
 * info the parent submitted, plus the file uploads on the packet.
 * Inline edit covers sizes / medical scalars + narrative / pickup
 * permissions; the registrationConfirmed toggle in the footer
 * mirrors the per-student row on the family registration detail
 * page so admin can flip it from either surface. Required documents
 * (file uploads) keep their own per-doc Mark-Confirmed flow and
 * aren't part of this card's edit mode.
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() =>
    packet ? packetToDraft(packet) : null
  );
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

  function enterEdit() {
    if (!packet) return;
    setDraft(packetToDraft(packet));
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(packet ? packetToDraft(packet) : null);
    setEditing(false);
  }

  async function runSave() {
    if (!packet || !draft) return;
    const patch: Record<string, string | number | boolean> = {};
    // Strings — diff against the current persisted value; trim
    // before compare so trailing whitespace doesn't count as a
    // change. The narrative + scalar fields all flow through this.
    const stringDiff = (key: keyof typeof draft, prev: string) => {
      const next = draft[key].trim();
      if (next !== (prev ?? "").trim()) patch[key] = next;
    };
    stringDiff("shirt_size", packet.shirt_size);
    stringDiff("pant_size", packet.pant_size);
    stringDiff("swim_level", packet.swim_level);
    stringDiff("medicaid_provider", packet.medicaid_provider);
    stringDiff("allergies", packet.allergies);
    stringDiff("dietary_restrictions", packet.dietary_restrictions);
    stringDiff(
      "prescription_medications",
      packet.prescription_medications
    );
    stringDiff("health_conditions", packet.health_conditions);
    stringDiff("vision_impairments", packet.vision_impairments);
    stringDiff("hearing_impairments", packet.hearing_impairments);
    stringDiff("iep_description", packet.iep_description);
    stringDiff("epipen_explainer", packet.epipen_explainer);
    stringDiff(
      "additional_health_information",
      packet.additional_health_information
    );
    stringDiff(
      "other_adults_approved_for_pickup",
      packet.other_adults_approved_for_pickup
    );
    stringDiff("prohibited_adults", packet.prohibited_adults);
    stringDiff(
      "permission_for_acetaminophen",
      packet.permission_for_acetaminophen
    );
    stringDiff(
      "interested_in_counseling_services",
      packet.interested_in_counseling_services
    );
    // Booleans — "Yes" / "No" select strings map back to bools.
    const draftMedicaid = draft.is_student_on_medicaid === "Yes";
    if (draftMedicaid !== packet.is_student_on_medicaid) {
      patch.is_student_on_medicaid = draftMedicaid;
    }
    const draftEpipen = draft.carry_epi_pen === "Yes";
    if (draftEpipen !== packet.carry_epi_pen) {
      patch.carry_epi_pen = draftEpipen;
    }
    // Medicaid number — Xano column is numeric. Empty input maps
    // to 0 (matches the parent-side flow), invalid input is
    // ignored (we don't trample with NaN).
    const draftMedNum = draft.medicaid_number.trim();
    const nextMedNum = draftMedNum === "" ? 0 : Number(draftMedNum);
    if (
      Number.isFinite(nextMedNum) &&
      nextMedNum !== (packet.medicaid_number ?? 0)
    ) {
      patch.medicaid_number = nextMedNum;
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/student-registration/${packet.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${res.status})`);
      }
      toast.success("Packet saved.");
      setEditing(false);
      onChanged();
    } catch (err) {
      console.error("[PacketCard.runSave]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
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
              inline on the same horizontal axis as the title plus
              the Edit / Save / Cancel cluster. `items-center gap-2`
              keeps every element vertically centered; the caption
              gets a `whitespace-nowrap` so it doesn't fold to a
              second line on narrow widths. */}
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
            <CardEditToggle
              editing={editing}
              saving={saving}
              onEdit={enterEdit}
              onCancel={cancelEdit}
              onSave={() => void runSave()}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent
        className={cn(
          "space-y-6 py-5 bg-white transition-colors",
          packet.registrationConfirmed && !editing && "bg-muted/30"
        )}
      >
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Sizing
          </p>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            {editing && draft ? (
              <>
                <EditSelectField
                  label="Shirt size"
                  value={draft.shirt_size}
                  onChange={(v) =>
                    setDraft((d) => (d ? { ...d, shirt_size: v } : d))
                  }
                  options={PACKET_SHIRT_SIZES}
                  disabled={saving}
                />
                <EditField
                  label="Pant size"
                  value={draft.pant_size}
                  onChange={(v) =>
                    setDraft((d) => (d ? { ...d, pant_size: v } : d))
                  }
                  disabled={saving}
                />
                <EditSelectField
                  label="Swim level"
                  value={draft.swim_level}
                  onChange={(v) =>
                    setDraft((d) => (d ? { ...d, swim_level: v } : d))
                  }
                  options={PACKET_SWIM_LEVELS}
                  disabled={saving}
                />
              </>
            ) : (
              <>
                <ReadField label="Shirt size" value={packet.shirt_size} />
                <ReadField label="Pant size" value={packet.pant_size} />
                <ReadField label="Swim level" value={packet.swim_level} />
              </>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Medical
          </p>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            {editing && draft ? (
              <>
                <EditSelectField
                  label="On Medicaid"
                  value={draft.is_student_on_medicaid}
                  onChange={(v) =>
                    setDraft((d) =>
                      d ? { ...d, is_student_on_medicaid: v as "Yes" | "No" } : d
                    )
                  }
                  options={PACKET_YES_NO}
                  disabled={saving}
                />
                <EditField
                  label="Medicaid provider"
                  value={draft.medicaid_provider}
                  onChange={(v) =>
                    setDraft((d) =>
                      d ? { ...d, medicaid_provider: v } : d
                    )
                  }
                  disabled={saving}
                />
                <EditField
                  label="Medicaid #"
                  value={draft.medicaid_number}
                  onChange={(v) =>
                    setDraft((d) =>
                      d ? { ...d, medicaid_number: v } : d
                    )
                  }
                  disabled={saving}
                />
                <EditSelectField
                  label="Carries EpiPen"
                  value={draft.carry_epi_pen}
                  onChange={(v) =>
                    setDraft((d) =>
                      d ? { ...d, carry_epi_pen: v as "Yes" | "No" } : d
                    )
                  }
                  options={PACKET_YES_NO}
                  disabled={saving}
                />
                <EditTextarea
                  label="Allergies"
                  value={draft.allergies}
                  onChange={(v) =>
                    setDraft((d) => (d ? { ...d, allergies: v } : d))
                  }
                  disabled={saving}
                />
                <EditTextarea
                  label="Dietary restrictions"
                  value={draft.dietary_restrictions}
                  onChange={(v) =>
                    setDraft((d) =>
                      d ? { ...d, dietary_restrictions: v } : d
                    )
                  }
                  disabled={saving}
                />
                <EditTextarea
                  label="Prescription medications"
                  value={draft.prescription_medications}
                  onChange={(v) =>
                    setDraft((d) =>
                      d ? { ...d, prescription_medications: v } : d
                    )
                  }
                  disabled={saving}
                />
                <EditTextarea
                  label="Health conditions"
                  value={draft.health_conditions}
                  onChange={(v) =>
                    setDraft((d) =>
                      d ? { ...d, health_conditions: v } : d
                    )
                  }
                  disabled={saving}
                />
                <EditTextarea
                  label="Vision impairments"
                  value={draft.vision_impairments}
                  onChange={(v) =>
                    setDraft((d) =>
                      d ? { ...d, vision_impairments: v } : d
                    )
                  }
                  disabled={saving}
                />
                <EditTextarea
                  label="Hearing impairments"
                  value={draft.hearing_impairments}
                  onChange={(v) =>
                    setDraft((d) =>
                      d ? { ...d, hearing_impairments: v } : d
                    )
                  }
                  disabled={saving}
                />
                <EditTextarea
                  label="IEP description"
                  value={draft.iep_description}
                  onChange={(v) =>
                    setDraft((d) =>
                      d ? { ...d, iep_description: v } : d
                    )
                  }
                  disabled={saving}
                />
                <EditTextarea
                  label="EpiPen details"
                  value={draft.epipen_explainer}
                  onChange={(v) =>
                    setDraft((d) =>
                      d ? { ...d, epipen_explainer: v } : d
                    )
                  }
                  disabled={saving}
                />
                <EditTextarea
                  label="Additional health information"
                  value={draft.additional_health_information}
                  onChange={(v) =>
                    setDraft((d) =>
                      d ? { ...d, additional_health_information: v } : d
                    )
                  }
                  disabled={saving}
                />
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
          {/* Below-grid narrative fields are only shown in read mode
              if the parent actually filled them in — empty fields
              would just clutter the card. Edit mode renders them
              all above so admin can fill them in if missing. */}
          {!editing && packet.iep_description ? (
            <ReadField
              label="IEP description"
              value={packet.iep_description}
            />
          ) : null}
          {!editing && packet.epipen_explainer ? (
            <ReadField
              label="EpiPen details"
              value={packet.epipen_explainer}
            />
          ) : null}
          {!editing && packet.additional_health_information ? (
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
            {editing && draft ? (
              <>
                <EditTextarea
                  label="Other adults approved for pickup"
                  value={draft.other_adults_approved_for_pickup}
                  onChange={(v) =>
                    setDraft((d) =>
                      d
                        ? { ...d, other_adults_approved_for_pickup: v }
                        : d
                    )
                  }
                  disabled={saving}
                />
                <EditTextarea
                  label="Prohibited adults"
                  value={draft.prohibited_adults}
                  onChange={(v) =>
                    setDraft((d) =>
                      d ? { ...d, prohibited_adults: v } : d
                    )
                  }
                  disabled={saving}
                />
                <EditTextarea
                  label="Acetaminophen permission"
                  value={draft.permission_for_acetaminophen}
                  onChange={(v) =>
                    setDraft((d) =>
                      d ? { ...d, permission_for_acetaminophen: v } : d
                    )
                  }
                  disabled={saving}
                />
                <EditTextarea
                  label="Counseling services interest"
                  value={draft.interested_in_counseling_services}
                  onChange={(v) =>
                    setDraft((d) =>
                      d
                        ? { ...d, interested_in_counseling_services: v }
                        : d
                    )
                  }
                  disabled={saving}
                />
              </>
            ) : (
              <>
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
              </>
            )}
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

        {/* Other (optional) documents — IEP, SSN card, passport,
            state ID. Separate from the Documents to Review table
            because they don't carry an admin-confirm triplet. Each
            category ships a per-category upload affordance so admin
            can attach files on the family's behalf — useful for
            paper records being digitized post-acceptance. The signed
            liability waiver has its own card above, so it no longer
            appears in this list. */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Other Documents
          </p>
          <ul className="text-sm space-y-1.5">
            <OptionalDocRow
              label="IEP"
              files={student.iep}
              studentId={student.id}
              fieldKey="iep"
              onChanged={onChanged}
            />
            <OptionalDocRow
              label="SSN card"
              files={student.ssn_card}
              studentId={student.id}
              fieldKey="ssn_card"
              onChanged={onChanged}
            />
            <OptionalDocRow
              label="Passport"
              files={student.passport}
              studentId={student.id}
              fieldKey="passport"
              onChanged={onChanged}
            />
            <OptionalDocRow
              label="State ID"
              files={student.student_state_id}
              studentId={student.id}
              fieldKey="student_state_id"
              onChanged={onChanged}
            />
            <OptionalDocRow
              label="Discipline Records"
              files={student.discipline}
              studentId={student.id}
              fieldKey="discipline"
              onChanged={onChanged}
            />
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
 * Tidy a stored PandaDoc status string for display ("sent" → "Sent",
 * "document.viewed" → "Viewed"). Mirrors the `formatPdStatus` helper
 * on the enrolled-list + family-registration pages so the three
 * surfaces label waiver progress identically.
 */
function formatWaiverStatus(status: string): string {
  const cleaned = status.replace(/^document\./, "").replace(/_/g, " ");
  if (!cleaned) return status;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Liability Waiver card — surfaces the per-year signed waiver PDF
 * with a prominent Download affordance. The waiver is a per-student,
 * per-year PandaDoc document whose id + status live on the packet
 * row, so this card is implicitly scoped to the page's `yearId`
 * (same scope as PacketCard). Three states:
 *   - Signed (`pandadoc id` + status "completed") → Download + View.
 *   - In progress (status "sent" / "viewed") → status + sent date,
 *     no download yet.
 *   - Not started / no packet → muted explainer.
 *
 * Download goes through the admin PandaDoc proxy
 * (`/api/admin/pandadoc/download`), NOT the raw `liability_waiver_pdf_url`
 * on the packet — that URL points at api.pandadoc.com and needs our
 * API key in the request header, which the admin browser doesn't
 * have. The proxy fetches server-side with the key and streams the
 * PDF back. The anchor's `download` attribute forces a save (rather
 * than the proxy's inline preview) and names the file with the
 * student + year so downloads across students/years don't collide —
 * the attribute wins over `Content-Disposition: inline` for same-
 * origin URLs, which this is.
 */
function LiabilityWaiverCard({
  packet,
  student,
  schoolYear,
}: {
  packet: AdminEnrolledStudentResponse["packet"];
  student: AdminEnrolledStudentResponse["student"];
  schoolYear: AdminEnrolledStudentResponse["school_year"];
}) {
  const yearName = schoolYear?.year_name ?? "";
  const yearSuffix = yearName ? ` · ${yearName}` : "";

  const pandadocId = packet?.liability_waiver_pandadoc_id ?? "";
  const status = packet?.liability_waiver_status ?? "";
  const sentAt = packet?.liability_waiver_sent_at ?? null;
  // "completed" + a pandadoc id is the only state with a signed PDF
  // to download. Same gate the list page + the old Other Documents
  // row used, so every surface agrees on what "Signed" means.
  const isSigned = !!pandadocId && status === "completed";

  const downloadUrl = isSigned
    ? `/api/admin/pandadoc/download?documentId=${pandadocId}`
    : null;
  // Filename: liability-waiver-<first>-<last>-<year>.pdf. Slug each
  // piece so spaces / the year's en-dash don't leak into the saved
  // name; drop empty pieces so a missing name doesn't leave a "--".
  const slug = (s: string) =>
    s
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "");
  const downloadName =
    [
      "liability-waiver",
      slug(student.first_name),
      slug(student.last_name),
      slug(yearName),
    ]
      .filter(Boolean)
      .join("-") + ".pdf";

  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">
            Liability Waiver{yearSuffix}
          </CardTitle>
          {isSigned ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800">
              <CheckCircle2 className="size-2.5" />
              Signed
            </span>
          ) : status ? (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-800">
              {formatWaiverStatus(status)}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Not started
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="py-5 bg-white">
        {isSigned && downloadUrl ? (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                <FileText className="size-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  Signed liability waiver{yearName ? ` · ${yearName}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Signed and on file for this school year.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button asChild variant="outline" size="sm" className="bg-white">
                <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
                  View
                  <ExternalLink className="size-3.5 ml-1.5" />
                </a>
              </Button>
              <Button
                asChild
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <a href={downloadUrl} download={downloadName}>
                  <Download className="size-3.5 mr-1.5" />
                  Download PDF
                </a>
              </Button>
            </div>
          </div>
        ) : status ? (
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/40">
              <FileText className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                Waiver {formatWaiverStatus(status).toLowerCase()} — not signed
                yet
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {sentAt
                  ? `Sent ${formatNoteTimestamp(new Date(sentAt).getTime())}. `
                  : ""}
                The signed PDF will be available to download here once the
                family completes it.
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {packet
              ? "The family hasn’t signed the liability waiver for this school year yet."
              : "No registration packet on file for this student yet, so there’s no liability waiver to download."}
          </p>
        )}
      </CardContent>
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
  student,
  app,
  onChanged,
}: {
  student: AdminEnrolledStudentResponse["student"];
  app: AdminEnrolledStudentResponse["app"];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  // Canonical NWEA values — math/reading scores + dates live on the
  // student row (so they follow the student across re-enrollment);
  // scheduled/complete bools live on the per-year application row.
  // Edit-mode save fans out to both routes accordingly.
  const studentMath = student.initial_screening_nwea_math;
  const studentReading = student.initial_screening_nwea_reading;
  const studentMathDate = student.initial_screening_nwea_math_date ?? "";
  const studentReadingDate =
    student.initial_screening_nwea_reading_date ?? "";
  const [draft, setDraft] = useState({
    scheduled: app?.nwea_testing_scheduled === true,
    complete: app?.nwea_testing_complete === true,
    math:
      studentMath != null && studentMath !== 0 ? String(studentMath) : "",
    reading:
      studentReading != null && studentReading !== 0
        ? String(studentReading)
        : "",
    mathDate: studentMathDate,
    readingDate: studentReadingDate,
  });

  if (!app) return null;

  function enterEdit() {
    setDraft({
      scheduled: app?.nwea_testing_scheduled === true,
      complete: app?.nwea_testing_complete === true,
      math:
        studentMath != null && studentMath !== 0 ? String(studentMath) : "",
      reading:
        studentReading != null && studentReading !== 0
          ? String(studentReading)
          : "",
      mathDate: studentMathDate,
      readingDate: studentReadingDate,
    });
    setEditing(true);
  }

  async function runSave() {
    if (!app) return;
    // Split the diff into two routes: bools land on the per-year app
    // row; scores + dates land on the student row (canonical, follows
    // re-enrollment). Skip the field entirely when unchanged so we
    // don't trample concurrent edits to sibling columns.
    const appPatch: Record<string, boolean> = {};
    if (draft.scheduled !== (app.nwea_testing_scheduled === true)) {
      appPatch.nwea_testing_scheduled = draft.scheduled;
    }
    if (draft.complete !== (app.nwea_testing_complete === true)) {
      appPatch.nwea_testing_complete = draft.complete;
    }
    const studentPatch: Record<string, number | string | null> = {};
    // Score parsing — empty string clears to null (matches the apply-
    // flow TestingBlock's blur-save semantics).
    const parseScore = (raw: string): number | null => {
      const trimmed = raw.trim();
      if (trimmed === "") return null;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    };
    const nextMath = parseScore(draft.math);
    const prevMath =
      studentMath == null || studentMath === 0 ? null : studentMath;
    if (nextMath !== prevMath) {
      studentPatch.initial_screening_nwea_math = nextMath;
    }
    const nextReading = parseScore(draft.reading);
    const prevReading =
      studentReading == null || studentReading === 0
        ? null
        : studentReading;
    if (nextReading !== prevReading) {
      studentPatch.initial_screening_nwea_reading = nextReading;
    }
    const nextMathDate = draft.mathDate.trim() || null;
    if (nextMathDate !== (studentMathDate || null)) {
      studentPatch.initial_screening_nwea_math_date = nextMathDate;
    }
    const nextReadingDate = draft.readingDate.trim() || null;
    if (nextReadingDate !== (studentReadingDate || null)) {
      studentPatch.initial_screening_nwea_reading_date = nextReadingDate;
    }
    if (
      Object.keys(appPatch).length === 0 &&
      Object.keys(studentPatch).length === 0
    ) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const promises: Array<Promise<Response>> = [];
      if (Object.keys(appPatch).length > 0) {
        promises.push(
          fetch(`/api/admin/applications/${app.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(appPatch),
          })
        );
      }
      if (Object.keys(studentPatch).length > 0) {
        promises.push(
          fetch(`/api/admin/students/${student.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(studentPatch),
          })
        );
      }
      const results = await Promise.all(promises);
      const failed = results.find((r) => !r.ok);
      if (failed) {
        const errBody = await failed.json().catch(() => null);
        throw new Error(errBody?.error ?? `Save failed (${failed.status})`);
      }
      toast.success("Testing details saved.");
      setEditing(false);
      onChanged();
    } catch (err) {
      console.error("[TestingCard.runSave]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Initial Testing (NWEA)</CardTitle>
          <CardEditToggle
            editing={editing}
            saving={saving}
            onEdit={enterEdit}
            onCancel={() => setEditing(false)}
            onSave={() => void runSave()}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-6 py-5 bg-white">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          {editing ? (
            <>
              <EditSelectField
                label="Scheduled"
                value={draft.scheduled ? "Yes" : "No"}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, scheduled: v === "Yes" }))
                }
                options={["Yes", "No"]}
                disabled={saving}
              />
              <EditSelectField
                label="Complete"
                value={draft.complete ? "Yes" : "No"}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, complete: v === "Yes" }))
                }
                options={["Yes", "No"]}
                disabled={saving}
              />
              <EditField
                label="Math RIT score"
                value={draft.math}
                onChange={(v) => setDraft((d) => ({ ...d, math: v }))}
                disabled={saving}
              />
              <EditField
                label="Math test date"
                type="date"
                value={draft.mathDate}
                onChange={(v) => setDraft((d) => ({ ...d, mathDate: v }))}
                disabled={saving}
              />
              <EditField
                label="Reading RIT score"
                value={draft.reading}
                onChange={(v) => setDraft((d) => ({ ...d, reading: v }))}
                disabled={saving}
              />
              <EditField
                label="Reading test date"
                type="date"
                value={draft.readingDate}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, readingDate: v }))
                }
                disabled={saving}
              />
            </>
          ) : (
            <>
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
                  // should render as the em-dash placeholder rather
                  // than a literal "0". Mirrors the same coercion in
                  // the family-detail TestingBlock.
                  studentMath != null && studentMath !== 0
                    ? String(studentMath)
                    : ""
                }
              />
              <ReadField
                label="Math test date"
                value={studentMathDate}
              />
              <ReadField
                label="Reading RIT score"
                value={
                  studentReading != null && studentReading !== 0
                    ? String(studentReading)
                    : ""
                }
              />
              <ReadField
                label="Reading test date"
                value={studentReadingDate}
              />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Read-only labeled field. Renders as a `readOnly` input rather
 * than `disabled` so admin can select + copy the value out of the
 * page — useful for emails, phone numbers, and student IDs that
 * admin frequently needs to paste elsewhere. Disabled HTML inputs
 * reject every selection event; readOnly keeps the field
 * non-editable while preserving native selection.
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
        readOnly
        className="border-input bg-white text-foreground"
      />
    </Field>
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
    /** Column on `registration_students` that holds the file
     *  metadata array. Used by `AdminDocumentUpload` to know which
     *  field to PATCH after a successful upload. */
    fieldKey:
      | "birth_certificate"
      | "school_health_form"
      | "transcripts"
      | "immunization_forms";
  };

  const docs: DocSpec[] = [
    {
      label: "Birth Certificate",
      files: student.birth_certificate,
      confirm: student.document_confirms.birth_certificate,
      confirmKey: "birth_certificate_admin_confirm",
      fieldKey: "birth_certificate",
    },
    {
      label: "School Health Form",
      files: student.school_health_form,
      confirm: student.document_confirms.school_health_form,
      confirmKey: "school_health_form_admin_confirm",
      fieldKey: "school_health_form",
    },
    {
      label: "Transcripts",
      files: student.transcripts,
      confirm: student.document_confirms.transcripts,
      confirmKey: "transcripts_admin_confirm",
      fieldKey: "transcripts",
    },
    {
      label: "Immunization Forms",
      files: student.immunization_forms,
      confirm: student.document_confirms.immunization_forms,
      confirmKey: "immunization_admin_confirm",
      fieldKey: "immunization_forms",
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
            <TableHead className="w-[28%] text-[10px] text-muted-foreground">
              Document
            </TableHead>
            <TableHead className="text-[10px] text-muted-foreground">
              File(s)
            </TableHead>
            <TableHead className="w-[15%] text-[10px] text-muted-foreground">
              Confirmed By
            </TableHead>
            <TableHead className="w-[80px] text-[10px] text-muted-foreground">
              Time
            </TableHead>
            <TableHead className="w-[170px] text-right text-[10px] text-muted-foreground">
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
                  <div className="space-y-1.5">
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
                                  <span className="truncate min-w-0">
                                    {name}
                                  </span>
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
                              <AdminFileRemoveButton
                                studentId={student.id}
                                fieldKey={doc.fieldKey}
                                files={doc.files}
                                index={idx}
                                fileName={
                                  typeof (f as { name?: unknown }).name ===
                                  "string"
                                    ? (f as { name: string }).name
                                    : null
                                }
                                onChanged={onChanged}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-[11px] italic text-muted-foreground">
                        No file uploaded.
                      </p>
                    )}
                    {/* Compact upload trigger — sits below the file
                        list so admin can attach additional pages
                        (immunization records, multi-page transcripts)
                        on the family's behalf. Disables the Confirm
                        button gating still kicks in via `hasFiles`
                        below, so admin can upload then confirm in
                        one pass. */}
                    <AdminDocumentUpload
                      studentId={student.id}
                      fieldKey={doc.fieldKey}
                      files={doc.files}
                      label={doc.label}
                      onChanged={onChanged}
                      compact
                    />
                  </div>
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

/* ─────────────────────── Optional document row ─────────────────────── */

/**
 * Composite list row used by the Optional Documents section of
 * `PacketCard`. Existing files render through the prior
 * `FileGroup` list-item shape so the layout matches the Liability
 * waiver line above; an `AdminDocumentUpload` trigger hangs off
 * the right-hand side so admin can attach additional pages on the
 * family's behalf without leaving the page.
 *
 * Two visual states:
 *   - Empty array → "Not uploaded" caption (matching `FileGroup`'s
 *     empty look) + a small Upload button on the right.
 *   - One or more files → `FileGroup` renders the file list as
 *     usual; the Add-file button sits beneath the row so admin's
 *     eye lands on existing files first, action second.
 */
function OptionalDocRow({
  label,
  files,
  studentId,
  fieldKey,
  onChanged,
}: {
  label: string;
  files: Record<string, unknown>[] | null | undefined;
  studentId: number;
  fieldKey:
    | "iep"
    | "ssn_card"
    | "passport"
    | "student_state_id"
    | "discipline";
  onChanged: () => void;
}) {
  const entries = Array.isArray(files) ? files : [];
  if (entries.length === 0) {
    // Empty-state row — single inline layout so the label, the
    // "Not uploaded" caption, and the Upload trigger all share
    // the line. Matches `FileGroup`'s empty look on the left and
    // gains the trigger on the right.
    return (
      <li className="flex items-center justify-between gap-3 border-t first:border-t-0 py-1.5">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs italic text-muted-foreground/70">
            Not uploaded
          </span>
          <AdminDocumentUpload
            studentId={studentId}
            fieldKey={fieldKey}
            files={entries}
            label={label}
            onChanged={onChanged}
            compact
          />
        </div>
      </li>
    );
  }
  return (
    <li className="border-t first:border-t-0 py-1.5 space-y-1.5">
      {/* Existing files — reuse the same shape `FileGroup` uses
          so the optional documents block stays visually consistent
          even though we render the rows inline here. */}
      <ul className="space-y-1">
        {entries.length === 1 ? (
          (() => {
            const f = entries[0];
            const url = resolveFileUrl(f);
            const name =
              typeof (f as { name?: unknown }).name === "string"
                ? (f as { name: string }).name
                : "";
            return (
              <li className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground shrink-0">
                  {label}
                </span>
                <div className="flex items-center gap-1 min-w-0">
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
                  <AdminFileRemoveButton
                    studentId={studentId}
                    fieldKey={fieldKey}
                    files={entries}
                    index={0}
                    fileName={name || null}
                    onChanged={onChanged}
                  />
                </div>
              </li>
            );
          })()
        ) : (
          <>
            <li className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">{label}</span>
              <span className="text-xs text-muted-foreground/70">
                {entries.length} files
              </span>
            </li>
            <li>
              <ul className="mt-1.5 space-y-1 pl-3">
                {entries.map((f, idx) => {
                  const url = resolveFileUrl(f);
                  const rawName =
                    typeof (f as { name?: unknown }).name === "string"
                      ? (f as { name: string }).name
                      : null;
                  const name = rawName ?? `File ${idx + 1}`;
                  const path =
                    typeof (f as { path?: unknown }).path === "string"
                      ? (f as { path: string }).path
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
                          <span className="truncate max-w-[18rem]">
                            {name}
                          </span>
                          <ExternalLink className="size-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-xs italic text-muted-foreground/70">
                          {name} · unavailable
                        </span>
                      )}
                      <AdminFileRemoveButton
                        studentId={studentId}
                        fieldKey={fieldKey}
                        files={entries}
                        index={idx}
                        fileName={rawName}
                        onChanged={onChanged}
                      />
                    </li>
                  );
                })}
              </ul>
            </li>
          </>
        )}
      </ul>
      {/* Add-file trigger — sits below the file list so the
          existing files (the data) is the visual primary and the
          action is a secondary affordance. */}
      <div className="flex justify-end">
        <AdminDocumentUpload
          studentId={studentId}
          fieldKey={fieldKey}
          files={entries}
          label={label}
          onChanged={onChanged}
          compact
        />
      </div>
    </li>
  );
}

/* ─────────────────────── Admin file remove ─────────────────────── */

/**
 * Icon-only X button that drops a single file from one of the
 * student-row file arrays. Sits next to each rendered file in the
 * required-docs table and the Optional Documents block; click
 * opens an AlertDialog ("Remove uploaded file?") and confirming
 * PATCHes `/api/admin/students/[id]` with the array minus the
 * removed index.
 *
 * Required-doc note: if admin removes the last file from a doc
 * whose `*_admin_confirm` flag is true, the confirmation row will
 * read "Confirmed" with nothing underneath until admin clicks the
 * Undo affordance. We don't auto-clear the confirm here because
 * removal and confirmation are user-driven flips on the same row
 * and bundling them would hide the second write from the admin —
 * the Undo icon button in the same row is the prescribed
 * single-click reversal.
 */
function AdminFileRemoveButton({
  studentId,
  fieldKey,
  files,
  index,
  fileName,
  onChanged,
}: {
  studentId: number;
  fieldKey:
    | "birth_certificate"
    | "school_health_form"
    | "transcripts"
    | "immunization_forms"
    | "iep"
    | "ssn_card"
    | "passport"
    | "student_state_id"
    | "discipline";
  files: Record<string, unknown>[];
  index: number;
  /** File name shown in the confirm dialog. Falls back to a
   *  generic phrase when the metadata didn't include one. */
  fileName: string | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function runRemove() {
    setSaving(true);
    try {
      const next = files.filter((_, i) => i !== index);
      const res = await fetch(`/api/admin/students/${studentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [fieldKey]: next }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? `Remove failed (${res.status})`);
      }
      toast.success("File removed.");
      setOpen(false);
      onChanged();
    } catch (err) {
      console.error("[AdminFileRemoveButton.runRemove]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't remove file.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 text-muted-foreground hover:text-red-600 hover:bg-red-50"
        onClick={() => setOpen(true)}
        disabled={saving}
        title="Remove this file"
        aria-label="Remove this file"
      >
        {saving ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <X className="size-3.5" />
        )}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !saving) setOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove uploaded file?</AlertDialogTitle>
            <AlertDialogDescription>
              {fileName
                ? `This removes "${fileName}" from this student's record. `
                : "This removes the file from this student's record. "}
              The file metadata is dropped from the array — you can
              re-upload from the same row if it was a mistake.
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

/* ─────────────────────── Admin document upload ─────────────────────── */

/**
 * Admin-side document upload — mirrors the parent flow's
 * `DocumentUpload` but compact enough to drop into the
 * Documents-to-Review table row + the Optional Documents list
 * without overwhelming either layout.
 *
 *   - Selecting files → POSTs each one to `/api/upload`
 *     (which proxies Xano's `upload/attachment`), then PATCHes
 *     the student row with the appended metadata array. PATCHes
 *     in series after each upload so a mid-batch network blip
 *     leaves the earlier successes persisted instead of dropping
 *     the whole queue.
 *
 * `fieldKey` is the Xano column on `registration_students` — the
 * `/api/admin/students/[id]` allowlist gates which columns are
 * writable here, so a typo defaults to a 400 rather than silently
 * writing the wrong column.
 *
 * `compact` switches to a small inline trigger (icon + label)
 * suitable for the cramped table cells in
 * `EnrolledDocsToReviewTable`. The default layout uses the full
 * dropzone for the Optional Documents block where vertical space
 * isn't constrained.
 *
 * Removal lives in `AdminFileRemoveButton` — admin clicks the X
 * next to each rendered file rather than going through the
 * dropzone.
 */
function AdminDocumentUpload({
  studentId,
  fieldKey,
  files,
  label,
  compact,
  onChanged,
}: {
  studentId: number;
  fieldKey:
    | "birth_certificate"
    | "school_health_form"
    | "transcripts"
    | "immunization_forms"
    | "iep"
    | "ssn_card"
    | "passport"
    | "student_state_id"
    | "discipline";
  files: Record<string, unknown>[];
  /** Used in the dropzone copy ("Upload birth certificate", etc.) */
  label: string;
  /** Compact mode renders a small inline button trigger — used
   *  inside the Documents-to-Review table cells where vertical
   *  space is tight. */
  compact?: boolean;
  /** Parent's data-refresh callback. May return a Promise (the
   *  SWR mutate). When it does, we await the refresh before
   *  clearing local pending state — bridges the gap between the
   *  PATCH landing and the parent's `files` prop catching up, so
   *  the file row doesn't flicker through an empty "Not uploaded"
   *  state mid-upload. */
  onChanged: () => void | Promise<unknown>;
}) {
  const [pending, setPending] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patchFiles(next: Record<string, unknown>[]) {
    const res = await fetch(`/api/admin/students/${studentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [fieldKey]: next }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      throw new Error(errBody?.error ?? `Save failed (${res.status})`);
    }
  }

  async function handleFilesChange(newFiles: File[]) {
    setPending(newFiles);
    setError(null);
    if (newFiles.length === 0) return;
    setUploading(true);
    try {
      // Upload each file in series so a mid-batch failure leaves
      // the earlier successes persisted. The PATCH after each
      // upload keeps the metadata array on Xano in sync — admin
      // can refresh and see exactly what's been recorded so far.
      let acc = files.slice();
      for (const f of newFiles) {
        const formData = new FormData();
        formData.append("file", f);
        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Upload failed (${res.status})`);
        }
        const metadata = (await res.json()) as Record<string, unknown>;
        acc = [...acc, metadata];
        await patchFiles(acc);
      }
      toast.success(
        newFiles.length === 1
          ? `${label} uploaded.`
          : `${newFiles.length} files uploaded.`
      );
      // Await the parent's data-refresh (SWR mutate) BEFORE clearing
      // `pending` so the FileUpload list keeps showing the just-
      // uploaded file until the parent's `files` prop catches up.
      // Without this `setPending([])` ran first, the parent's prop
      // was still stale (empty), and the row briefly rendered the
      // "Not uploaded" empty state until SWR's revalidation landed.
      // `Promise.resolve(...)` covers callers that return either
      // `void` or a Promise.
      await Promise.resolve(onChanged());
      setPending([]);
    } catch (err) {
      console.error("[AdminDocumentUpload.handleFilesChange]", err);
      const message =
        err instanceof Error ? err.message : "Upload failed.";
      setError(message);
      toast.error(message);
    } finally {
      setUploading(false);
    }
  }

  if (compact) {
    return (
      <>
        <FileUpload
          maxFiles={5}
          maxSize={10 * 1024 * 1024}
          accept=".pdf,.jpg,.jpeg,.png,.heic,.heif"
          value={pending}
          onValueChange={handleFilesChange}
          disabled={uploading}
        >
          <FileUploadDropzone className="border-0 p-0 cursor-pointer hover:bg-transparent w-fit min-h-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs leading-none bg-white"
              disabled={uploading}
              asChild
            >
              <span>
                {uploading ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <FileUp className="size-3" />
                )}
                <span className="ml-1">
                  {uploading
                    ? "Uploading…"
                    : files.length === 0
                      ? "Upload"
                      : "Add file"}
                </span>
              </span>
            </Button>
          </FileUploadDropzone>
          <FileUploadList>
            {pending.map((f, i) => (
              <FileUploadItem key={i} value={f}>
                <FileUploadItemPreview />
                <FileUploadItemMetadata />
                <FileUploadItemDelete asChild>
                  <Button variant="ghost" size="icon" className="size-7">
                    <X className="size-4" />
                  </Button>
                </FileUploadItemDelete>
              </FileUploadItem>
            ))}
          </FileUploadList>
        </FileUpload>
        {error ? (
          <p className="text-[11px] text-red-600 mt-1">{error}</p>
        ) : null}
      </>
    );
  }

  return (
    <div className="space-y-2">
      <FileUpload
        maxFiles={5}
        maxSize={10 * 1024 * 1024}
        accept=".pdf,.jpg,.jpeg,.png,.heic,.heif"
        value={pending}
        onValueChange={handleFilesChange}
        disabled={uploading}
      >
        <FileUploadDropzone className="flex-row gap-3 px-4 py-3 cursor-pointer">
          {uploading ? (
            <Loader2 className="size-5 text-muted-foreground animate-spin" />
          ) : (
            <FileUp className="size-5 text-muted-foreground" />
          )}
          <div className="flex-1 text-left">
            <p className="text-sm font-medium">
              {uploading
                ? "Uploading…"
                : files.length === 0
                  ? `Upload ${label}`
                  : `Add another ${label.toLowerCase()}`}
            </p>
            <p className="text-xs text-muted-foreground">
              PDF, JPG, PNG, or HEIC (max 10MB each, up to 5)
            </p>
          </div>
        </FileUploadDropzone>
        <FileUploadList>
          {pending.map((f, i) => (
            <FileUploadItem key={i} value={f}>
              <FileUploadItemPreview />
              <FileUploadItemMetadata />
              <FileUploadItemDelete asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <X className="size-4" />
                </Button>
              </FileUploadItemDelete>
            </FileUploadItem>
          ))}
        </FileUploadList>
      </FileUpload>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
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
