"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardBreadcrumb } from "@/components/dashboard-breadcrumb";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface Props {
  /** Where the Back button + clicking the breadcrumb root sends the parent. */
  backHref: string;
  /** Custom Back label — defaults to "Back to Dashboard". */
  backLabel?: string;
  /** Breadcrumb trail rendered above the title. */
  breadcrumb: BreadcrumbItem[];
  /** Main heading. */
  title: string;
  /** Optional subhead — rendered as a paragraph below the title. */
  subtitle?: React.ReactNode;
  /** Optional content (year picker, action button) shown right-aligned next
   *  to the title block on wider screens. */
  rightSlot?: React.ReactNode;
}

/**
 * Consistent header used across every dashboard sub-page (Tuition,
 * Volunteer Hours, Student detail). Replaces the old sticky DashboardNav
 * tabs — the parent navigates via the dashboard cards going in and the
 * back button coming out, so every sub-page wears the same chrome.
 *
 * Layout:
 *   Breadcrumb · Year · Section            [optional rightSlot]
 *   Title (h1)
 *   Subtitle paragraph
 *   [← Back to Dashboard]   (white-bg outline button)
 *   ─────────────────────── (border-b divider)
 */
export function DashboardPageHeader({
  backHref,
  backLabel = "Back to Dashboard",
  breadcrumb,
  title,
  subtitle,
  rightSlot,
}: Props) {
  return (
    <div className="border-b pb-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <DashboardBreadcrumb items={breadcrumb} />
          <h1 className="text-2xl font-semibold mt-2">{title}</h1>
          {subtitle ? (
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          ) : null}
        </div>
        {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
      </div>
      <Button
        asChild
        variant="outline"
        size="sm"
        className="bg-white self-start"
      >
        <Link href={backHref}>
          <ChevronLeft className="size-4 mr-1.5" />
          {backLabel}
        </Link>
      </Button>
    </div>
  );
}
