import type { BillingRow } from "@/app/api/admin/billing/route";

/**
 * Build and download an .xlsx of the billing list — every paying
 * family (Stripe subscription on file) for the selected year with
 * their monthly payment, full-year tuition total, paid-to-date, and
 * outstanding balance.
 *
 * Browser-only: `exceljs` is dynamically imported so its weight only
 * ships when admin actually exports (same pattern as
 * `summer-camp-export.ts` / `enrolled-export.ts`). Money is written as
 * real numbers with a currency format so staff can sum / pivot in
 * Excel, and a bold TOTAL row closes the sheet with the program-wide
 * monthly and annual tuition.
 */

interface Col {
  label: string;
  width: number;
  /** Money columns get a currency number format + roll into the
   *  totals row. */
  money?: boolean;
  value: (r: BillingRow) => string | number | null;
}

const COLUMNS: Col[] = [
  { label: "Family", width: 28, value: (r) => r.family_name },
  { label: "Primary Contact", width: 24, value: (r) => r.primary_name || "" },
  { label: "Email", width: 30, value: (r) => r.primary_email || "" },
  {
    label: "Monthly Payment",
    width: 16,
    money: true,
    value: (r) => r.monthly_tuition,
  },
  {
    label: "Total Tuition (Year)",
    width: 18,
    money: true,
    value: (r) => r.year_total,
  },
  {
    label: "Paid to Date",
    width: 16,
    money: true,
    value: (r) => r.paid_cents / 100,
  },
  {
    label: "Outstanding",
    width: 16,
    money: true,
    value: (r) => r.outstanding_cents / 100,
  },
  { label: "Invoices Issued", width: 14, value: (r) => r.invoices_issued },
];

const MONEY_FMT = '"$"#,##0.00';

export async function exportBillingXlsx(
  rows: BillingRow[],
  opts?: { yearLabel?: string }
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SailFuture Apply";
  const sheet = workbook.addWorksheet("Paying Families");

  sheet.columns = COLUMNS.map((c) => ({
    header: c.label,
    key: c.label,
    width: c.width,
  }));

  for (const row of rows) {
    sheet.addRow(
      Object.fromEntries(
        COLUMNS.map((c) => {
          const v = c.value(row);
          return [c.label, v == null ? "" : v];
        })
      )
    );
  }

  // Currency format on the money columns so Excel treats them as
  // summable numbers, not text.
  COLUMNS.forEach((c, i) => {
    if (c.money) sheet.getColumn(i + 1).numFmt = MONEY_FMT;
  });

  // Bold + frozen header with an autofilter so staff can sort/filter
  // the roster in Excel immediately.
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COLUMNS.length },
  };

  // Grand totals — program-wide monthly + annual tuition (and paid /
  // outstanding) at a glance.
  if (rows.length > 0) {
    const totals: Record<string, string | number> = {
      [COLUMNS[0].label]: "TOTAL",
    };
    for (const c of COLUMNS) {
      if (!c.money) continue;
      totals[c.label] = rows.reduce((acc, r) => {
        const v = c.value(r);
        return acc + (typeof v === "number" ? v : 0);
      }, 0);
    }
    const totalRow = sheet.addRow(totals);
    totalRow.font = { bold: true };
    totalRow.border = { top: { style: "thin" } };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  const yearPart = opts?.yearLabel
    ? `-${opts.yearLabel.replace(/[^\w-]+/g, "-")}`
    : "";
  anchor.href = url;
  anchor.download = `paying-families${yearPart}-${stamp}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so the click can kick off the download
  // before the object URL is invalidated.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
