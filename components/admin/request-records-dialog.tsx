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
  const [previewLoading, setPreviewLoading] = useState(false);
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
    const handle = setTimeout(async () => {
      setPreviewLoading(true);
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
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        setPreviewError(
          err instanceof Error ? err.message : "Couldn't render preview."
        );
      } finally {
        setPreviewLoading(false);
      }
    }, 700);
    return () => {
      controller.abort();
      clearTimeout(handle);
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
              {previewLoading ? (
                <span className="inline-flex items-center text-xs text-muted-foreground">
                  <Loader2 className="size-3 mr-1 animate-spin" />
                  Updating…
                </span>
              ) : null}
            </div>
            <div className="h-[420px] overflow-hidden rounded-md border bg-muted/20">
              {previewError ? (
                <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                  {previewError}
                </div>
              ) : previewUrl ? (
                <iframe
                  src={previewUrl}
                  title="Records request preview"
                  className="h-full w-full"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Generating preview…
                </div>
              )}
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
