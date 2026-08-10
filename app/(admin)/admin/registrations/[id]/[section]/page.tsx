"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  FileText,
  Loader2,
  Pencil,
  ShieldAlert,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { adminFetcher } from "@/lib/admin-fetcher";
import { SufsAwardCard } from "@/components/admin/sufs-award-card";
import { TuitionBreakdownTable } from "@/components/admin/tuition-breakdown-table";
import type {
  AdminFamilyRegistrationResponse,
  AdminFamilyRegistrationStudentRow,
} from "@/app/api/admin/registrations/[id]/route";
import type {
  XanoFamilyPayment,
  XanoStudentRegistration,
} from "@/lib/xano";

/**
 * Per-section editor on the admin registration detail flow. Routed
 * by the `[section]` slug in the URL — Tuition / Enrollment /
 * Registration Packet / Volunteer Hours all share this single page,
 * branched on the slug.
 *
 * Mirrors the apply-flow's `/admin/families/[id]/[section]` route
 * shape so the Edit button on each registration section card has a
 * predictable destination. Editors exist for accepted families too —
 * registration data stays amendable without revoking acceptance; the
 * only thing that stays locked is the signed tuition amount (which
 * lives behind `confirmed_scholarship` on the Scholarship
 * Determination card, not here).
 *
 * What each slug edits:
 *   - tuition      → per-student SUFS tier / status / award ID
 *                    (always editable — award bookkeeping arrives
 *                    after acceptance), family transportation total.
 *                    Signed per-student amounts render read-only.
 *   - enrollment   → PandaDoc state read-only + an explicit admin
 *                    override for the signed latch (webhook recovery).
 *   - registration → full per-student packet contents (sizes,
 *                    medical, pickup permissions).
 *   - volunteer    → printed name on the acknowledgment + the
 *                    section-complete flag (admin override).
 */
