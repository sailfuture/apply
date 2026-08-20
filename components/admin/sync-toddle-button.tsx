"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

/**
 * Admin "Sync to Toddle" — POSTs to
 * `/api/admin/students/[id]/toddle-sync`, which updates the student's
 * existing Toddle record or creates one when none matches. Rendered on
 * the enrolled student detail page's action row and the enrolled
 * roster's quick-detail sheet.
 *
 * A confirm dialog fronts the action because it writes to an external
 * system (creating a Toddle account is visible to teachers the moment
 * it lands). `gradeLevel` is the packet's placement grade — required
 * by Toddle only when the sync has to create; the server explains via
 * the error toast when it's missing.
 */
export function SyncToddleButton({
  studentId,
  studentName,
  gradeLevel,
  className,
  onSynced,
}: {
  studentId: number;
  studentName: string;
  gradeLevel?: string | null;
  className?: string;
  onSynced?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function runSync() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/students/${studentId}/toddle-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gradeLevel: gradeLevel ?? "" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? `Sync failed (${res.status})`);
      }
      const base =
        data?.action === "created"
          ? `${studentName} created in Toddle.`
          : `${studentName}'s Toddle profile updated.`;
      // Best-effort extras, each reported without failing the sync:
      // `photo` ("synced"/"none"/"failed"), `familyMembers` (per-
      // contact account+contact outcomes), `crew` (class membership).
      const parts: string[] = [base];
      if (data?.photo === "synced") parts.push("Photo pushed.");
      else if (data?.photo === "failed")
        parts.push("Photo upload failed — check server logs.");
      const members: Array<{
        name: string;
        account: string;
        contact: string;
      }> = Array.isArray(data?.familyMembers) ? data.familyMembers : [];
      if (members.length > 0) {
        const failed = members.filter(
          (m) => m.account === "failed" || m.contact === "failed"
        );
        const okCount = members.length - failed.length;
        if (okCount > 0)
          parts.push(
            `${okCount} family member${okCount === 1 ? "" : "s"} synced.`
          );
        if (failed.length > 0)
          parts.push(
            `${failed.map((m) => m.name).join(", ")} failed — see server logs.`
          );
      }
      if (typeof data?.crew === "string" && data.crew)
        parts.push(`Crew: ${data.crew}.`);
      toast.success(parts.join(" "));
      setOpen(false);
      onSynced?.();
    } catch (err) {
      console.error("[SyncToddleButton.runSync] failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't sync to Toddle."
      );
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
        className={cn("bg-white", className)}
      >
        <RefreshCw className="size-3.5 mr-1.5" />
        Sync to Toddle
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!saving) setOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sync {studentName} to Toddle?</AlertDialogTitle>
            <AlertDialogDescription>
              This looks the student up in Toddle (by our student ID,
              falling back to name) and updates their existing profile
              — or creates a new Toddle student
              {gradeLevel?.trim()
                ? ` in the ${gradeLevel.trim()} grade year group`
                : ""}{" "}
              if none exists. Name, date of birth, gender, phone,
              school email, enrollment date, home address, and the
              student photo are pushed from the record here; the
              family&rsquo;s primary and secondary contacts are added
              as Toddle family members with their contact info, and
              the student is placed in their crew&rsquo;s Toddle
              class.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(e) => {
                e.preventDefault();
                void runSync();
              }}
            >
              {saving ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5 mr-1.5" />
              )}
              Sync
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
