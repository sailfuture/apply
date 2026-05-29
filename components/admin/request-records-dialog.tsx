"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Records-request compose dialog. Shared by the admin enrolled-student
 * page and the family registration packet section. Pre-fills the letter
 * fields from whatever the calling surface knows, lets admin type the
 * previous school's email + tweak any field, shows a live PDF preview,
 * and on Send fires `/api/admin/records-request` which emails the PDF
 * from admissions@sailfuture.org (CC admissions@).
 *
 * The letter wording is fixed server-side; only these variable fields
 * are editable.
 */

export interface RequestRecordsDefaults {
  studentName?: string;
  dateOfBirth?: string;
  previousSchool?: string;
  effectiveDate?: string;
  academicYear?: string;
}

interface Props {
  defaults: RequestRecordsDefaults;
  /** Family + year scope — passed through so the send is audit-logged
   *  against the right family on the Sent-emails card. */
  familyId?: number;
  yearId?: number;
  /** Trigger button label + styling, so each surface can match its row. */
  label?: string;
  className?: string;
  disabled?: boolean;
}

interface Fields {
  recipientEmail: string;
  studentName: string;
  dateOfBirth: string;
  previousSchool: string;
  effectiveDate: string;
  academicYear: string;
}

function seedFields(defaults: RequestRecordsDefaults): Fields {
  return {
    recipientEmail: "",
    studentName: defaults.studentName ?? "",
    dateOfBirth: defaults.dateOfBirth ?? "",
    previousSchool: defaults.previousSchool ?? "",
    effectiveDate: defaults.effectiveDate ?? "",
    academicYear: defaults.academicYear ?? "",
  };
}

