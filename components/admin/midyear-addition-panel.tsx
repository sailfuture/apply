"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { CheckCircle2, Circle, Loader2, Undo2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import type { XanoApplication, XanoStudentRegistration } from "@/lib/xano";
import {
  additionAgreementSigned,
  additionRegistrationSubmitted,
  additionStage,
  additionTuitionSigned,
  additionWaiverSigned,
  isReturnedAddition,
} from "@/lib/midyear-additions";
import { formatTimestampUs } from "@/lib/us-date";

type PacketSummary = Omit<XanoStudentRegistration, "addition_tuition_signature">;

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
};

/**
 * The sibling's packet (null until accepted). Pass null for a student
 * who isn't a mid-year addition. Shares SWR's cache with the panel, so
 * the Determination row and the panel read one request.
 */
export function useMidYearAdditionPacket(applicationId: number | null) {
  const { data, isLoading, mutate } = useSWR<{ packet: PacketSummary | null }>(
    applicationId ? `/api/admin/student-additions/${applicationId}` : null,
    fetcher
  );
  return { packet: data?.packet ?? null, loaded: !!data, isLoading, mutate };
}

/**
 * Admissions decision + progress for ONE sibling added mid-year by an
 * already-accepted family (`is_midyear_addition`). Rendered above that
 * student's row on the Scholarship Determination card: the family-level
 * Accept / Return can't speak for a student who joined after the family
 * was accepted, so this panel does it per student through
 * `/api/admin/student-additions/[applicationId]`.
 *
 * Accept needs a submitted application and the student's scholarship
 * award confirmed on the row below. Once accepted the panel tracks the
 * parent's registration (tuition, enrollment agreement, waiver, packet)
 * and points to the Registrations page for the final packet confirm.
 */
export function MidYearAdditionPanel({
  app,
  studentName,
  familyId,
  yearId,
  onChanged,
}: {
  app: XanoApplication;
  studentName: string;
  familyId: number;
  yearId: number;
  onChanged: () => void | Promise<unknown>;
}) {
  const key = `/api/admin/student-additions/${app.id}`;
  const { packet, loaded, isLoading, mutate } = useMidYearAdditionPacket(app.id);
  const stage = additionStage(app, !!packet);
  const returned = isReturnedAddition(app);
  const confirmed = packet?.registrationConfirmed === true;

  const [dialog, setDialog] = useState<"accept" | "return" | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: "accept" | "return") {
    setBusy(true);
    try {
      const res = await fetch(key, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "return" ? { action, message } : { action }
        ),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
      // Hold the spinner until the refreshed rows are on screen.
      await Promise.all([mutate(), onChanged()]);
      if (action === "accept") {
        toast.success(
          body?.emailSent === false
            ? `${studentName} accepted — the acceptance email didn't send, so let the family know.`
            : `${studentName} accepted — the family was emailed their registration link.`
        );
      } else {
        toast.success(`${studentName}'s application returned to the family.`);
      }
      setDialog(null);
      setMessage("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const status = (() => {
    if (stage === "registration") {
      if (confirmed) return "Registration confirmed — enrolled";
      if (additionRegistrationSubmitted(packet)) {
        return "Registration submitted — ready to confirm";
      }
      return "Accepted — family is completing registration";
    }
    if (stage === "review") {
      return `Submitted ${formatTimestampUs(app.addition_submitted_at ?? 0)} — waiting on your decision`;
    }
    return returned
      ? "Returned to the family — waiting on changes"
      : "Family is still filling in the application";
  })();

  const scholarshipConfirmed = app.confirmed_scholarship === true;

  return (
    // `data-editing` keeps the Determination card at full opacity
    // while a mid-year student still needs a decision, even though
    // the family's Scholarship section is already verified.
    <div
      className="rounded-md border border-sky-200 bg-sky-50/60 px-4 py-3 space-y-3"
      {...(!confirmed ? { "data-editing": "" } : {})}
    >
      <div className="flex flex-wrap items-center gap-2">
        <UserPlus className="size-4 text-sky-700" />
        <span className="text-sm font-medium">{studentName}</span>
        <Badge variant="outline" className="border-sky-300 bg-white text-sky-800">
          Added mid-year
        </Badge>
        <span className="text-sm text-muted-foreground">{status}</span>
      </div>

      {stage === "review" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => setDialog("accept")}
            disabled={!scholarshipConfirmed || busy}
            title={
              scholarshipConfirmed
                ? undefined
                : "Confirm this student's scholarship award below first."
            }
          >
            Accept {studentName.split(" ")[0] || "student"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="bg-white"
            onClick={() => setDialog("return")}
            disabled={busy}
          >
            <Undo2 className="size-3.5 mr-1.5" />
            Return to family
          </Button>
          {!scholarshipConfirmed ? (
            <span className="text-xs text-muted-foreground">
              Set and confirm {studentName.split(" ")[0] || "this student"}&rsquo;s
              award below to unlock Accept.
            </span>
          ) : null}
        </div>
      ) : null}

      {stage === "registration" ? (
        isLoading && !loaded ? (
          <p className="text-xs text-muted-foreground">Loading registration…</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            <Step done={additionTuitionSigned(packet)} label="Tuition signed" />
            <Step
              done={additionAgreementSigned(packet)}
              label="Enrollment agreement"
            />
            <Step done={additionWaiverSigned(packet)} label="Liability waiver" />
            <Step
              done={additionRegistrationSubmitted(packet)}
              label="Packet submitted"
            />
            {!confirmed ? (
              <Link
                href={`/admin/registrations/${familyId}?yearId=${yearId}#section-registration`}
                className="text-sm text-sky-800 underline underline-offset-2"
              >
                Confirm packet on Registrations
              </Link>
            ) : null}
          </div>
        )
      ) : null}

      <AlertDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog === "accept"
                ? `Accept ${studentName}?`
                : `Return ${studentName}'s application?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog === "accept"
                ? "This opens their registration and tuition paperwork and emails and texts the family a link. The rest of the family isn't affected."
                : "The family gets an email asking for changes and can edit and resubmit the application. Add a note so they know what to fix."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dialog === "return" ? (
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What should the family change? (included in the email)"
              rows={4}
            />
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (dialog) void run(dialog);
              }}
            >
              {busy ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : null}
              {dialog === "accept" ? "Accept student" : "Return application"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {done ? (
        <CheckCircle2 className="size-4 text-green-600" />
      ) : (
        <Circle className="size-4 text-muted-foreground" />
      )}
      <span className={done ? "" : "text-muted-foreground"}>{label}</span>
    </span>
  );
}
