"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ArrowRight, Loader2, Lock, LockOpen, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFetcher } from "@/lib/admin-fetcher";
import type { LaptopGoogleStatus } from "@/app/api/admin/laptops/[id]/google/route";
import type { AdminLaptopDevice } from "@/app/api/admin/laptops/route";

/**
 * "Google Sign-in Restriction" section of the laptop detail sheet —
 * shows whether the matching enrolled ChromeOS device is locked to
 * its assigned student's school account, and runs the restrict /
 * un-restrict actions against /api/admin/laptops/[id]/google.
 *
 * Renders nothing at all when the integration env isn't configured —
 * the fleet may not be Chromebook-managed on every deploy, and a
 * permanently-disabled card would just be noise.
 */
export function LaptopGoogleCard({ laptop }: { laptop: AdminLaptopDevice }) {
  const {
    data,
    mutate,
    isLoading,
    error: loadError,
  } = useSWR<LaptopGoogleStatus>(
    `/api/admin/laptops/${laptop.id}/google`,
    adminFetcher,
    // Each load makes live Google Admin calls — don't re-fire on
    // every window focus, only on explicit mutate after an action.
    { revalidateOnFocus: false }
  );
  const [busy, setBusy] = useState(false);

  async function run(method: "POST" | "DELETE", okMessage: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/laptops/${laptop.id}/google`, {
        method,
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error ?? `Request failed (${res.status})`);
      }
      toast.success(okMessage);
      void mutate(payload as LaptopGoogleStatus, { revalidate: false });
    } catch (err) {
      console.error("Sign-in restriction update failed:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't update.");
    } finally {
      setBusy(false);
    }
  }

  if (data && !data.configured) return null;

  // Restricting always applies the policy; it only MOVES the device
  // when it isn't already in the student's org unit. The button says
  // which, so pressing it holds no surprises.
  const target = data?.targetOuPath ?? "";
  const willMove = !!target && data?.device?.orgUnitPath !== target;
  const actionLabel = data?.studentName
    ? willMove
      ? `Move to ${data.studentName}'s org unit`
      : `Restrict to ${data.studentName}`
    : "Restrict";

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Google Sign-in Restriction</p>
      {isLoading || (!data && !loadError) ? (
        <div className="flex items-center gap-2 rounded-md border px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Checking Google Admin…
        </div>
      ) : !data ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Couldn&rsquo;t check this device&rsquo;s Google status.{" "}
          {loadError instanceof Error ? loadError.message : "Please retry."}
        </div>
      ) : !data.serial ? (
        <p className="text-sm text-muted-foreground">
          Add a serial number to look this device up in Google Admin.
        </p>
      ) : data.error ? (
        /* Checked before the device branch on purpose — when the
           lookup itself fails, `device` is null too, and the
           "no matching device" copy would send admin hunting for a
           serial-number problem that doesn't exist. */
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {data.error}
        </div>
      ) : !data.device ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No enrolled ChromeOS device matches serial{" "}
          <span className="font-mono">{data.serial}</span>. Check that the
          device is enrolled in the Workspace domain and the serial is
          correct.
        </div>
      ) : (
        <div className="space-y-3 rounded-md border px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {data.restricted ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                  <Lock className="size-3" />
                  Restricted
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-border">
                  <LockOpen className="size-3" />
                  Not restricted
                </span>
              )}
              {data.device.status && data.device.status !== "ACTIVE" ? (
                <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200">
                  {data.device.status}
                </span>
              ) : null}
            </div>
            {data.restricted ? (
              <div className="flex items-center gap-2">
                {data.studentEmail &&
                !data.allowlist.includes(data.studentEmail) ? (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        "POST",
                        willMove
                          ? `Moved to ${data.studentName}'s org unit.`
                          : `Sign-in updated to ${data.studentName}.`
                      )
                    }
                  >
                    {busy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="size-3.5" />
                    )}
                    {actionLabel}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-white"
                  disabled={busy}
                  onClick={() =>
                    void run("DELETE", "Sign-in restriction removed.")
                  }
                >
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <LockOpen className="size-3.5" />
                  )}
                  Remove restriction
                </Button>
              </div>
            ) : data.studentEmail ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(
                    "POST",
                    willMove
                      ? `Moved to ${data.studentName}'s org unit.`
                      : `Sign-in restricted to ${data.studentName}.`
                  )
                }
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Lock className="size-3.5" />
                )}
                {actionLabel}
              </Button>
            ) : null}
          </div>

          {data.restricted && data.allowlist.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Allowed:{" "}
              <span className="font-mono">{data.allowlist.join(", ")}</span>
            </p>
          ) : null}
          {!data.restricted ? (
            data.studentName && !data.studentEmail ? (
              <p className="text-xs text-amber-700">
                {data.studentName} has no school Google account yet —
                generate it from their enrolled-student page, then restrict.
              </p>
            ) : !data.studentName ? (
              <p className="text-xs text-muted-foreground">
                Assign this laptop to a student to enable the restriction.
              </p>
            ) : null
          ) : null}
          {/* Where the device is, and where it's going. The move is
              the part that was previously invisible — it only showed
              up afterwards, as a changed "Google OU" line. */}
          <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
            {willMove ? (
              <>
                <p>
                  Currently in{" "}
                  <span className="font-mono">
                    {data.device.orgUnitPath || "—"}
                  </span>
                </p>
                <p className="text-foreground">
                  <ArrowRight className="mr-1 inline size-3" />
                  Moves to <span className="font-mono">{target}</span>
                </p>
              </>
            ) : (
              <p>
                Org unit:{" "}
                <span className="font-mono">
                  {data.device.orgUnitPath || "—"}
                </span>
                {target ? " — already the right one" : ""}
              </p>
            )}
            {data.device.recentUser ? (
              <p>
                Last sign-in{" "}
                <span className="font-mono">{data.device.recentUser}</span>
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
