"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import SignatureCanvas from "react-signature-canvas";
import { CheckCircle2, Circle, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { mutateApplications, useSchoolYears } from "@/hooks/use-api";
import {
  additionAgreementSigned,
  additionRegistrationSubmitted,
  additionTuitionSigned,
  additionWaiverSigned,
  type AdditionRegistrationState,
} from "@/lib/midyear-additions";
import { resolveStudentReceiptAmounts } from "@/lib/student-receipt";
import { formatTimestampUs } from "@/lib/us-date";
import { PandaDocSigningStep } from "./pandadoc-signing-step";
import { ResidentialPacketForm } from "./residential-packet-form";

/**
 * Registration for a sibling admissions accepted mid-year — the same
 * paperwork a family signs at registration, for this one student and
 * stored on their own packet, since the family signed theirs before
 * this student existed:
 *
 *   1. Tuition & Scholarship — this student's amounts, signed.
 *   2. Enrollment Agreement — their own PandaDoc envelope.
 *   3. Liability Waiver — per student, as for every student.
 *   4. Registration Packet — the per-student packet form; submitting it
 *      records the submit server-side (which re-checks 1–3) and hands
 *      the packet to admin, whose confirm enrolls the student.
 *
 * Volunteer hours are family-level and already done.
 */

export interface SiblingBillingFields {
  id: number;
  registration_students_id: number;
  registration_school_years_id: number;
  sufs_amount?: number | null;
  annual_fee?: number | null;
  remaining_opportunity_amount?: number | null;
  monthly_amount?: number | null;
  confirmed_scholarship?: boolean;
}

type Packet = AdditionRegistrationState & {
  id: number;
  registration_students_id: number;
  registration_school_years_id: number;
  addition_tuition_signed_name?: string | null;
  addition_enrollment_agreement_pandadoc_id?: string | null;
  liability_waiver_pandadoc_id?: string | null;
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
};

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function SiblingRegistration({
  app,
  studentName,
}: {
  app: SiblingBillingFields;
  studentName: string;
}) {
  const yearId = app.registration_school_years_id;
  const studentId = app.registration_students_id;
  const firstName = studentName.split(" ")[0] || studentName;

  const {
    data: packets,
    error,
    mutate,
  } = useSWR<Packet[]>(`/api/student-registration?yearId=${yearId}`, fetcher);
  const packet = useMemo(
    () =>
      packets?.find((p) => Number(p.registration_students_id) === studentId) ??
      null,
    [packets, studentId]
  );

  const tuitionDone = additionTuitionSigned(packet);
  const agreementDone = additionAgreementSigned(packet);
  const waiverDone = additionWaiverSigned(packet);
  const submitted = additionRegistrationSubmitted(packet);
  const confirmed = packet?.registrationConfirmed === true;

  async function submitRegistration() {
    const res = await fetch(`/api/student-additions/${app.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submitRegistration: true }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error ?? "Couldn't submit. Please try again.");
    await Promise.all([mutate(), mutateApplications()]);
  }

  if (!packets && error) {
    return (
      <Card className="py-0">
        <CardContent className="py-5 text-sm text-muted-foreground">
          We couldn&rsquo;t load {firstName}&rsquo;s registration.{" "}
          <button className="underline" onClick={() => void mutate()}>
            Try again
          </button>
        </CardContent>
      </Card>
    );
  }
  if (!packets) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }
  if (!packet) {
    // Accepted is derived from the packet existing, so this only shows
    // if the packet read raced the page's own lookup.
    return (
      <Card className="py-0">
        <CardContent className="py-5 text-sm text-muted-foreground">
          {firstName}&rsquo;s registration is being set up. Refresh in a moment.
        </CardContent>
      </Card>
    );
  }

  if (confirmed || submitted) {
    return (
      <Card className="overflow-hidden gap-0 py-0">
        <CardContent className="flex items-start gap-3 py-5 bg-white dark:bg-background">
          {confirmed ? (
            <CheckCircle2 className="size-5 text-green-600 shrink-0 mt-0.5" />
          ) : (
            <Clock className="size-5 text-amber-500 shrink-0 mt-0.5" />
          )}
          <div className="space-y-1">
            <p className="font-medium">
              {confirmed ? `${firstName} is enrolled` : "Registration in review"}
            </p>
            <p className="text-sm text-muted-foreground">
              {confirmed
                ? `Admissions confirmed ${firstName}'s registration.`
                : `You submitted ${firstName}'s registration${
                    packet.addition_registration_submitted_at
                      ? ` on ${formatTimestampUs(packet.addition_registration_submitted_at)}`
                      : ""
                  }. Our admissions team will confirm it and email you.`}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <StepCard
        n={1}
        title="Tuition & Scholarship"
        done={tuitionDone}
        doneNote={
          tuitionDone
            ? `Signed by ${packet.addition_tuition_signed_name ?? "you"}`
            : undefined
        }
      >
        <TuitionStep
          app={app}
          firstName={firstName}
          signed={tuitionDone}
          onSigned={() => mutate()}
        />
      </StepCard>

      <StepCard n={2} title="Enrollment Agreement" done={agreementDone}>
        <p className="text-sm text-muted-foreground mb-3">
          {firstName}&rsquo;s own enrollment agreement — the one you signed
          earlier covers the students enrolled at the time.
        </p>
        <PandaDocSigningStep
          type="addition_enrollment_agreement"
          applicationId={app.id}
          yearId={yearId}
          documentId={packet.addition_enrollment_agreement_pandadoc_id ?? null}
          signed={agreementDone}
          label="enrollment agreement"
          onSigned={() => mutate()}
        />
      </StepCard>

      <StepCard n={3} title="Liability Waiver" done={waiverDone}>
        <PandaDocSigningStep
          type="liability_waiver"
          applicationId={app.id}
          yearId={yearId}
          documentId={packet.liability_waiver_pandadoc_id ?? null}
          signed={waiverDone}
          label="liability waiver"
          onSigned={() => mutate()}
        />
      </StepCard>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <StepNumber n={4} done={false} />
          <h2 className="text-base font-semibold">Registration Packet</h2>
        </div>
        {!(tuitionDone && agreementDone && waiverDone) ? (
          <p className="text-sm text-muted-foreground">
            You can fill this in now. Submitting unlocks once steps 1–3 are
            signed.
          </p>
        ) : null}
        <ResidentialPacketForm
          studentId={studentId}
          yearId={yearId}
          registrationTypeId={1}
          studentName={studentName}
          onSubmit={submitRegistration}
        />
      </div>
    </div>
  );
}

function StepNumber({ n, done }: { n: number; done: boolean }) {
  return done ? (
    <CheckCircle2 className="size-5 text-green-600" />
  ) : (
    <span className="inline-flex size-5 items-center justify-center rounded-full border text-xs font-medium text-muted-foreground">
      {n}
    </span>
  );
}

function StepCard({
  n,
  title,
  done,
  doneNote,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  doneNote?: string;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden gap-0 py-0">
      <CardHeader className="py-3 !pb-3 border-b">
        <CardTitle className="flex items-center gap-2 text-base">
          <StepNumber n={n} done={done} />
          {title}
          {doneNote ? (
            <span className="text-sm font-normal text-muted-foreground">
              · {doneNote}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="py-5 bg-white dark:bg-background">{children}</CardContent>
    </Card>
  );
}

/** This student's tuition + scholarship amounts and a signature, like
 *  the apply flow's Tuition step but for one student. */
function TuitionStep({
  app,
  firstName,
  signed,
  onSigned,
}: {
  app: SiblingBillingFields;
  firstName: string;
  signed: boolean;
  onSigned: () => Promise<unknown>;
}) {
  const { data: years } = useSchoolYears();
  const tuition = useMemo(() => {
    const year = (years as { id: number; tuition?: number }[] | undefined)?.find(
      (y) => y.id === app.registration_school_years_id
    );
    return typeof year?.tuition === "number" ? year.tuition : null;
  }, [years, app.registration_school_years_id]);

  const amounts = resolveStudentReceiptAmounts(app);
  const final = app.confirmed_scholarship === true;
  const scholarship =
    tuition == null
      ? null
      : Math.max(tuition - amounts.sufsAmount - amounts.remainingTuition, 0);

  const sigRef = useRef<SignatureCanvas>(null);
  const [hasSignature, setHasSignature] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function sign() {
    if (saving) return;
    if (!sigRef.current || sigRef.current.isEmpty()) {
      toast.error("Please sign above.");
      return;
    }
    if (!name.trim()) {
      toast.error("Please type your full name.");
      return;
    }
    setSaving(true);
    try {
      const dataUrl = sigRef.current.toDataURL("image/png");
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const fd = new FormData();
      fd.append(
        "file",
        new File([blob], "tuition-signature.png", { type: "image/png" })
      );
      const up = await fetch("/api/upload", { method: "POST", body: fd });
      if (!up.ok) throw new Error("Couldn't save your signature. Please try again.");
      const meta = await up.json();
      const res = await fetch(`/api/student-additions/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tuitionSignature: { signature: JSON.stringify(meta), name: name.trim() },
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't sign. Please try again.");
      // Hold the spinner until the signed state is on screen.
      await onSigned();
      toast.success("Tuition signed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't sign. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const rows: [string, string][] = [
    ["Tuition", tuition == null ? "—" : usd(tuition)],
    ["Step Up For Students", usd(amounts.sufsAmount)],
    [
      "Opportunity Scholarship",
      final && scholarship != null ? `− ${usd(scholarship)}` : "—",
    ],
    ["Tuition you pay", usd(amounts.remainingTuition)],
    ["Annual fees", usd(amounts.annualFee)],
    ["Total for the year", usd(amounts.subtotal)],
    ["Monthly", usd(amounts.monthly)],
  ];

  return (
    <div className="space-y-5">
      <dl className="divide-y rounded-md border text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between px-4 py-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {signed ? null : !final ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Circle className="size-4" />
          {firstName}&rsquo;s amounts aren&rsquo;t final yet — you can sign once
          admissions confirms them.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            By signing below, I acknowledge that I have reviewed {firstName}
            &rsquo;s tuition and scholarship breakdown above and understand the
            financial obligations for the school year.
          </p>
          <div className="rounded-md border border-input bg-background">
            <SignatureCanvas
              ref={sigRef}
              penColor="black"
              onEnd={() => setHasSignature(true)}
              canvasProps={{
                className: "w-full rounded-md cursor-crosshair",
                style: { height: 150 },
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Sign above using your mouse or touchscreen
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                sigRef.current?.clear();
                setHasSignature(false);
              }}
            >
              Clear Signature
            </Button>
          </div>
          <Field>
            <FieldLabel className="text-xs">Your full name</FieldLabel>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button onClick={sign} disabled={saving || !hasSignature || !name.trim()}>
            {saving ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : null}
            Sign tuition
          </Button>
        </div>
      )}
    </div>
  );
}
