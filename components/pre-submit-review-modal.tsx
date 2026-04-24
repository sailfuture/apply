"use client";

import { Fragment } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertCircle } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import type { SectionCheckResult } from "@/lib/application-schemas";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: SectionCheckResult[];
  /** Base href for "Fix" jump links, e.g. `/apply/year/123`. */
  basePath: string;
  /** Called when the user confirms submission. */
  onConfirm: () => void | Promise<void>;
  submitting?: boolean;
}

const SECTION_LABELS: Record<string, string> = {
  family: "Family Information",
  students: "Student Details",
  financial_aid: "Financial Aid",
};

const SECTION_HREFS: Record<string, string> = {
  family: "/family",
  students: "/students",
  financial_aid: "/scholarship",
};

/**
 * Review modal shown when a parent clicks Submit. Rendered as a grouped table:
 * one header row per section (with the Fix button inline), then one row per
 * missing requirement beneath it. Complete sections collapse to a single row.
 */
export function PreSubmitReviewModal({
  open,
  onOpenChange,
  sections,
  basePath,
  onConfirm,
  submitting,
}: Props) {
  const router = useRouter();
  const allReady = sections.every((s) => s.complete);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {allReady ? "Ready to submit?" : "A few items need your attention"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {allReady
              ? "Once you submit, you won't be able to edit your application without contacting the school."
              : "Review the items still needed below. Use Fix to jump to the section."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex-1 overflow-y-auto rounded-md border">
          <Table className="text-xs table-fixed w-full">
            <TableBody>
              {sections.map((s) => {
                const label = SECTION_LABELS[s.section] ?? s.section;
                const href = basePath + (SECTION_HREFS[s.section] ?? "");
                const completedCount = Math.max(0, s.total - s.missing.length);

                return (
                  <Fragment key={s.section}>
                    {/* Section header row — spans the whole table with the
                        section title, count, status, and (if incomplete) Fix. */}
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableCell className="py-2 px-3" colSpan={2}>
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <div className="flex items-baseline gap-2 min-w-0">
                            <span className="text-xs font-semibold truncate">
                              {label}
                            </span>
                            <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                              {completedCount}/{s.total}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {s.complete ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                                <CheckCircle2 className="size-3.5 text-green-600 dark:text-green-500" />
                                Complete
                              </span>
                            ) : (
                              <>
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                                  <AlertCircle className="size-3.5 text-red-600 dark:text-red-500" />
                                  {s.missing.length} left
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    onOpenChange(false);
                                    router.push(href);
                                  }}
                                  className="text-xs font-medium text-primary underline underline-offset-2 hover:no-underline"
                                >
                                  Fix →
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>

                    {/* Section body rows — one per missing item, or a single
                        "All required fields filled" line when complete. */}
                    {s.complete ? (
                      <TableRow>
                        <TableCell
                          className="py-1.5 px-3 text-[11px] text-muted-foreground"
                          colSpan={2}
                        >
                          All required fields filled
                        </TableCell>
                      </TableRow>
                    ) : (
                      s.missing.map((req) => (
                        <TableRow key={req.key}>
                          <TableCell
                            className="py-1.5 px-3 text-[11px] text-muted-foreground truncate"
                            colSpan={2}
                            title={req.label}
                          >
                            {req.label}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>
            {allReady ? "Cancel" : "Close"}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!allReady || submitting}
            onClick={(e) => {
              if (!allReady) {
                e.preventDefault();
                return;
              }
              void onConfirm();
            }}
          >
            {submitting ? "Submitting…" : "Submit Application"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
