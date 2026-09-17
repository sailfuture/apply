"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Downloads a family's full Opportunity Scholarship for one year as the
 * "Award Summary" PDF built by `exportFamilyPDF` (`lib/family-pdf.ts`):
 * the financial aid application, contributing members, benefits,
 * clickable document links, houses / vehicles / debts, the advocacy
 * letter + signature, and the award determination with its pay matrix.
 *
 * Rendered on the family detail page header, the enrolled student
 * detail page's action row, and the enrolled roster's quick-detail
 * sheet. The PDF is per (family, year) and fetches everything it needs
 * itself, so a caller only has to know those two ids.
 *
 * The generator is imported inside the click handler because it pulls
 * in `jspdf` + `jspdf-autotable` (~150KB); pages that render this
 * button only pay for them when an admin actually exports.
 */
export function ExportScholarshipPdfButton({
  familyId,
  yearId,
  label = "Export PDF",
  className,
}: {
  familyId: number;
  yearId: number;
  /** Button text. The family page keeps the short default; student-
   *  scoped pages say "Scholarship" so it isn't read as a PDF of the
   *  student. */
  label?: string;
  className?: string;
}) {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const { exportFamilyPDF } = await import("@/lib/family-pdf");
      await exportFamilyPDF({ familyId, yearId });
    } catch (err) {
      console.error("[ExportScholarshipPdfButton] export failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't generate PDF."
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={exporting}
      className={cn("bg-white", className)}
      title="Download a printable PDF of this family's full Opportunity Scholarship application — financial aid details, document links, and award determination"
    >
      {exporting ? (
        <Loader2 className="size-3.5 mr-1.5 animate-spin" />
      ) : (
        <FileText className="size-3.5 mr-1.5" />
      )}
      {exporting ? "Generating…" : label}
    </Button>
  );
}
