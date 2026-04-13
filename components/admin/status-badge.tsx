"use client";

import { cn } from "@/lib/utils";

export type ApplicationStatus =
  | "inquiry"
  | "draft"
  | "submitted"
  | "offered"
  | "accepted"
  | "registered";

const statusConfig: Record<
  ApplicationStatus,
  { label: string; className: string }
> = {
  inquiry: {
    label: "Inquiry",
    className: "bg-slate-100 text-slate-700 border-slate-200",
  },
  draft: {
    label: "Draft",
    className: "bg-yellow-50 text-yellow-700 border-yellow-200",
  },
  submitted: {
    label: "Submitted",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  offered: {
    label: "Offered",
    className: "bg-purple-50 text-purple-700 border-purple-200",
  },
  accepted: {
    label: "Accepted",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  registered: {
    label: "Registered",
    className: "bg-green-50 text-green-800 border-green-200",
  },
};

export function StatusBadge({
  status,
  className,
}: {
  status: ApplicationStatus;
  className?: string;
}) {
  const config = statusConfig[status] ?? statusConfig.draft;

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