export default function RegistrationSectionEditorPage() {
  const params = useParams<{ id: string; section: string }>();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  const familyId = Number(params.id);
  const slug = (params.section ?? "").toLowerCase();
  const config = SECTION_CONFIG[slug] ?? UNKNOWN_SECTION;

  const backHref = yearId
    ? `/admin/registrations/${familyId}?yearId=${yearId}#${config.anchor}`
    : `/admin/registrations/${familyId}#${config.anchor}`;

  // Same read model the registration overview consumes — the editors
  // need the per-student rows (packet + SUFS fields + billing math),
  // the progress row, and the school-year context.
  const swrKey =
    Number.isFinite(familyId) && yearId
      ? `/api/admin/registrations/${familyId}?yearId=${yearId}`
      : null;
  const { data, isLoading, mutate } =
    useSWR<AdminFamilyRegistrationResponse>(swrKey, adminFetcher);

  // Family-payment row — carries `transportation_total` (the one
  // family-level editable number left on that table).
  const familyPaymentKey =
    Number.isFinite(familyId) && yearId
      ? `/api/admin/registration-families-payment-by-family?familyId=${familyId}&yearId=${yearId}`
      : null;
  const { data: familyPayment, mutate: mutateFamilyPayment } =
    useSWR<XanoFamilyPayment | null>(familyPaymentKey, adminFetcher);

  const familyName = data?.family?.family_name ?? "";

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-3" />
        Back to registration overview
      </Link>

      <div className="flex items-center gap-2">
        <Pencil className="size-4 text-muted-foreground" />
        <h1 className="text-lg font-semibold">
          {config.title}
          {familyName ? (
            <span className="text-muted-foreground font-normal">
              {" "}
              — {familyName}
            </span>
          ) : null}
        </h1>
      </div>

      {isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : slug === "tuition" ? (
        <TuitionEditor
          data={data}
          familyPayment={familyPayment ?? null}
          onSaved={() => {
            void mutate();
            void mutateFamilyPayment();
          }}
        />
      ) : slug === "enrollment" ? (
        <EnrollmentEditor
          familyId={familyId}
          yearId={Number(yearId)}
          progress={data.progress}
          onSaved={() => void mutate()}
        />
      ) : slug === "registration" ? (
        <RegistrationPacketEditor
          students={data.students}
          onSaved={() => void mutate()}
        />
      ) : slug === "volunteer" ? (
        <VolunteerEditor
          familyId={familyId}
          yearId={Number(yearId)}
          progress={data.progress}
          onSaved={() => void mutate()}
        />
      ) : (
        <Card className="overflow-hidden gap-0 py-0 bg-white">
          <CardContent className="py-8 px-6 text-sm text-muted-foreground">
            Unknown section &ldquo;{slug}&rdquo;. Head back to the
            registration overview.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─────────────────────── Tuition ─────────────────────── */

function TuitionEditor({
  data,
  familyPayment,
  onSaved,
}: {
  data: AdminFamilyRegistrationResponse;
  familyPayment: XanoFamilyPayment | null;
  onSaved: () => void;
}) {
  const students = data.students;
  const sum = (pick: (s: AdminFamilyRegistrationStudentRow) => number | null) =>
    students.reduce((acc, s) => acc + (pick(s) ?? 0), 0);
  const monthlyTotal = sum((s) => s.monthly_amount);
  const annualFeeTotal = sum((s) => s.annual_fee);
  const sufsTotal = sum((s) => s.sufs_amount);
  const fmt$ = (n: number) =>
    `$${n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  return (
    <div className="space-y-4">
      {/* SUFS award bookkeeping — always editable, even after the
          scholarship is confirmed and the family has signed. Award
          IDs and level corrections arrive from the SUFS portal long
          after acceptance; the dollar amounts billed are untouched
          (they read from the stored `sufs_amount`). */}
      <SufsAwardCard
        rows={students.map((s) => ({
          applicationId: s.application_id,
          studentName: s.student_full_name,
          sufsType: s.sufs_type,
          sufsStatus: s.sufs_status,
          awardId: s.sufs_award_id || null,
        }))}
        onSaved={onSaved}
      />

      <TransportationCard
        familyPayment={familyPayment}
        onSaved={onSaved}
      />

      {/* Signed amounts — read-only by design. Per-student tuition
          math is locked once the scholarship is confirmed + signed;
          changes flow through the Scholarship Determination card on
          the application detail page (which re-prices Stripe). */}
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Signed Tuition (read-only)</CardTitle>
        </CardHeader>
        <CardContent className="py-5 space-y-4">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <ReadOnlyStat label="Monthly Tuition" value={fmt$(monthlyTotal)} />
            <ReadOnlyStat
              label="Annual Admin Fee"
              value={fmt$(annualFeeTotal)}
            />
            <ReadOnlyStat label="SUFS Total" value={fmt$(sufsTotal)} />
          </div>
          <TuitionBreakdownTable
            students={students}
            schoolYear={data.school_year}
            scholarship={data.scholarship}
          />
          <p className="text-xs text-muted-foreground">
            The tuition amounts the family signed for are locked here.
            To change a student&rsquo;s tuition, use the Scholarship
            Determination card on the application detail page — it
            re-prices the Stripe subscription and keeps the signed
            record coherent.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function TransportationCard({
  familyPayment,
  onSaved,
}: {
  familyPayment: XanoFamilyPayment | null;
  onSaved: () => void;
}) {
  const stored = familyPayment?.transportation_total ?? null;
  const [draft, setDraft] = useState(stored === null ? "" : String(stored));
  const [saving, setSaving] = useState(false);

  if (!familyPayment) {
    return (
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Transportation</CardTitle>
        </CardHeader>
        <CardContent className="py-5 text-sm text-muted-foreground">
          No family-payment row exists yet for this year — accept the
          family first, then the transportation total becomes editable
          here.
        </CardContent>
      </Card>
    );
  }

  async function save() {
    // Empty input = "waived / not applicable" → null clears the
    // column (the SNAP convention the PATCH route documents).
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && !Number.isFinite(next)) {
      toast.error("Transportation total must be a number.");
      return;
    }
    if (next === stored) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/family-payment/${familyPayment!.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transportation_total: next }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      toast.success(
        next === null
          ? "Transportation marked waived."
          : "Transportation total saved."
      );
      onSaved();
    } catch (err) {
      console.error("[TransportationCard.save]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <CardTitle className="text-base">Transportation</CardTitle>
      </CardHeader>
      <CardContent className="py-5 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              Transportation total for the year ($). Leave blank to
              mark it waived (SNAP families).
            </p>
            <Input
              value={draft}
              inputMode="decimal"
              placeholder="Waived"
              disabled={saving}
              onChange={(e) =>
                setDraft(e.target.value.replace(/[^0-9.]/g, ""))
              }
              className="w-48 bg-white"
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => void save()}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {saving ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : (
              <Check className="size-3.5 mr-1.5" />
            )}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────── Enrollment ─────────────────────── */

function EnrollmentEditor({
  familyId,
  yearId,
  progress,
  onSaved,
}: {
  familyId: number;
  yearId: number;
  progress: AdminFamilyRegistrationResponse["progress"];
  onSaved: () => void;
}) {
  const isSigned = progress?.is_enrollment_agreement_signed === true;
  const pdId = progress?.enrollment_agreement_pandadoc_id ?? "";
  const pdStatus = progress?.enrollment_agreement_status ?? "";
  const sentAt = progress?.enrollment_agreement_sent ?? null;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function setSigned(next: boolean) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/registration-progress", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyId,
          yearId,
          is_enrollment_agreement_signed: next,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      toast.success(
        next
          ? "Enrollment agreement marked signed."
          : "Enrollment agreement marked not signed."
      );
      setConfirmOpen(false);
      onSaved();
    } catch (err) {
      console.error("[EnrollmentEditor.setSigned]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">PandaDoc envelope</CardTitle>
        </CardHeader>
        <CardContent className="py-5 space-y-4">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <ReadOnlyStat
              label="Status"
              value={isSigned ? "Signed" : pdStatus || "Not sent"}
            />
            <ReadOnlyStat
              label="Sent"
              value={sentAt ? new Date(sentAt).toLocaleString() : "—"}
            />
            <ReadOnlyStat label="Document ID" value={pdId || "—"} />
          </div>
          {isSigned && pdId ? (
            <Button asChild variant="outline" size="sm" className="bg-white">
              <a
                href={`/api/admin/pandadoc/download?documentId=${pdId}`}
                target="_blank"
                rel="noreferrer"
                download={`enrollment-agreement-${pdId}.pdf`}
              >
                <FileText className="size-3.5 mr-1.5" />
                Download signed PDF
              </a>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {/* The agreement lifecycle is owned by PandaDoc end-to-end;
          this override exists for webhook recovery (envelope signed
          but the latch never flipped) or for voiding a bad record.
          It edits OUR latch only — the PandaDoc envelope itself is
          not touched. */}
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="size-4 text-amber-600" />
            Admin override — signed latch
          </CardTitle>
        </CardHeader>
        <CardContent className="py-5 space-y-3 text-sm">
          <p className="text-muted-foreground">
            The agreement is currently marked{" "}
            <span className="font-medium text-foreground">
              {isSigned ? "signed" : "not signed"}
            </span>
            . Flipping this changes SailFuture&rsquo;s record only — the
            PandaDoc envelope is untouched. Use it when the PandaDoc
            webhook missed a signature, or to void a record that
            shouldn&rsquo;t count.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={saving}
            className="bg-white"
          >
            {isSigned ? "Mark as not signed" : "Mark as signed"}
          </Button>
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {isSigned
                    ? "Mark the enrollment agreement as NOT signed?"
                    : "Mark the enrollment agreement as signed?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {isSigned
                    ? "The family will show as needing to sign again, and parent surfaces that gate on the signed agreement will lock accordingly."
                    : "This records the agreement as signed on the family's behalf. Only do this when the signature genuinely exists (e.g. the PandaDoc envelope is completed but the webhook missed it)."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={saving}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                  onClick={(e) => {
                    e.preventDefault();
                    void setSigned(!isSigned);
                  }}
                >
                  {saving ? (
                    <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  ) : null}
                  Yes, continue
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────── Registration Packet ─────────────────────── */

const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const SWIM_LEVELS = ["None", "Beginner", "Intermediate", "Advanced"];
const YES_NO = ["Yes", "No"] as const;
const UNSET = "__unset";

type PacketDraft = {
  shirt_size: string;
  pant_size: string;
  swim_level: string;
  is_student_on_medicaid: "" | "Yes" | "No";
  medicaid_number: string;
  medicaid_provider: string;
  carry_epi_pen: "" | "Yes" | "No";
  allergies: string;
  dietary_restrictions: string;
  prescription_medications: string;
  health_conditions: string;
  vision_impairments: string;
  hearing_impairments: string;
  epipen_explainer: string;
  permission_for_acetaminophen: string;
  additional_health_information: string;
  interested_in_counseling_services: string;
  iep_description: string;
  other_adults_approved_for_pickup: string;
  prohibited_adults: string;
};

const NARRATIVE_FIELDS: Array<{
  key: keyof PacketDraft;
  label: string;
}> = [
  { key: "allergies", label: "Allergies" },
  { key: "dietary_restrictions", label: "Dietary restrictions" },
  { key: "prescription_medications", label: "Prescription medications" },
  { key: "health_conditions", label: "Health conditions" },
  { key: "vision_impairments", label: "Vision impairments" },
  { key: "hearing_impairments", label: "Hearing impairments" },
  { key: "epipen_explainer", label: "Epi-pen details" },
  {
    key: "permission_for_acetaminophen",
    label: "Permission for acetaminophen",
  },
  {
    key: "additional_health_information",
    label: "Additional health information",
  },
  {
    key: "interested_in_counseling_services",
    label: "Interested in counseling services",
  },
  { key: "iep_description", label: "IEP description" },
];

function packetToDraft(
  p: XanoStudentRegistration | null | undefined
): PacketDraft {
  return {
    shirt_size: p?.shirt_size ?? "",
    pant_size: p?.pant_size ?? "",
    swim_level: p?.swim_level ?? "",
    is_student_on_medicaid:
      p?.is_student_on_medicaid === true
        ? "Yes"
        : p?.is_student_on_medicaid === false
          ? "No"
          : "",
    medicaid_number:
      p?.medicaid_number === undefined || p?.medicaid_number === null
        ? ""
        : String(p.medicaid_number),
    medicaid_provider: p?.medicaid_provider ?? "",
    carry_epi_pen:
      p?.carry_epi_pen === true
        ? "Yes"
        : p?.carry_epi_pen === false
          ? "No"
          : "",
    allergies: p?.allergies ?? "",
    dietary_restrictions: p?.dietary_restrictions ?? "",
    prescription_medications: p?.prescription_medications ?? "",
    health_conditions: p?.health_conditions ?? "",
    vision_impairments: p?.vision_impairments ?? "",
    hearing_impairments: p?.hearing_impairments ?? "",
    epipen_explainer: p?.epipen_explainer ?? "",
    permission_for_acetaminophen: p?.permission_for_acetaminophen ?? "",
    additional_health_information: p?.additional_health_information ?? "",
    interested_in_counseling_services:
      p?.interested_in_counseling_services ?? "",
    iep_description: p?.iep_description ?? "",
    other_adults_approved_for_pickup:
      p?.other_adults_approved_for_pickup ?? "",
    prohibited_adults: p?.prohibited_adults ?? "",
  };
}

function RegistrationPacketEditor({
  students,
  onSaved,
}: {
  students: AdminFamilyRegistrationStudentRow[];
  onSaved: () => void;
}) {
  if (students.length === 0) {
    return (
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardContent className="py-8 px-6 text-sm text-muted-foreground">
          No active students for this year.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {students.map((row) => (
        <StudentPacketEditorCard
          key={row.student_id}
          row={row}
          onSaved={onSaved}
        />
      ))}
    </div>
  );
}

function StudentPacketEditorCard({
  row,
  onSaved,
}: {
  row: AdminFamilyRegistrationStudentRow;
  onSaved: () => void;
}) {
  const packet = row.packet;
  const [draft, setDraft] = useState<PacketDraft>(() =>
    packetToDraft(packet)
  );
  const [saving, setSaving] = useState(false);

  if (!packet) {
    return (
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">{row.student_full_name}</CardTitle>
        </CardHeader>
        <CardContent className="py-5 text-sm text-muted-foreground">
          No registration packet exists yet for this student — create
          one from the Registration Packet card on the overview page
          first.
        </CardContent>
      </Card>
    );
  }

  const set = (key: keyof PacketDraft, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // Same minimal-diff PATCH the overview's inline editor sends —
  // only changed fields go over the wire so concurrent edits don't
  // trample untouched columns.
  async function save() {
    if (!packet) return;
    const patch: Record<string, unknown> = {};
    const trimEq = (a: string, b: string) => a.trim() === (b ?? "").trim();
    if (!trimEq(draft.shirt_size, packet.shirt_size ?? ""))
      patch.shirt_size = draft.shirt_size.trim();
    if (!trimEq(draft.pant_size, packet.pant_size ?? ""))
      patch.pant_size = draft.pant_size.trim();
    if (!trimEq(draft.swim_level, packet.swim_level ?? ""))
      patch.swim_level = draft.swim_level.trim();
    if (!trimEq(draft.medicaid_provider, packet.medicaid_provider ?? ""))
      patch.medicaid_provider = draft.medicaid_provider.trim();
    for (const { key } of NARRATIVE_FIELDS) {
      const next = draft[key].trim();
      const prev = ((packet[key as keyof XanoStudentRegistration] as
        | string
        | null
        | undefined) ?? "").trim();
      if (next !== prev) patch[key] = next;
    }
    for (const key of [
      "other_adults_approved_for_pickup",
      "prohibited_adults",
    ] as const) {
      const next = draft[key].trim();
      const prev = (packet[key] ?? "").trim();
      if (next !== prev) patch[key] = next;
    }
    if (
      draft.is_student_on_medicaid !== "" &&
      (draft.is_student_on_medicaid === "Yes") !==
        (packet.is_student_on_medicaid === true)
    ) {
      patch.is_student_on_medicaid = draft.is_student_on_medicaid === "Yes";
    }
    if (
      draft.carry_epi_pen !== "" &&
      (draft.carry_epi_pen === "Yes") !== (packet.carry_epi_pen === true)
    ) {
      patch.carry_epi_pen = draft.carry_epi_pen === "Yes";
    }
    const draftMedNum = draft.medicaid_number.trim();
    const nextMedNum = draftMedNum === "" ? 0 : Number(draftMedNum);
    if (
      Number.isFinite(nextMedNum) &&
      nextMedNum !== (packet.medicaid_number ?? 0)
    ) {
      patch.medicaid_number = nextMedNum;
    }
    if (Object.keys(patch).length === 0) {
      toast.info("Nothing changed.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/student-registration/${packet.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      toast.success(`${row.student_full_name}'s packet saved.`);
      onSaved();
    } catch (err) {
      console.error("[StudentPacketEditorCard.save]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <CardTitle className="text-base">{row.student_full_name}</CardTitle>
      </CardHeader>
      <CardContent className="py-5 space-y-6">
        <EditorGroup title="Uniform & Activities">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <LabeledSelect
              label="Shirt size"
              value={draft.shirt_size}
              options={SHIRT_SIZES}
              onChange={(v) => set("shirt_size", v)}
              disabled={saving}
            />
            <LabeledInput
              label="Pant size"
              value={draft.pant_size}
              onChange={(v) => set("pant_size", v)}
              disabled={saving}
            />
            <LabeledSelect
              label="Swim level"
              value={draft.swim_level}
              options={SWIM_LEVELS}
              onChange={(v) => set("swim_level", v)}
              disabled={saving}
            />
          </div>
        </EditorGroup>

        <EditorGroup title="Health & Medical">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <LabeledSelect
              label="On Medicaid?"
              value={draft.is_student_on_medicaid}
              options={[...YES_NO]}
              onChange={(v) =>
                set("is_student_on_medicaid", v as "Yes" | "No")
              }
              disabled={saving}
            />
            <LabeledInput
              label="Medicaid number"
              value={draft.medicaid_number}
              onChange={(v) =>
                set("medicaid_number", v.replace(/\D/g, ""))
              }
              disabled={saving}
            />
            <LabeledInput
              label="Medicaid provider"
              value={draft.medicaid_provider}
              onChange={(v) => set("medicaid_provider", v)}
              disabled={saving}
            />
          </div>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <LabeledSelect
              label="Carries epi-pen?"
              value={draft.carry_epi_pen}
              options={[...YES_NO]}
              onChange={(v) => set("carry_epi_pen", v as "Yes" | "No")}
              disabled={saving}
            />
          </div>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            {NARRATIVE_FIELDS.map(({ key, label }) => (
              <LabeledTextarea
                key={key}
                label={label}
                value={draft[key]}
                onChange={(v) => set(key, v)}
                disabled={saving}
              />
            ))}
          </div>
        </EditorGroup>

        <EditorGroup title="Pickup Permissions">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            <LabeledTextarea
              label="Other adults approved for pickup"
              value={draft.other_adults_approved_for_pickup}
              onChange={(v) => set("other_adults_approved_for_pickup", v)}
              disabled={saving}
            />
            <LabeledTextarea
              label="Prohibited adults"
              value={draft.prohibited_adults}
              onChange={(v) => set("prohibited_adults", v)}
              disabled={saving}
            />
          </div>
        </EditorGroup>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDraft(packetToDraft(packet))}
            disabled={saving}
            className="bg-white"
          >
            Reset
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void save()}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {saving ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : (
              <Check className="size-3.5 mr-1.5" />
            )}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────── Volunteer ─────────────────────── */

function VolunteerEditor({
  familyId,
  yearId,
  progress,
  onSaved,
}: {
  familyId: number;
  yearId: number;
  progress: AdminFamilyRegistrationResponse["progress"];
  onSaved: () => void;
}) {
  const storedName = progress?.name_volunteer ?? "";
  const complete = progress?.isVolunteerHours === true;
  const hasSignature = !!(
    progress?.signature_data_volunteer ?? progress?.volunteer_signature_data
  );
  const [nameDraft, setNameDraft] = useState(storedName);
  const [saving, setSaving] = useState(false);

  async function patchProgress(
    body: Record<string, unknown>,
    successMessage: string
  ) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/registration-progress", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId, yearId, ...body }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Save failed (${res.status})`);
      }
      toast.success(successMessage);
      onSaved();
    } catch (err) {
      console.error("[VolunteerEditor.patchProgress]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function saveName() {
    const next = nameDraft.trim();
    if (next === storedName.trim()) return;
    if (next === "") {
      // Xano's edit endpoint drops empty-string inputs, so a clear
      // would silently no-op — refuse rather than pretend.
      toast.error(
        "The printed name can't be cleared, only replaced."
      );
      setNameDraft(storedName);
      return;
    }
    await patchProgress(
      { name_volunteer: next },
      "Printed name updated."
    );
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base">Acknowledgment</CardTitle>
        </CardHeader>
        <CardContent className="py-5 space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Printed name on the volunteer-policy acknowledgment
              </p>
              <Input
                value={nameDraft}
                disabled={saving}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                placeholder="—"
                className="w-72 bg-white"
              />
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => void saveName()}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saving ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <Check className="size-3.5 mr-1.5" />
              )}
              Save
            </Button>
          </div>
          <ReadOnlyStat
            label="Signature"
            value={hasSignature ? "On file (parent-drawn)" : "Not on file"}
          />
        </CardContent>
      </Card>

      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="size-4 text-amber-600" />
            Admin override — section complete
          </CardTitle>
        </CardHeader>
        <CardContent className="py-5 space-y-3 text-sm">
          <p className="text-muted-foreground">
            The parent-side Volunteer Hours section is currently marked{" "}
            <span className="font-medium text-foreground">
              {complete ? "complete" : "incomplete"}
            </span>
            . Override when the family acknowledged the policy out of
            band (paper form, in person).
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() =>
              void patchProgress(
                { isVolunteerHours: !complete },
                !complete
                  ? "Volunteer Hours marked complete."
                  : "Volunteer Hours marked incomplete."
              )
            }
            className="bg-white"
          >
            {complete ? "Mark incomplete" : "Mark complete"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────── Shared primitives ─────────────────────── */

function ReadOnlyStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-medium">{value || "—"}</p>
    </div>
  );
}

function EditorGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs">{label}</p>
      <Input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="bg-white"
      />
    </div>
  );
}

function LabeledTextarea({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs">{label}</p>
      <Textarea
        value={value}
        disabled={disabled}
        rows={2}
        onChange={(e) => onChange(e.target.value)}
        className="bg-white"
      />
    </div>
  );
}

/** Select with an "unset" sentinel row — Radix forbids `value=""` on
 *  items, so the empty draft value maps to the sentinel and back. */
function LabeledSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs">{label}</p>
      <Select
        value={value === "" ? UNSET : value}
        onValueChange={(v) => onChange(v === UNSET ? "" : v)}
        disabled={disabled}
      >
        <SelectTrigger className="w-full bg-white">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET}>—</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Title + scroll-anchor for each known section slug. The anchor
 * matches the `<section id="…">` ids on the registration overview
 * so the back link returns the user right to the card they came
 * from.
 */
const SECTION_CONFIG: Record<
  string,
  { title: string; anchor: string }
> = {
  tuition: { title: "Tuition", anchor: "section-tuition" },
  enrollment: {
    title: "Enrollment Agreement",
    anchor: "section-enrollment",
  },
  registration: {
    title: "Registration Packet",
    anchor: "section-registration",
  },
  volunteer: {
    title: "Volunteer Hours",
    anchor: "section-volunteer",
  },
};

const UNKNOWN_SECTION = { title: "Section", anchor: "" };
