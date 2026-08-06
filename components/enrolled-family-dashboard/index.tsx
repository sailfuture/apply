"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { useUser } from "@clerk/nextjs";
import { useFamily, useStudents, useApplications, useSchoolYears, mutateFamily } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { InviteStatusBadge, ResendInviteButton } from "@/components/invite-status";
import { LoadingScreen } from "@/components/loading-screen";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Pencil,
  HandHeart,
  CalendarDays,
  CreditCard,
  ChevronRight,
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  Clock,
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
import { EditContactSheet } from "./edit-contact-sheet";
import { AddParentSheet } from "./add-parent-sheet";
import { AddEmergencyContactSheet } from "./add-emergency-contact-sheet";
import { AddResidentialStudentSheet } from "./add-residential-student-sheet";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

type Parent = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  relationship: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  zipcode: string;
  // Optional because `EmergencyContact` extends this type and EC rows
  // (from `/api/emergency-contacts`) carry no invite state.
  invite_status?: string;
};

type EmergencyContact = Parent & {
  // EC shape is parent-shape + these; safe to reuse the Parent type since the
  // sheet writes a superset of fields.
};

type Student = {
  id: number;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  isAccepted: boolean;
  /** Either a Xano file metadata object (with `url` / `path`) or a string URL. */
  photo?: string | { url?: string; path?: string } | null;
};

type Application = {
  id: number;
  registration_students_id: number;
  registration_school_years_id: number;
  current_grade: string;
  isAccepted?: boolean;
  isSubmitted?: boolean;
  /** True for students added mid-year via the residential family's
   *  "Create New Registration" flow. Tracked separately from the
   *  confirmed roster until admin accepts them. */
  is_residential_addition?: boolean;
};

/** One admin-logged volunteer-hour entry. Mirrors `XanoVolunteerHours`
 *  on lib/xano.ts — kept local so the component doesn't pull a
 *  server-only module into the client bundle. */
type VolunteerHoursEntry = {
  id: number;
  registration_families_id: number;
  registration_school_years_id: number;
  entry_date: string;
  hours: number;
  activity_description: string;
  activity_category: string;
  is_approved: boolean;
};

/** Annual goal — 40 hours per family per academic year. Surfaced as a
 *  constant so the summary card and detail page stay in sync if the
 *  policy changes. */
const VOLUNTEER_HOURS_GOAL = 40;

/** Format a fractional hour value for display — trims trailing zeros so
 *  whole numbers render as "12" instead of "12.00", and partial hours
 *  show as "12.5". Mirrors the same helper on the detail page. */
function formatHours(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  return res.json();
};

/** Year picker option. `mode` drives which cards render for the year:
 *  `"enrolled"` → standard dashboard (tuition, volunteer hours, family
 *  info); `"applying"` → re-application progress card for the year the
 *  family is in the process of re-enrolling for. */
type PickerYear = {
  id: number;
  year_name: string;
  mode: "enrolled" | "applying";
};

interface Props {
  yearId: number;
  yearName: string;
  submittedDate: number | null;
  /** Pre-resolved list of years for the picker (enrolled + re-applying).
   *  Passed in from the page so we don't refetch per-year endpoints
   *  twice — the page already did that work to figure out which year
   *  to render. Sorted most-recent-first. The optional shape supports
   *  legacy callers that don't pass `mode`; those are treated as
   *  enrolled. */
  availableYears?: (
    | PickerYear
    | { id: number; year_name: string }
  )[];
}

