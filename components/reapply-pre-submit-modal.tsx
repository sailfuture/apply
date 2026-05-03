"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { useReapplyFamilyProgress } from "@/hooks/use-reapply-family-progress";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  yearId: number;
}

const SECTIONS: { key: keyof Sections; label: string; href: string }[] = [
  { key: "isFamilyDetails", label: "Family Details", href: "family" },
  { key: "isStudentDetails", label: "Student Details", href: "students" },
  { key: "isScholarship", label: "Opportunity Scholarship", href: "scholarship" },
  { key: "isTransportation", label: "Transportation", href: "transportation" },
];

interface Sections {
  isFamilyDetails: boolean;
  isStudentDetails: boolean;
  isScholarship: boolean;
  isTransportation: boolean;
}

/**
 * Pre-submit review modal for the re-application flow. Reads the four
 * section bools off `reapply_family_progress` and gates the Submit button
 * until each is complete. Same UX/styling as the application-phase modal.
 */
export function ReapplyPreSubmitModal({ open, onOpenChange, yearId }: Props) {
  const router = useRouter();
  const { progress, submit } = useReapplyFamilyProgress(yearId);
  const [submitting, setSubmitting] = useState(false);

  const sections = useMemo(() => {
    return SECTIONS.map((s) => ({
      ...s,
      complete: !!progress?.[s.key],
    }));
  }, [progress]);
  const allReady = sections.every((s) => s.complete);

  async function handleConfirm() {
    if (!allReady || submitting) return;
    setSubmitting(true);
    try {
      await submit();
      onOpenChange(false);
      toast.success("Re-application submitted successfully.");
      router.push("/dashboard");
    } catch {
      toast.error("Failed to submit re-application. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {allReady ? "Ready to submit?" : "A few sections still need attention"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {allReady
              ? "Once you submit, your re-application will be reviewed by the admissions team."
              : "Each section must be marked complete before you can submit. Use Fix to jump to the section."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex-1 overflow-y-auto rounded-md border">
          <Table className="text-sm table-fixed w-full">
            <TableBody>
              {sections.map((s) => (
                <TableRow key={s.key}>
                  <TableCell className="py-3 px-3">
                    {/* Section label + inline "Fix →" so the jump link
                        sits next to the name it fixes. */}
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{s.label}</span>
                      {!s.complete ? (
                        <button
                          type="button"
                          onClick={() => {
                            onOpenChange(false);
                            router.push(`/reapply/year/${yearId}/${s.href}`);
                          }}
                          className="text-xs font-medium text-primary underline underline-offset-2 hover:no-underline"
                        >
                          Fix →
                        </button>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="py-3 px-3 text-right">
                    {s.complete ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <CheckCircle2 className="size-4 text-green-600 dark:text-green-500" />
                        Complete
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <AlertCircle className="size-4 text-red-600 dark:text-red-500" />
                        Not yet complete
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

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
              void handleConfirm();
            }}
          >
            {submitting ? "Submitting…" : "Submit Re-Application"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