export function RequestRecordsDialog({
  defaults,
  familyId,
  yearId,
  label = "Request records",
  className,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Fields>(() => seedFields(defaults));
  const [sending, setSending] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // True from the moment a (re)generation fetch fires until the freshly
  // built PDF has actually finished loading in the iframe (its onLoad
  // clears it). Drives the skeleton overlay so the preview never flashes
  // blank while swapping blob URLs.
  const [isUpdating, setIsUpdating] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Re-seed each time the dialog opens so it reflects the latest row
  // data and clears any recipient typed on a previous open.
  useEffect(() => {
    if (open) setFields(seedFields(defaults));
    // defaults is a fresh object each render; keying off `open` alone
    // avoids re-seeding (and stomping edits) on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounced live preview — regenerates the PDF ~700ms after the last
  // edit to a letter field while the dialog is open. Recipient email is
  // intentionally NOT a dependency (it isn't in the letter).
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    // Safety net for the rare case the iframe's onLoad never fires —
    // clears the skeleton after the PDF has surely rendered. Scoped to
    // this effect run so a newer update cancels it (in the cleanup)
    // before it could hide a later, still-loading PDF.
    let settleGuard: ReturnType<typeof setTimeout> | undefined;
    const handle = setTimeout(async () => {
      // Raise the skeleton now — at fetch time, not on keystroke — so it
      // doesn't flicker while the user is still typing through the
      // debounce window (the prior PDF stays visible until they pause).
      setIsUpdating(true);
      setPreviewError(null);
      try {
        const res = await fetch("/api/admin/records-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            mode: "preview",
            studentName: fields.studentName,
            dateOfBirth: fields.dateOfBirth,
            previousSchool: fields.previousSchool,
            effectiveDate: fields.effectiveDate,
            academicYear: fields.academicYear,
          }),
        });
        if (!res.ok) throw new Error(`Preview failed (${res.status})`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        // Keep isUpdating true: the old PDF stays under the skeleton
        // until the iframe's onLoad (or this guard) confirms the new one
        // is painted — that's what prevents the blank flash on swap.
        settleGuard = setTimeout(() => setIsUpdating(false), 3000);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setPreviewError(
          err instanceof Error ? err.message : "Couldn't render preview."
        );
        setIsUpdating(false);
      }
    }, 700);
    return () => {
      controller.abort();
      clearTimeout(handle);
      if (settleGuard) clearTimeout(settleGuard);
    };
  }, [
    open,
    fields.studentName,
    fields.dateOfBirth,
    fields.previousSchool,
    fields.effectiveDate,
    fields.academicYear,
  ]);

  // Release the object URL when the dialog unmounts.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  function set<K extends keyof Fields>(key: K, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  const requiredFilled = Boolean(
    fields.recipientEmail.trim().includes("@") &&
      fields.studentName.trim() &&
      fields.dateOfBirth.trim() &&
      fields.previousSchool.trim() &&
      fields.effectiveDate.trim() &&
      fields.academicYear.trim()
  );

  async function handleSend() {
    setSending(true);
    try {
      const res = await fetch("/api/admin/records-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "send",
          recipientEmail: fields.recipientEmail.trim(),
          studentName: fields.studentName,
          dateOfBirth: fields.dateOfBirth,
          previousSchool: fields.previousSchool,
          effectiveDate: fields.effectiveDate,
          academicYear: fields.academicYear,
          familyId,
          yearId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data?.error ?? `Send failed (${res.status})`);
      }
      toast.success(
        `Records request sent to ${fields.recipientEmail.trim()}.`
      );
      setOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Couldn't send the records request."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("bg-white", className)}
          disabled={disabled}
        >
          <FileText className="size-3.5 mr-1.5" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request student records</DialogTitle>
          <DialogDescription>
            Emails a records-request letter from admissions@sailfuture.org to
            the previous school with the PDF attached (CC admissions@). Edit
            any field before sending.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="rr-recipient">Previous school email</Label>
            <Input
              id="rr-recipient"
              type="email"
              autoComplete="off"
              placeholder="registrar@previousschool.org"
              value={fields.recipientEmail}
              onChange={(e) => set("recipientEmail", e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="rr-student">Student name</Label>
              <Input
                id="rr-student"
                value={fields.studentName}
                onChange={(e) => set("studentName", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rr-dob">Date of birth</Label>
              <Input
                id="rr-dob"
                placeholder="MM/DD/YYYY"
                value={fields.dateOfBirth}
                onChange={(e) => set("dateOfBirth", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rr-school">Previous school name</Label>
              <Input
                id="rr-school"
                value={fields.previousSchool}
                onChange={(e) => set("previousSchool", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rr-effective">Effective date</Label>
              <Input
                id="rr-effective"
                placeholder="MM/DD/YYYY"
                value={fields.effectiveDate}
                onChange={(e) => set("effectiveDate", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rr-year">Academic year</Label>
              <Input
                id="rr-year"
                placeholder="2025"
                value={fields.academicYear}
                onChange={(e) => set("academicYear", e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Letter preview</Label>
              {isUpdating ? (
                <span className="inline-flex items-center text-xs text-muted-foreground">
                  <Loader2 className="size-3 mr-1 animate-spin" />
                  Updating…
                </span>
              ) : null}
            </div>
            <div className="relative h-[420px] overflow-hidden rounded-md border bg-white">
              {/* The iframe stays mounted across regenerations so the
                  previously rendered letter stays visible underneath the
                  skeleton until the new PDF actually paints (onLoad) —
                  this is what avoids the blank flash on blob-URL swap. */}
              {previewUrl ? (
                <iframe
                  src={previewUrl}
                  title="Records request preview"
                  className="h-full w-full"
                  onLoad={() => setIsUpdating(false)}
                />
              ) : null}
              {previewError ? (
                <div className="absolute inset-0 flex items-center justify-center bg-white px-4 text-center text-sm text-muted-foreground">
                  {previewError}
                </div>
              ) : isUpdating || !previewUrl ? (
                <PreviewSkeleton />
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={sending}
          >
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={sending || !requiredFilled}>
            {sending ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Send className="mr-1.5 size-4" />
            )}
            Send to school
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Letter-shaped shimmer shown over the preview area while a PDF is
 * generating. Opaque (bg-white) so it fully hides the iframe behind it,
 * and roughly mirrors the letter's layout — letterhead, rule, date,
 * paragraphs, the labeled block, and the requested-records bullets — so
 * the loading state reads as "a letter is rendering" rather than a
 * generic spinner.
 */
function PreviewSkeleton() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-white p-6">
      <div className="mx-auto flex h-full max-w-md flex-col gap-3">
        {/* Letterhead — logo + name/address */}
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-md" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-2.5 w-24" />
          </div>
        </div>
        <Skeleton className="h-px w-full" />
        {/* Date */}
        <Skeleton className="h-2.5 w-28" />
        {/* Opening paragraphs */}
        <div className="space-y-2 pt-1">
          <Skeleton className="h-2.5 w-32" />
          <Skeleton className="h-2.5 w-full" />
          <Skeleton className="h-2.5 w-full" />
          <Skeleton className="h-2.5 w-4/5" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-2.5 w-full" />
          <Skeleton className="h-2.5 w-11/12" />
        </div>
        {/* Labeled block (name / DOB / previous school) */}
        <div className="space-y-2">
          <Skeleton className="h-2.5 w-48" />
          <Skeleton className="h-2.5 w-40" />
          <Skeleton className="h-2.5 w-56" />
        </div>
        {/* Requested-records bullets */}
        <div className="space-y-2">
          <Skeleton className="h-2.5 w-44" />
          <Skeleton className="h-2.5 w-3/4" />
          <Skeleton className="h-2.5 w-2/3" />
          <Skeleton className="h-2.5 w-3/5" />
        </div>
      </div>
    </div>
  );
}