export function EnrolledFamilyDashboard({
  yearId,
  yearName,
  submittedDate,
  availableYears: availableYearsProp,
}: Props) {
  const router = useRouter();
  const { user } = useUser();
  const firstName = user?.firstName ?? "";

  const { data: familyData } = useFamily();
  const { data: studentsData } = useStudents();
  const { data: applicationsData } = useApplications();
  const { data: yearsData } = useSchoolYears();
  const { data: emergencyContacts } = useSWR<EmergencyContact[]>(
    "/api/emergency-contacts",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );
  // Volunteer hours — admin-logged entries across every year the family
  // has on file. Filtered to the dashboard's current `yearId` below so
  // the summary card always reflects the year the parent is viewing.
  const { data: volunteerHoursData } = useSWR<VolunteerHoursEntry[]>(
    "/api/volunteer-hours",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );
  const volunteerHoursSummary = useMemo(() => {
    if (!volunteerHoursData) return { approved: 0, pending: 0 };
    let approved = 0;
    let pending = 0;
    for (const entry of volunteerHoursData) {
      if (entry.registration_school_years_id !== yearId) continue;
      const hours = Number(entry.hours) || 0;
      if (entry.is_approved) approved += hours;
      else pending += hours;
    }
    return { approved, pending };
  }, [volunteerHoursData, yearId]);

  // Re-application affordance: surface a banner card on the dashboard
  // pointing at the next academic year's apply flow once admin has
  // explicitly *opened* re-applications for that year. Returning
  // families use it to bootstrap (or resume) the new academic year.
  // We intentionally show the banner even when the dashboard's current
  // `yearId` matches `nextYear.id` — the parent might switch year
  // pickers and we don't want the card flickering out of existence
  // based on that.
  //
  // Two gates layered together:
  //   1. The year must be flagged `isNextYear` on Xano (typical
  //      lifecycle: admin promotes a Future year to NextYear once they
  //      know it's the upcoming term).
  //   2. Admin must have stamped `reapplications_opened_at` from the
  //      year detail page. This is the explicit "publish to enrolled
  //      families" gate — opening re-applications is a workflow event,
  //      not a side-effect of being the next year. Treat undefined /
  //      missing as closed (legacy rows pre-date the column).
  //
  // Re-enrollment merged into the unified apply pipeline — returning families
  // share the `/apply/year/:id/*` URL space with new applicants. The progress
  // row's `type` field (`"Re-Enrollment"` for returning families) flips the
  // flow-specific bits (NWEA skipped, prefilled student review). All status
  // checks here read from `/api/family-progress` like any other apply row.
  const nextYear = useMemo(() => {
    if (!yearsData) return null;
    const ys = yearsData as {
      id: number;
      year_name: string;
      isNextYear?: boolean;
      reapplications_opened_at?: number | null;
    }[];
    return (
      ys.find(
        (y) =>
          y.isNextYear === true &&
          y.reapplications_opened_at != null
      ) ?? null
    );
  }, [yearsData]);

  const { data: nextYearReapply } = useSWR<{ id: number; isSubmitted?: boolean } | null>(
    nextYear ? `/api/family-progress?yearId=${nextYear.id}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );

  const [reapplying, setReapplying] = useState(false);
  async function beginReapplication() {
    if (!nextYear || reapplying) return;
    setReapplying(true);
    try {
      const res = await fetch("/api/begin-reapplication", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearId: nextYear.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      const { redirectTo } = await res.json();
      router.push(redirectTo ?? `/apply/year/${nextYear.id}`);
    } catch (err) {
      console.error("Failed to begin re-application:", err);
      toast.error(
        err instanceof Error
          ? err.message
          : "Couldn't start re-application. Please try again."
      );
    } finally {
      setReapplying(false);
    }
  }

  const parents: Parent[] = (familyData?.parents ?? []) as Parent[];
  const primary = parents[0] ?? null;
  const secondary = parents[1] ?? null;
  // Residential / foster families get the mid-year "Create New
  // Registration" affordance. The flag lives on the family record.
  const isResidential =
    (familyData as { is_residential?: boolean } | null | undefined)
      ?.is_residential === true;

  // Per-student packet confirmation for this year. A residential mid-year
  // addition stays "pending" until admin confirms its packet — keyed off
  // the same `registrationConfirmed` signal the enrolled-rollups use, so
  // the dashboard's pending/enrolled split stays consistent with them.
  const { data: packetsData } = useSWR<
    { registration_students_id: number; registrationConfirmed?: boolean }[]
  >(`/api/student-registration?yearId=${yearId}`, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10000,
  });
  const confirmedStudentIds = useMemo(() => {
    const ids = new Set<number>();
    for (const p of packetsData ?? []) {
      if (p.registrationConfirmed === true) {
        ids.add(Number(p.registration_students_id));
      }
    }
    return ids;
  }, [packetsData]);
  // A residential addition isn't fully enrolled until its packet is
  // confirmed; until then it belongs in "Pending Registrations".
  const isPendingResidentialAdd = useCallback(
    (a: Application) =>
      a.is_residential_addition === true &&
      !confirmedStudentIds.has(a.registration_students_id),
    [confirmedStudentIds]
  );

  // Students + grade for this year — the confirmed roster. Excludes
  // residential mid-year additions whose packet admin hasn't confirmed
  // yet (those show in their own section below).
  const enrolledStudents = useMemo(() => {
    if (!studentsData || !applicationsData) return [];
    const apps = (applicationsData as Application[]).filter(
      (a) =>
        a.registration_school_years_id === yearId &&
        !isPendingResidentialAdd(a)
    );
    return apps
      .map((app) => {
        const student = (studentsData as Student[]).find(
          (s) => s.id === app.registration_students_id
        );
        if (!student) return null;
        return { student, app };
      })
      .filter((x): x is { student: Student; app: Application } => x !== null);
  }, [studentsData, applicationsData, yearId, isPendingResidentialAdd]);

  // In-progress mid-year registrations for residential / foster families —
  // created via "Create New Registration" and not yet confirmed by admin.
  // Surfaced in their own "Pending Registrations" section so they don't
  // masquerade as confirmed students in the roster above.
  const pendingResidentialAdds = useMemo(() => {
    if (!studentsData || !applicationsData) return [];
    const apps = (applicationsData as Application[]).filter(
      (a) => a.registration_school_years_id === yearId && isPendingResidentialAdd(a)
    );
    return apps
      .map((app) => {
        const student = (studentsData as Student[]).find(
          (s) => s.id === app.registration_students_id
        );
        if (!student) return null;
        return { student, app };
      })
      .filter((x): x is { student: Student; app: Application } => x !== null);
  }, [studentsData, applicationsData, yearId, isPendingResidentialAdd]);

  // Year picker — shows enrolled + re-applying years for the family.
  // The parent page already resolved this list (it had to, in order to
  // pick which year to render) and passes it in as `availableYearsProp`.
  // We fall back to deriving from `yearsData` when it's not provided so
  // the component stays usable in isolation; standalone-fallback rows
  // default to `mode: "enrolled"` (the original behavior before
  // re-applying years joined the picker).
  const availableYears = useMemo<PickerYear[]>(() => {
    if (availableYearsProp) {
      // Normalize legacy callers that didn't pass `mode`.
      return availableYearsProp.map((y) => ({
        id: y.id,
        year_name: y.year_name,
        mode: "mode" in y ? y.mode : "enrolled",
      }));
    }
    if (!yearsData || !applicationsData) return [];
    const candidateYearIds = new Set(
      (applicationsData as Application[]).map(
        (a) => a.registration_school_years_id
      )
    );
    return (yearsData as { id: number; year_name: string }[])
      .filter((y) => candidateYearIds.has(y.id))
      .map((y) => ({ id: y.id, year_name: y.year_name, mode: "enrolled" as const }))
      .sort((a, b) => b.id - a.id);
  }, [availableYearsProp, yearsData, applicationsData]);

  // Which mode is the currently-displayed year in? Drives the
  // header copy (Enrolled / Re-applying) and which set of cards
  // renders below.
  const currentYearMode: "enrolled" | "applying" = useMemo(() => {
    const found = availableYears.find((y) => y.id === yearId);
    return found?.mode ?? "enrolled";
  }, [availableYears, yearId]);

  // SWR-fetched apply-flow progress for the currently-displayed year.
  // Only meaningful in `currentYearMode === "applying"` — drives the
  // Re-application Progress card's section bools + completion math.
  // Returns null while loading or if no progress row exists.
  const { data: currentYearApplyProgress } = useSWR<{
    family_completed?: boolean;
    students_completed?: boolean;
    financial_aid_completed?: boolean;
    testing_completed?: boolean;
    isSubmitted?: boolean;
    isAccepted?: boolean;
    submitted_at?: number | null;
    last_edited?: number | null;
  } | null>(
    currentYearMode === "applying"
      ? `/api/family-progress?yearId=${yearId}`
      : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  );

  const { mutate: swrMutate } = useSWRConfig();
  const [editing, setEditing] = useState<
    | { kind: "parent"; record: Parent }
    | { kind: "emergency"; record: EmergencyContact }
    | null
  >(null);
  const [addParentOpen, setAddParentOpen] = useState(false);
  const [addEmergencyOpen, setAddEmergencyOpen] = useState(false);
  const [addResidentialOpen, setAddResidentialOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: "parent"; id: number; name: string }
    | { kind: "emergency"; id: number; name: string }
    | null
  >(null);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const url =
        pendingDelete.kind === "parent"
          ? `/api/parents/${pendingDelete.id}`
          : `/api/emergency-contacts/${pendingDelete.id}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Delete failed (${res.status})`);
      }
      // Refresh whichever cache the contact lived in.
      if (pendingDelete.kind === "parent") {
        await mutateFamily();
      } else {
        await swrMutate("/api/emergency-contacts");
      }
      toast.success(`${pendingDelete.name} removed.`);
      setPendingDelete(null);
    } catch (err) {
      console.error("Failed to delete contact:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to remove contact."
      );
    } finally {
      setDeleting(false);
    }
  }

  const loading =
    !familyData ||
    !studentsData ||
    !applicationsData ||
    !yearsData ||
    emergencyContacts === undefined;

  // Continue the shared spinner sequence rather than swapping to a gray
  // skeleton. This component is the final hop of the post-sign-in chain
  // (root → dashboard segment → dashboard page → here), and the page-level
  // LoadingScreen above only waited on apps + years + the per-year status
  // resolver — NOT family / students / emergency-contacts, which this
  // component fetches itself. Rendering a skeleton here made those
  // cold-cache fetches flash a gray placeholder right after three polished
  // spinner screens. `LoadingScreen`'s sessionStorage heartbeat means the
  // cycling text picks up mid-stream, so the whole chain reads as one
  // continuous loading screen instead.
  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4">
        <LoadingScreen />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
      {/* Header — label, heading, year picker. The label + subheading
          copy pivots on `currentYearMode` so the same screen reads
          naturally for an enrolled-year view ("enrolled, confirmed on
          ...") and for a re-applying year ("re-application in
          progress for ..."). */}
      <div className="flex items-start justify-between gap-4 border-b pb-4">
        <div>
          {/* Top eyebrow label — shows the school year the dashboard
              is currently scoped to. Replaces a generic
              "Enrolled" / "Re-applying" label so the family always
              sees *which year* they're looking at at a glance. The
              mode (enrolled vs re-applying) gets communicated in the
              subhead copy below + the year picker on the right. */}
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {yearName}
          </p>
          <h1 className="text-2xl font-semibold mt-1">
            {firstName ? `Welcome back, ${firstName}.` : "Welcome back."}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {currentYearMode === "applying" ? (
              <>Your re-application for the {yearName} school year is in progress.</>
            ) : (
              <>
                Your family is enrolled for the {yearName} school year
                {submittedDate
                  ? `, confirmed on ${new Date(submittedDate).toLocaleDateString(
                      "en-US",
                      { month: "long", day: "numeric", year: "numeric" }
                    )}.`
                  : "."}
              </>
            )}
          </p>
        </div>
        {availableYears.length > 1 ? (
          <Select
            value={String(yearId)}
            onValueChange={(val) => router.push(`/dashboard?yearId=${val}`)}
          >
            <SelectTrigger className="w-40 bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableYears.map((y) => (
                <SelectItem key={y.id} value={String(y.id)}>
                  {y.year_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {/* Re-application card — rendered when there's a `nextYear`
          school year with re-applications opened by admin and the
          parent is viewing an enrolled year. Three states:
            - Not bootstrapped yet (no app rows for nextYear): "Begin"
            - Bootstrapped, in progress (`isSubmitted: false`): "Resume"
            - Submitted (`isSubmitted: true`): awaiting-review status
          We hide this when `currentYearMode === "applying"` because the
          parent is already viewing the re-applying year and the
          dedicated Re-application Progress card below replaces it.
          The bootstrap state is derived from applicationsData rather
          than the progress row because the progress GET endpoint
          resolve-creates a row on first read; presence of an
          application row is a stronger signal that the family
          actually clicked Begin. */}
      {nextYear && currentYearMode === "enrolled" ? (() => {
        const hasNextYearApp = (applicationsData as Application[] | undefined)?.some(
          (a) => a.registration_school_years_id === nextYear.id
        );
        const submitted = nextYearReapply?.isSubmitted === true;

        if (submitted) {
          return (
            <div className="rounded-xl border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 p-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
                  {nextYear.year_name} re-application submitted
                </p>
                <p className="text-xs text-emerald-800/80 dark:text-emerald-200/80 mt-1 max-w-xl">
                  We&rsquo;ve received your re-application — admissions will
                  be in touch as we confirm your spot for the next academic
                  year.
                </p>
              </div>
              <Button
                variant="outline"
                className="bg-white shrink-0"
                onClick={() => router.push(`/apply/year/${nextYear.id}`)}
              >
                Review re-application
              </Button>
            </div>
          );
        }

        if (hasNextYearApp) {
          return (
            <div className="rounded-xl border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 p-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  {nextYear.year_name} re-application in progress
                </p>
                <p className="text-xs text-amber-800/80 dark:text-amber-200/80 mt-1 max-w-xl">
                  Pick up where you left off — finish your remaining sections
                  to lock in your spot for the next academic year.
                </p>
              </div>
              <Button
                className="shrink-0"
                onClick={() => router.push(`/apply/year/${nextYear.id}`)}
              >
                Resume re-application
              </Button>
            </div>
          );
        }

        return (
          <div className="rounded-xl border bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900 p-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                Re-apply for {nextYear.year_name}
              </p>
              <p className="text-xs text-blue-800/80 dark:text-blue-200/80 mt-1 max-w-xl">
                Registration for the next academic year is now open for
                returning families. You&rsquo;ll be asked to confirm your
                family + student information, re-submit the Opportunity
                Scholarship application, and confirm transportation
                preferences.
              </p>
            </div>
            <Button
              onClick={beginReapplication}
              disabled={reapplying}
              className="shrink-0"
            >
              {reapplying ? "Starting…" : "Begin Re-application"}
            </Button>
          </div>
        );
      })() : null}

      {/* Re-application Progress card — replaces the standard enrolled
          cards when the parent is viewing a year they're re-applying
          for. Section-by-section status drives the four bools from the
          unified family_application_progress row; submission +
          acceptance latches change the rendered state. */}
      {currentYearMode === "applying" ? (
        <ReApplicationProgressCard
          yearName={yearName}
          progress={currentYearApplyProgress ?? null}
          onResume={() => router.push(`/apply/year/${yearId}`)}
        />
      ) : null}

      {/* Enrolled-year content — tuition, volunteer hours, family info,
          contacts. Hidden when the picker is on a re-applying year;
          those cards are year-specific or only meaningful post-
          enrollment. Family-level data (parents, students, emergency
          contacts) still lives on the enrolled-year view and can be
          edited there. */}
      {currentYearMode === "enrolled" ? (
      <>
      {/* Tuition & Fees + Volunteer Hours + School Calendar — buttons
          that route to the dedicated detail pages. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button
          type="button"
          onClick={() => router.push(`/dashboard/tuition?yearId=${yearId}`)}
          className="flex items-center justify-between gap-3 rounded-xl border bg-white px-5 py-4 text-left shadow-sm hover:bg-muted/30 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted/50">
              <CreditCard className="size-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">Tuition &amp; Fees</p>
              <p className="text-xs text-muted-foreground truncate">
                Payment schedule, balance, history
              </p>
            </div>
          </div>
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        </button>
        <button
          type="button"
          onClick={() =>
            router.push(`/dashboard/volunteer-hours?yearId=${yearId}`)
          }
          className="flex items-center justify-between gap-3 rounded-xl border bg-white px-5 py-4 text-left shadow-sm hover:bg-muted/30 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted/50">
              <HandHeart className="size-5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium">Volunteer Hours</p>
                {volunteerHoursData ? (
                  <p className="text-xs font-medium text-muted-foreground shrink-0">
                    <span className="text-foreground">
                      {formatHours(volunteerHoursSummary.approved)}
                    </span>
                    {" / "}
                    {VOLUNTEER_HOURS_GOAL}
                  </p>
                ) : null}
              </div>
              {volunteerHoursData ? (
                <>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{
                        width: `${Math.min(
                          100,
                          (volunteerHoursSummary.approved /
                            VOLUNTEER_HOURS_GOAL) *
                            100
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {volunteerHoursSummary.pending > 0
                      ? `${formatHours(volunteerHoursSummary.pending)} pending review`
                      : "40 per year · 8 per term"}
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground truncate">
                  40 per year &middot; 8 per term
                </p>
              )}
            </div>
          </div>
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        </button>
        <button
          type="button"
          onClick={() => router.push(`/dashboard/calendar?yearId=${yearId}`)}
          className="flex items-center justify-between gap-3 rounded-xl border bg-white px-5 py-4 text-left shadow-sm hover:bg-muted/30 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted/50">
              <CalendarDays className="size-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">School Calendar</p>
              <p className="text-xs text-muted-foreground truncate">
                Events, breaks, key dates
              </p>
            </div>
          </div>
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        </button>
      </div>

      {/* Students enrolled this year — same table styling as the year
          overview's step table. Each row is clickable; takes the parent
          to the student's detail page. */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Currently Enrolled Students</h2>
        <div className="rounded-xl bg-background p-1.5 shadow-sm border">
          <div className="overflow-hidden rounded-lg border">
            {enrolledStudents.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                No students enrolled for this year.
              </p>
            ) : (
              <Table className="text-sm">
                <TableBody>
                  {enrolledStudents.map(({ student, app }) => {
                    // Photo can be either a string URL (older rows) or a
                    // Xano file metadata object — accept both shapes.
                    const photoUrl =
                      typeof student.photo === "string"
                        ? student.photo
                        : student.photo &&
                          typeof student.photo === "object"
                          ? (student.photo.url as string | undefined) ??
                            (student.photo.path
                              ? `${process.env.NEXT_PUBLIC_XANO_BASE ?? "https://xsc3-mvx7-r86m.n7e.xano.io"}${student.photo.path}`
                              : undefined)
                          : undefined;
                    return (
                      <TableRow
                        key={student.id}
                        className="cursor-pointer transition-colors hover:bg-muted/30"
                        onClick={() =>
                          router.push(
                            `/dashboard/student/${student.id}?yearId=${yearId}`
                          )
                        }
                      >
                        <TableCell className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar className="size-10 shrink-0">
                              {photoUrl ? (
                                <AvatarImage
                                  src={photoUrl}
                                  alt={`${student.first_name} ${student.last_name}`}
                                />
                              ) : null}
                              <AvatarFallback className="bg-muted text-muted-foreground text-sm font-medium">
                                {student.first_name.charAt(0)}
                                {student.last_name.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="font-medium truncate">
                                {student.first_name} {student.last_name}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {app.current_grade
                                  ? `${app.current_grade} grade`
                                  : "Grade not set"}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right w-10">
                          <ChevronRight className="size-4 text-muted-foreground inline-block" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </div>

      {/* Pending mid-year registrations — residential / foster families
          add students throughout the year. Each addition has its own
          application that admin reviews + accepts independently of the
          family's enrolled status, so they're surfaced here rather than
          mixed into the confirmed roster above. */}
      {pendingResidentialAdds.length > 0 ? (
        <div>
          <h2 className="text-sm font-semibold mb-3">Pending Registrations</h2>
          <div className="rounded-xl bg-background p-1.5 shadow-sm border">
            <div className="overflow-hidden rounded-lg border">
              <Table className="text-sm">
                <TableBody>
                  {pendingResidentialAdds.map(({ student, app }) => {
                    // Three states: incomplete details → "Finish";
                    // submitted-but-not-accepted → "In review"; accepted
                    // but packet not yet confirmed → "Complete packet".
                    const accepted = app.isAccepted === true;
                    const inReview = !accepted && app.isSubmitted === true;
                    return (
                      <TableRow
                        key={student.id}
                        className="cursor-pointer transition-colors hover:bg-muted/30"
                        onClick={() =>
                          router.push(`/dashboard/add-student/${app.id}`)
                        }
                      >
                        <TableCell className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar className="size-10 shrink-0">
                              <AvatarFallback className="bg-muted text-muted-foreground text-sm font-medium">
                                {student.first_name.charAt(0)}
                                {student.last_name.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="font-medium truncate">
                                {student.first_name} {student.last_name}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {accepted
                                  ? "Accepted — complete the registration packet"
                                  : inReview
                                    ? "Submitted — awaiting admissions review"
                                    : "Registration incomplete"}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right whitespace-nowrap">
                          {inReview ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                              <Clock className="size-3.5" />
                              In review
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                              {accepted ? "Complete packet" : "Finish"}
                              <ChevronRight className="size-4" />
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      ) : null}

      {/* Create New Registration — residential / foster families add
          students mid-year. Opens a sheet that creates the student + a
          marked application, then routes into the per-student
          registration flow. */}
      {isResidential ? (
        <Button
          variant="outline"
          className="w-full bg-white"
          onClick={() => setAddResidentialOpen(true)}
        >
          <Plus className="size-4 mr-1.5" />
          Create New Registration
        </Button>
      ) : null}

      {/* Parents / Guardians — primary first, then secondary (if
          present). Family is capped at two parents total; primary is
          never deletable. Each row has a pencil edit button that opens
          the shared edit sheet. */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Parents / Guardians</h2>
          {/* Add Parent — only renders when there's no secondary on file
              yet, since the family already has a primary by definition. */}
          {!secondary && (
            <Button
              size="sm"
              variant="outline"
              className="bg-white"
              onClick={() => setAddParentOpen(true)}
            >
              <Plus className="size-4 mr-1.5" />
              Add Parent
            </Button>
          )}
        </div>
        <div className="rounded-xl bg-background p-1.5 shadow-sm border">
          <div className="overflow-hidden rounded-lg border">
            {!primary && !secondary ? (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                No parents on file.{" "}
                <a
                  href="mailto:tward@sailfuture.org?subject=Missing%20contacts"
                  className="text-primary underline underline-offset-2"
                >
                  Contact the office
                </a>
                .
              </p>
            ) : (
              <Table className="text-sm">
                <TableBody>
                  {primary ? (
                    <ContactTableRow
                      contact={primary}
                      role="Primary"
                      invite={{ status: primary.invite_status }}
                      onEdit={() =>
                        setEditing({ kind: "parent", record: primary })
                      }
                    />
                  ) : (
                    <ContactEmptyRow note="No primary parent on file." />
                  )}
                  {secondary ? (
                    <ContactTableRow
                      contact={secondary}
                      role="Secondary"
                      invite={{ status: secondary.invite_status }}
                      onEdit={() =>
                        setEditing({ kind: "parent", record: secondary })
                      }
                      onDelete={() =>
                        setPendingDelete({
                          kind: "parent",
                          id: secondary.id,
                          name: `${secondary.first_name} ${secondary.last_name}`,
                        })
                      }
                    />
                  ) : null}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </div>

      {/* Emergency Contacts — own card, all rows deletable (behind the
          shared confirmation dialog below). */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Emergency Contacts</h2>
          <Button
            size="sm"
            variant="outline"
            className="bg-white"
            onClick={() => setAddEmergencyOpen(true)}
          >
            <Plus className="size-4 mr-1.5" />
            Add Emergency Contact
          </Button>
        </div>
        <div className="rounded-xl bg-background p-1.5 shadow-sm border">
          <div className="overflow-hidden rounded-lg border">
            {(emergencyContacts ?? []).length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                No emergency contacts on file.
              </p>
            ) : (
              <Table className="text-sm">
                <TableBody>
                  {(emergencyContacts ?? []).map((ec) => (
                    <ContactTableRow
                      key={ec.id}
                      contact={ec}
                      onEdit={() =>
                        setEditing({ kind: "emergency", record: ec })
                      }
                      onDelete={() =>
                        setPendingDelete({
                          kind: "emergency",
                          id: ec.id,
                          name: `${ec.first_name} ${ec.last_name}`,
                        })
                      }
                    />
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </div>
      </>
      ) : null}

      {/* Contact footer */}
      <p className="text-xs text-muted-foreground text-center pt-4 border-t">
        Need to change anything else? Reach us at{" "}
        <a
          href="mailto:tward@sailfuture.org"
          className="text-primary underline underline-offset-2"
        >
          tward@sailfuture.org
        </a>{" "}
        or{" "}
        <a
          href="tel:+17279001436"
          className="text-primary underline underline-offset-2"
        >
          (727) 900-1436
        </a>
        .
      </p>

      {/* Edit sheet — shared by both parent and emergency-contact edits. */}
      <EditContactSheet
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        kind={editing?.kind ?? "parent"}
        contact={editing?.record ?? null}
        onSaved={() => setEditing(null)}
      />

      {/* Add Parent — Clerk invitation flow, mirrors the registration page. */}
      <AddParentSheet
        open={addParentOpen}
        onOpenChange={setAddParentOpen}
      />

      {/* Add Emergency Contact — direct create. */}
      <AddEmergencyContactSheet
        open={addEmergencyOpen}
        onOpenChange={setAddEmergencyOpen}
      />

      {/* Create New Registration — residential / foster families only.
          Creates the student + a marked application, then routes to the
          per-student registration flow. */}
      <AddResidentialStudentSheet
        open={addResidentialOpen}
        onOpenChange={setAddResidentialOpen}
        yearId={yearId}
      />

      {/* Delete confirmation — applies to secondary parents and emergency
          contacts. Primary parents intentionally don't have a delete path. */}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this contact?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `${pendingDelete.name} will be removed from your family. You can re-add them later.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {deleting ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Re-application Progress card — rendered on the dashboard when the
 *  parent is viewing a year they're re-applying for (not yet enrolled).
 *  Shows a section-by-section status grid for the unified apply-flow
 *  progress row + a Resume button that drops them back into the apply
 *  pages. Once submitted the card flips into a status-only state
 *  (no action button) since the family can't edit a submitted row;
 *  the apply pages themselves handle review-mode access. */
function ReApplicationProgressCard({
  yearName,
  progress,
  onResume,
}: {
  yearName: string;
  progress: {
    family_completed?: boolean;
    students_completed?: boolean;
    financial_aid_completed?: boolean;
    testing_completed?: boolean;
    isSubmitted?: boolean;
    isAccepted?: boolean;
    submitted_at?: number | null;
    last_edited?: number | null;
  } | null;
  onResume: () => void;
}) {
  // The fourth section pivots between Testing (new applicants) and
  // Transportation (re-enrollers). Re-applying mode here is by
  // definition the Re-Enrollment path, so we render Transportation.
  // The boolean stays on `testing_completed` because the column is
  // shared across both flows — for re-enrollers it gets auto-stamped
  // `true` at bootstrap (NWEA skipped), then carries Transportation
  // completion state from the Students page going forward.
  const sections = [
    {
      label: "Family Information",
      done: !!progress?.family_completed,
      sub: "Confirm parent + contact info for the new year",
    },
    {
      label: "Student Information",
      done: !!progress?.students_completed,
      sub: "Confirm each student + transportation preference",
    },
    {
      label: "Financial Aid",
      done: !!progress?.financial_aid_completed,
      sub: "Re-submit the Opportunity Scholarship application",
    },
    {
      label: "Transportation",
      done: !!progress?.testing_completed,
      sub: "Bus / shuttle preference for the new year",
    },
  ];
  const sectionsComplete = sections.filter((s) => s.done).length;
  const sectionsTotal = sections.length;
  const isSubmitted = progress?.isSubmitted === true;
  const isAccepted = progress?.isAccepted === true;
  const submittedAt = progress?.submitted_at;

  // Tint + status copy depend on lifecycle stage.
  //   accepted  → success banner, no action (already done)
  //   submitted → awaiting-review, no action
  //   in-prog   → standard card with Resume button
  const stateTone: "accepted" | "submitted" | "in_progress" = isAccepted
    ? "accepted"
    : isSubmitted
    ? "submitted"
    : "in_progress";

  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      {/* Header — title + status pill + completion summary */}
      <div className="border-b px-5 py-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            Re-application for {yearName}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {stateTone === "accepted"
              ? `Accepted${submittedAt ? ` · submitted ${new Date(submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}`
              : stateTone === "submitted"
              ? `Submitted${submittedAt ? ` on ${new Date(submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · awaiting admin review` : " · awaiting admin review"}`
              : `${sectionsComplete} of ${sectionsTotal} sections complete`}
          </p>
        </div>
        <span
          className={
            stateTone === "accepted"
              ? "inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2.5 py-0.5 text-xs font-medium"
              : stateTone === "submitted"
              ? "inline-flex items-center gap-1.5 rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-200 px-2.5 py-0.5 text-xs font-medium"
              : "inline-flex items-center gap-1.5 rounded-full bg-amber-50 text-amber-800 ring-1 ring-amber-200 px-2.5 py-0.5 text-xs font-medium"
          }
        >
          {stateTone === "accepted" ? (
            <>
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Accepted
            </>
          ) : stateTone === "submitted" ? (
            <>
              <Clock className="size-3.5" aria-hidden="true" />
              Submitted
            </>
          ) : (
            <>
              <Circle className="size-3.5" aria-hidden="true" />
              In Progress
            </>
          )}
        </span>
      </div>

      {/* Section table — one row per section bool. */}
      <div className="divide-y">
        {sections.map((s) => (
          <div
            key={s.label}
            className="flex items-center justify-between gap-3 px-5 py-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              {s.done ? (
                <CheckCircle2
                  className="size-5 text-emerald-600 shrink-0"
                  aria-hidden="true"
                />
              ) : (
                <Circle
                  className="size-5 text-muted-foreground/50 shrink-0"
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium">{s.label}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {s.sub}
                </p>
              </div>
            </div>
            <span
              className={
                s.done
                  ? "text-xs font-medium text-emerald-700"
                  : "text-xs font-medium text-muted-foreground"
              }
            >
              {s.done ? "Complete" : "Incomplete"}
            </span>
          </div>
        ))}
      </div>

      {/* Footer — Resume button when there's still work to do, status
          copy otherwise. */}
      {stateTone === "in_progress" ? (
        <div className="border-t bg-muted/20 px-5 py-3 flex items-center justify-end">
          <button
            type="button"
            onClick={onResume}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Resume re-application
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="border-t bg-muted/20 px-5 py-3">
          <p className="text-xs text-muted-foreground">
            {stateTone === "accepted"
              ? `You're confirmed for the ${yearName} school year. Registration paperwork will appear on this dashboard once it's ready.`
              : `Admissions is reviewing your re-application. We'll be in touch as we confirm your spot for the ${yearName} school year.`}
          </p>
        </div>
      )}
    </div>
  );
}

/** Empty-state row used when a group has no contacts on file. */
function ContactEmptyRow({ note }: { note: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={2} className="px-4 py-3 text-xs text-muted-foreground">
        {note}
      </TableCell>
    </TableRow>
  );
}

/** Single contact row — name + relationship + phone/email + edit + delete.
 *  Delete is opt-in via `onDelete`; primary parent rows omit it because
 *  the family always needs at least one primary on file. */
function ContactTableRow({
  contact,
  onEdit,
  onDelete,
  role,
  invite,
}: {
  contact: Parent | EmergencyContact;
  onEdit: () => void;
  onDelete?: () => void;
  /** Optional pill rendered next to the name — used to label primary vs.
   *  secondary parents under the combined Parents / Guardians group. */
  role?: string;
  /** When present (parent rows only), renders the invite-status badge +
   *  a "Resend invite" button. Omitted for emergency contacts, which
   *  have no Clerk login. */
  invite?: { status?: string | null; clerkUserId?: string | null };
}) {
  return (
    // Not clickable — suppress the table's default row hover so only
    // the action buttons read as interactive.
    <TableRow className="hover:bg-transparent">
      <TableCell className="px-4 py-3">
        <p className="font-medium flex items-center gap-2 flex-wrap">
          <span>
            {contact.first_name} {contact.last_name}
          </span>
          {role ? (
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5">
              {role}
            </span>
          ) : null}
          {contact.relationship ? (
            <span className="font-normal text-muted-foreground">
              {contact.relationship}
            </span>
          ) : null}
          {invite ? (
            <InviteStatusBadge
              status={invite.status}
              clerkUserId={invite.clerkUserId}
            />
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {[contact.phone, contact.email].filter(Boolean).join(" · ") || "—"}
        </p>
      </TableCell>
      <TableCell className="px-4 py-3 text-right whitespace-nowrap">
        {invite ? (
          <ResendInviteButton
            parentId={contact.id}
            status={invite.status}
            clerkUserId={invite.clerkUserId}
            size="xs"
            className="mr-1 align-middle"
          />
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          className="size-8 text-muted-foreground hover:text-foreground"
          onClick={onEdit}
          aria-label={`Edit ${contact.first_name} ${contact.last_name}`}
        >
          <Pencil className="size-4" />
        </Button>
        {onDelete && (
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-muted-foreground hover:text-red-600 ml-1"
            onClick={onDelete}
            aria-label={`Remove ${contact.first_name} ${contact.last_name}`}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
