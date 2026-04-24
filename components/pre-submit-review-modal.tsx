"use client";

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

/** Section completion status derived from the
 *  `registration_family_application_progress` row. */
export type ProgressSectionKey =
  | "family"
  | "students"
  | "financial_aid"
  | "testing";

export interface SectionStatus {
  section: ProgressSectionKey;
  complete: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: SectionStatus[];
  /** Base href for "Fix" jump links, e.g. `/apply/year/123`. */
  basePath: string;
  /** Called when the user confirms submission. */
  onConfirm: () => void | Promise<void>;
  submitting?: boolean;
}

const SECTION_LABELS: Record<ProgressSectionKey, string> = {
  family: "Family Information",
  students: "Student Details",
  financial_aid: "Financial Aid",
  testing: "Initial Testing",
};

const SECTION_HREFS: Record<ProgressSectionKey, string> = {
  family: "/family",
  students: "/students",
  financial_aid: "/scholarship",
  testing: "/nwea",
};

/**
 * Review modal shown when a parent clicks Submit. Reads the section-level
 * completion booleans from `registration_family_application_progress`. Each
 * row shows a section label + status; incomplete sections get a Fix link that
 * jumps to the corresponding step page.
 *
 * This modal intentionally does NOT enumerate individual missing fields —
 * specifics are the section page's job. Here we only surface the high-level
 * question: "Is the section marked complete yet?"
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
  const allReady = sections.length > 0 && sections.every((s) => s.complete);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {allReady ? "Ready to submit?" : "A few sections still need attention"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {allReady
              ? "Once you submit, you won't be able to edit your application without contacting the school."
              : "Each section below must be marked complete before you can submit. Use Fix to jump to the section."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex-1 overflow-y-auto rounded-md border">
          <Table className="text-sm table-fixed w-full">
            <TableBody>
              {sections.map((s) => {
                const label = SECTION_LABELS[s.section] ?? s.section;
                const href = basePath + (SECTION_HREFS[s.section] ?? "");

                return (
                  <TableRow key={s.section}>
                    <TableCell className="py-3 px-3">
                      <span className="font-medium">{label}</span>
                    </TableCell>
                    <TableCell className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {s.complete ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <CheckCircle2 className="size-4 text-green-600 dark:text-green-500" />
                            Complete
                          </span>
                        ) : (
                          <>
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                              <AlertCircle className="size-4 text-red-600 dark:text-red-500" />
                              Not yet complete
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
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Split the footer actions 50/50 on all breakpoints. Default
            AlertDialogFooter stacks on mobile and right-aligns on sm+; we
            override with a simple 2-col grid so Cancel/Submit always share
            the full width evenly. */}
        <AlertDialogFooter className="grid grid-cols-2 gap-2 sm:flex-row sm:justify-stretch">
          <AlertDialogCancel disabled={submitting} className="w-full">
            {allReady ? "Cancel" : "Close"}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!allReady || submitting}
            className="w-full"
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
