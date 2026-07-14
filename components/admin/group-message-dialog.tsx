"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Loader2, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { adminFetcher } from "@/lib/admin-fetcher";
import type { Stage } from "@/lib/sms/audience";

interface SchoolYear {
  id: number;
  year_name: string;
  isActive?: boolean;
  isPast?: boolean;
}

interface Preview {
  matched: number;
  sendable: number;
  optedOut: number;
  noPhone: number;
}

const STAGE_OPTIONS: { value: Stage; label: string }[] = [
  { value: "applicant", label: "Applicants" },
  { value: "accepted", label: "Accepted" },
  { value: "enrolled", label: "Enrolled" },
];

export function GroupMessageDialog({ onSent }: { onSent?: () => void }) {
  const [open, setOpen] = useState(false);
  const { data: yearsData } = useSWR(
    open ? "/api/admin/school-years" : null,
    adminFetcher
  );
  const years = useMemo<SchoolYear[]>(
    () => (Array.isArray(yearsData) ? yearsData : []),
    [yearsData]
  );

  const [yearId, setYearId] = useState<string>("");
  const [stages, setStages] = useState<Stage[]>([]);
  const [onlyOutstanding, setOnlyOutstanding] = useState(false);
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  // Idempotency key for the blast — minted per compose session so a
  // retry after a timeout resumes the SAME blast server-side (families
  // already texted are skipped) instead of double-texting.
  const [blastId, setBlastId] = useState("");

  useEffect(() => {
    if (open) setBlastId(crypto.randomUUID());
  }, [open]);

  // Default to the active year once the list loads.
  useEffect(() => {
    if (!yearId && years.length) {
      const active = years.find((y) => y.isActive) ?? years[0];
      if (active) setYearId(String(active.id));
    }
  }, [years, yearId]);

  // Auto-preview recipient counts whenever the filters change (dry run,
  // no body needed).
  useEffect(() => {
    if (!open || !yearId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    fetch("/api/admin/messages/group", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        yearId: Number(yearId),
        stages,
        onlyOutstanding,
        dryRun: true,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) {
          setPreview({
            matched: d.matched,
            sendable: d.sendable,
            optedOut: d.optedOut,
            noPhone: d.noPhone,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, yearId, stages, onlyOutstanding]);

  const segments = body.length === 0 ? 0 : Math.ceil(body.length / 160);
  const sendable = preview?.sendable ?? 0;
  // Send is gated on a SETTLED preview (`preview !== null && !previewing`)
  // so the "Send to N" count on the button always reflects the filters
  // that will actually be posted — never a stale count from the previous
  // filter combination while a new dry run is still in flight.
  const canSend =
    Boolean(yearId) &&
    body.trim().length > 0 &&
    preview !== null &&
    !previewing &&
    sendable > 0 &&
    !sending;

  // Every filter mutation clears the preview in the same render commit,
  // closing the race where the old audience count stays clickable while
  // the new dry run resolves.
  function changeYear(v: string) {
    setPreview(null);
    setYearId(v);
  }
  function toggleStage(s: Stage) {
    setPreview(null);
    setStages((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }
  function changeOnlyOutstanding(v: boolean) {
    setPreview(null);
    setOnlyOutstanding(v);
  }

  async function send() {
    if (!canSend) return;
    setSending(true);
    try {
      const res = await fetch("/api/admin/messages/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yearId: Number(yearId),
          stages,
          onlyOutstanding,
          body: body.trim(),
          blastId,
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error ?? `Send failed (${res.status})`);
      toast.success(
        `Group text sent to ${d.sent} ${
          d.sent === 1 ? "family" : "families"
        }${d.failed ? ` (${d.failed} failed)` : ""}.`
      );
      setBody("");
      setOpen(false);
      onSent?.();
    } catch (err) {
      console.error("Group send failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't send group text."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Users className="size-4 mr-1.5" />
        New group message
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New group message</DialogTitle>
            <DialogDescription>
              Text a filtered set of families. Opted-out families and those
              without a mobile number are skipped automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>School year</Label>
              <Select value={yearId} onValueChange={changeYear}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a year" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y.id} value={String(y.id)}>
                      {y.year_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>
                Stage{" "}
                <span className="font-normal text-muted-foreground">
                  (leave all off for every stage)
                </span>
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {STAGE_OPTIONS.map((s) => {
                  const on = stages.includes(s.value);
                  return (
                    <button
                      key={s.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleStage(s.value)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        on
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-white text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                      )}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="only-outstanding"
                checked={onlyOutstanding}
                onCheckedChange={changeOnlyOutstanding}
              />
              <Label htmlFor="only-outstanding" className="font-normal">
                Only families with an outstanding balance
              </Label>
            </div>

            <div className="space-y-1.5">
              <Label>Message</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                placeholder="Type the text every selected family will receive…"
              />
              <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                <span>
                  {previewing
                    ? "Counting recipients…"
                    : preview
                      ? `${preview.matched} match · ${preview.sendable} will be texted` +
                        (preview.optedOut ? ` · ${preview.optedOut} opted out` : "") +
                        (preview.noPhone ? ` · ${preview.noPhone} no number` : "")
                      : "Pick a year to preview recipients."}
                </span>
                <span className="shrink-0 tabular-nums">
                  {body.length} chars{segments ? ` · ${segments} seg` : ""}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void send()} disabled={!canSend}>
              {sending ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Sending
                </>
              ) : (
                <>
                  <Send className="size-3.5 mr-1.5" />
                  {/* Only show a count when it's settled — while the dry
                      run is in flight the number would describe the
                      PREVIOUS filters. */}
                  {preview && !previewing ? `Send to ${sendable}` : "Send"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
