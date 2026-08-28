"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import {
  AlertDialog,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Danger Zone card for the family overview page — permanently deletes
 * the family via `DELETE /api/admin/families/[id]`.
 *
 * The confirmation is type-the-family-name: this removes students,
 * applications, packets, billing, and the parents' login accounts in
 * one action, so a two-click modal isn't enough friction. The dialog
 * also says exactly what's kept (notes + texts) so admin isn't left
 * guessing about the audit trail.
 */
export function DeleteFamilyCard({
  familyId,
  familyName,
}: {
  familyId: number;
  familyName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const nameMatches = typed.trim() === familyName.trim();

  async function runDelete() {
    if (!nameMatches || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/families/${familyId}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? `Delete failed (${res.status})`);
      }
      const warnings: string[] = Array.isArray(body?.warnings)
        ? body.warnings
        : [];
      if (warnings.length > 0) {
        // Full list to the console; the first one in the toast so the
        // cleanup need is visible without reading logs.
        console.warn(
          `[DeleteFamilyCard] family #${familyId} deleted with warnings:`,
          warnings
        );
        toast.warning(
          `${familyName} deleted, but ${warnings.length} step${warnings.length === 1 ? "" : "s"} need attention: ${warnings[0]}`,
          { duration: 12000 }
        );
      } else {
        toast.success(
          `${familyName} permanently deleted. Notes and text history were kept.`
        );
      }
      // The overview page can't render a deleted family — land on the
      // admin dashboard.
      router.push("/admin");
    } catch (err) {
      console.error("[DeleteFamilyCard.runDelete]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't delete the family."
      );
      setDeleting(false);
    }
    // Deliberately no setDeleting(false) on success — the button stays
    // spinning until the redirect unmounts the page.
  }

  return (
    <Card className="overflow-hidden gap-0 py-0 border-red-200 bg-white">
      <CardHeader className="py-3 !pb-3 border-b border-red-200 bg-red-50/50">
        <CardTitle className="text-base text-red-800">Danger Zone</CardTitle>
      </CardHeader>
      <CardContent className="px-5 py-4 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Delete this family permanently</p>
            <p className="text-xs text-muted-foreground max-w-prose">
              Removes every student, application, registration packet,
              scholarship record, emergency contact, and billing setup, and
              deletes the parents&rsquo; login accounts. Notes and text-message
              history are kept as an audit trail. This can&rsquo;t be undone.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
            onClick={() => {
              setTyped("");
              setOpen(true);
            }}
          >
            <Trash2 className="size-3.5 mr-1.5" aria-hidden="true" />
            Delete family
          </Button>
        </div>
      </CardContent>

      <AlertDialog
        open={open}
        onOpenChange={(o) => {
          if (!o && !deleting) setOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Permanently delete {familyName}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  This deletes the family&rsquo;s students, applications,
                  registration packets, scholarship records, emergency
                  contacts, and billing, cancels any live subscription, and
                  removes the parents&rsquo; login accounts. It cannot be
                  undone.
                </p>
                <p>
                  Notes and text-message history are kept, and a note marking
                  the deletion is added to them.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="delete-family-confirm">
              Type <span className="font-semibold">{familyName}</span> to
              confirm
            </Label>
            <Input
              id="delete-family-confirm"
              value={typed}
              disabled={deleting}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={familyName}
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={!nameMatches || deleting}
              onClick={() => void runDelete()}
            >
              {deleting ? (
                <>
                  <Loader2
                    className="size-3.5 mr-1.5 animate-spin"
                    aria-hidden="true"
                  />
                  Deleting…
                </>
              ) : (
                "Delete family permanently"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
