"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import type { LeadNoteScope } from "@/components/admin/inquiry-notes";

export function nurturePauseKey(scope: LeadNoteScope): string {
  return `/api/admin/nurture/pause?source=${scope.source}&id=${scope.id}`;
}

/** SWR keys a pause/resume changes: the lead's timeline (the switch
 *  writes a note there) and the Follow-ups preview. */
function isPauseAffectedKey(key: unknown): boolean {
  return (
    typeof key === "string" &&
    (key.startsWith("/api/admin/notes") ||
      key.startsWith("/api/admin/lead-activity") ||
      key.startsWith("/api/admin/nurture"))
  );
}

/**
 * Per-lead switch for the automated follow-up texts (Recruitment →
 * Follow-ups). A pressed button like "Followed up" beside it: filled
 * means paused. Each flip is logged as a note on the lead's timeline.
 */
export function NurturePauseButton({
  scope,
  onChanged,
}: {
  scope: LeadNoteScope;
  onChanged?: () => void;
}) {
  const key = nurturePauseKey(scope);
  const { data, isLoading } = useSWR<{ paused: boolean }>(key, adminFetcher);
  const { mutate } = useSWRConfig();
  const [saving, setSaving] = useState(false);
  const paused = data?.paused ?? false;

  async function toggle() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/nurture/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: scope.source,
          id: scope.id,
          paused: !paused,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't save");
      // Hold the spinner until the switch AND the timeline note have
      // actually re-rendered, not just until the POST returned.
      await Promise.all([mutate(key), mutate(isPauseAffectedKey)]);
      onChanged?.();
      toast.success(
        paused
          ? "Automated texts are back on for this lead."
          : "Automated texts paused for this lead."
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Button
      type="button"
      variant={paused ? "default" : "outline"}
      size="sm"
      aria-pressed={paused}
      disabled={saving || isLoading}
      className={cn("h-8", !paused && "bg-white")}
      title={
        paused
          ? "Automated follow-up texts are paused for this lead — click to turn them back on"
          : "Pause the automated follow-up texts for this lead"
      }
      onClick={() => void toggle()}
    >
      {saving ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : paused ? (
        <BellOff className="size-3.5" />
      ) : (
        <Bell className="size-3.5" />
      )}
      {paused ? "Auto-texts paused" : "Auto-texts on"}
    </Button>
  );
}
