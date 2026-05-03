"use client";

import { cn } from "@/lib/utils";
import {
  STATUS_META,
  type ApplicationStatus,
} from "@/lib/application-status";

// Re-export the canonical type so existing call sites that import
// `ApplicationStatus` from this file keep working.
export type { ApplicationStatus };

/**
 * Pill that renders any application status. Visuals are driven by the
 * shared `STATUS_META` table so admin tabs, drawers, and tables all
 * stay in lockstep.
 */
export function StatusBadge({
  status,
  className,
}: {
  status: ApplicationStatus;
  className?: string;
}) {
  const config = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}
