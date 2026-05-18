/**
 * Family acceptance PDF export — builds a continuous-flow PDF summary
 * of a family's financial aid application, scholarship determination,
 * pay-matrix bracket, and tuition receipt entirely client-side via
 * jsPDF + jspdf-autotable. Triggered by the "Export PDF" button on
 * the Scholarship Determination card; downloads the file directly
 * (no print dialog).
 *
 * Why client-side: keeps the runtime simple — no Puppeteer / headless
 * Chrome dependency on the server, no extra route round-trip — and
 * means the PDF reflects whatever's currently in the admin's SWR
 * cache. Bundle cost is bearable because the import is dynamic; the
 * jsPDF/autotable code only loads when admin actually clicks Export.
 *
 * Layout — no manual `addPage()` calls anywhere. The document flows
 * as one continuous report; jsPDF-autotable handles automatic page
 * breaks when a table overflows the current page. Sections render
 * back-to-back with a small gap, which keeps short reports compact
 * (no half-empty pages) and longer reports readable.
 */

import type {
  XanoApplicationByFamily,
  XanoFamilyPayment,
  XanoScholarship,
  XanoScholarshipBenefit,
  XanoScholarshipContributingMember,
  XanoScholarshipHome,
  XanoScholarshipVehicle,
  XanoSchoolYear,
  XanoStudentRegistration,
} from "@/lib/xano";
import { sumFamilyBillingTotals } from "@/lib/per-student-billing";
import type jsPDF from "jspdf";

interface ExportInput {
  familyId: number;
  yearId: number;
}

interface ScholarshipDetailsPayload {
  scholarship: XanoScholarship;
  homes: XanoScholarshipHome[];
  vehicles: XanoScholarshipVehicle[];
  contributing_members: XanoScholarshipContributingMember[];
  benefits: XanoScholarshipBenefit[];
}

/** Bracket cell shape returned by the matrix endpoints. Cells from
 *  the household-size × income matrix carry `household_size` +
 *  `income_min/max` + `tuition_percentage`. Cells from the high-net-
 *  assets matrix carry `net_asset_min/max` + `percentage_of_total_tuition`.
 *  Both endpoints return the same TS shape (every field optional);
 *  consumers inspect whichever fields apply to the path they're on. */
interface AwardBracketCell {
  household_size?: number;
  income_min?: number;
  income_max?: number | null;
  net_asset_min?: number;
  net_asset_max?: number | null;
  tuition_percentage?: number;
  percentage_of_total_tuition?: number;
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
function fmt$(v: number | null | undefined): string {
  if (v == null) return "—";
  return currency.format(v);
}
function fmtMaybe(v: string | null | undefined): string {
  if (!v) return "—";
  const t = v.trim();
  return t.length > 0 ? t : "—";
}
function bracketLabel(
  min: number,
  max: number | null | undefined
): string {
  if (max === null || max === undefined) return `${fmt$(min)} +`;
  return `${fmt$(min)} – ${fmt$(max)}`;
}

/** Shared autoTable cell-padding override — applied to every table
 *  in the document so a single tweak adjusts the whole report's
 *  density. 3/5/3/5 (vs. autotable's 5/5/5/5 default) shaves enough
 *  vertical room that the cover + Financial Aid sections fit on
 *  page one without crowding text. Module-scoped because both the
 *  main composer and the matrix-renderer helpers need it. */
const compactCellPadding = { top: 3, right: 5, bottom: 3, left: 5 };

/**
 * Generate + download the family-acceptance PDF. Fetches every
 * payload the report needs in parallel (the calling admin already
 * has these in their SWR cache from the family detail page; the
 * cookie carries auth), then composes the document.
 */
export async function exportFamilyPDF({
  familyId,
  yearId,
}: ExportInput): Promise<void> {
  // Dynamic imports — keeps the jsPDF + autotable bundles out of
  // the main admin chunk; the ~150KB only loads on first export.
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableModule.default;

  // Fetch every payload in parallel. The primary fetch is the new
  // `registration_application_by_family` query — one row per active
  // application, pre-joined with the student / family / school-year
  // rows the report needs. Family-payment and the two bracket tables
  // are independent and fire alongside it.
  //
  // Each route 401s on its own when admin auth is missing, so we
  // don't need to short-circuit; the error bubbles to the caller's
  // catch.
  const [
    appsRes,
    paymentRes,
    payCellsRes,
    netAssetsCellsRes,
    registrationRes,
  ] = await Promise.all([
    fetch(
      `/api/admin/registration-application-by-family?familyId=${familyId}&yearId=${yearId}`
    ),
    fetch(
      `/api/admin/family-payment?familyId=${familyId}&yearId=${yearId}`
    ),
    fetch(`/api/admin/school-year-brackets?yearId=${yearId}`),
    fetch(`/api/admin/school-year-net-assets-brackets?yearId=${yearId}`),
    // Pulls `students[].packet` so we can read per-student tuition
    // columns (`monthly_amount`, `annual_fee`, `sufs_amount`, etc.)
    // and derive the family-level rollups the PDF prints. Replaces
    // the legacy `registration_families_payment.monthly_tuition_payment`
    // etc. reads — those columns were retired in favor of per-student
    // source of truth.
    fetch(`/api/admin/registrations/${familyId}?yearId=${yearId}`),
  ]);
  if (!appsRes.ok) {
    throw new Error(`Family applications fetch failed (${appsRes.status})`);
  }
  const activeApps = (await appsRes.json()) as XanoApplicationByFamily[];
  const familyPayment = paymentRes.ok
    ? ((await paymentRes.json()) as XanoFamilyPayment | null)
    : null;
  const payCells: AwardBracketCell[] = payCellsRes.ok
    ? ((await payCellsRes.json()) as AwardBracketCell[])
    : [];
  const netAssetsCells: AwardBracketCell[] = netAssetsCellsRes.ok
    ? ((await netAssetsCellsRes.json()) as AwardBracketCell[])
    : [];
  // Per-student packet rows for the year — used to derive family
  // monthly / annual fee / SUFS totals below. Tolerates a failed
  // fetch by falling back to an empty array; the report will print
  // $0 / em-dashes for the derived rows in that case, same UX as
  // pre-acceptance state.
  const registrationData = registrationRes.ok
    ? ((await registrationRes.json()) as {
        students?: Array<{ packet?: XanoStudentRegistration | null }>;
      })
    : null;
  const activePackets: XanoStudentRegistration[] = (
    registrationData?.students ?? []
  )
    .map((s) => s.packet)
    .filter((p): p is XanoStudentRegistration => p !== null && p !== undefined);
  const familyBillingTotals = sumFamilyBillingTotals(activePackets);

  // The new endpoint already pre-joins the student row, family row,
  // and school-year row onto every app — read the first app's
  // addons for the shared labels rather than running separate
  // fetches. Falls back gracefully when the family has no active
  // apps: the report still renders with placeholder labels.
  const firstApp = activeApps[0];
  const schoolYear: XanoSchoolYear | null =
    firstApp?._registration_school_years ?? null;
  const familyName =
    firstApp?._registration_families?.family_name ?? "Family";
  // The opportunity-scholarship summary is similarly pre-joined as
  // `_registration_opportunity_scholarship`. It's null on apps with
  // no OS row; we still need the full payload (contributing members,
  // homes, vehicles) for the financial-aid section so we fetch
  // `/api/admin/scholarship-details` separately when an OS row
  // exists. The embedded row gives us the id to do that lookup
  // without touching the family-applications composite endpoint.
  const scholarship: XanoScholarship | null =
    firstApp?._registration_opportunity_scholarship ?? null;

  // Composite scholarship payload only matters when the family has
  // an opportunity scholarship row. Skip the fetch otherwise (the
  // contributing-members + property section will render the "no
  // scholarship" notice).
  let scholarshipDetails: ScholarshipDetailsPayload | null = null;
  if (scholarship?.id) {
    const detailsRes = await fetch(
      `/api/admin/scholarship-details?id=${scholarship.id}`
    );
    if (detailsRes.ok) {
      scholarshipDetails =
        (await detailsRes.json()) as ScholarshipDetailsPayload;
    }
  }

  // Build the studentsById lookup map from each app's embedded
  // `_registration_students_details`. The endpoint joins one
  // student row per app, so this is a 1:1 map with the apps array
  // — no separate students fetch needed. We never fall back to a
  // numeric "Student #N" placeholder; admin reviewing the PDF
  // shouldn't have to translate row ids back to humans. When the
  // embed is missing (shouldn't happen, but defensively handled),
  // the row falls back to "—" so the page still renders.
  const studentsById = new Map<
    number,
    { first_name: string; last_name: string }
  >();
  for (const a of activeApps) {
    const s = a._registration_students_details;
    if (s && typeof s.id === "number") {
      studentsById.set(s.id, {
        first_name: s.first_name ?? "",
        last_name: s.last_name ?? "",
      });
    }
  }
  /** Resolve a student id to a "First Last" display name. Returns
   *  "—" rather than "Student #N" when the student isn't in the
   *  map — admin reading the PDF shouldn't have to translate row
   *  ids back to humans. */
  function studentNameFor(id: number): string {
    const s = studentsById.get(id);
    if (!s) return "—";
    const full = `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
    return full.length > 0 ? full : "—";
  }

  // ── Family metrics needed for matrix bracket matching ─────────
  // Mirrors `ScholarshipReviewBlock`'s math on the page: household
  // size + annual income (wages + passive×12) + asset/debt totals →
  // net assets, which decides standard vs high-net-assets path.
  const members = scholarshipDetails?.contributing_members ?? [];
  const homes = scholarshipDetails?.homes ?? [];
  const vehicles = scholarshipDetails?.vehicles ?? [];
  const householdSize =
    (scholarship?.household_adults ?? 0) +
    (scholarship?.household_children ?? 0);
  const wagesAnnualIncome = members.reduce(
    (acc, m) => acc + (m.estimated_annual_income ?? 0),
    0
  );
  const passiveAnnualIncome =
    ((scholarship?.business_income_monthly ?? 0) +
      (scholarship?.capital_gains_monthly ?? 0) +
      (scholarship?.child_support_monthly ?? 0) +
      (scholarship?.alimony_monthly ?? 0) +
      (scholarship?.trusts_monthly ?? 0) +
      (scholarship?.other_income_monthly ?? 0)) *
    12;
  const totalAnnualIncome = wagesAnnualIncome + passiveAnnualIncome;
  const liquidAssets =
    (scholarship?.assets_checking ?? 0) +
    (scholarship?.assets_savings ?? 0) +
    (scholarship?.assets_retirement_savings ?? 0) +
    (scholarship?.assets_stocks_bonds_securities ?? 0) +
    (scholarship?.assets_trusts_inheritance ?? 0) +
    (scholarship?.assets_business ?? 0);
  const homeEquity = homes.reduce(
    (acc, h) => acc + ((h.total_value ?? 0) - (h.outstanding_debt ?? 0)),
    0
  );
  const vehicleEquity = vehicles.reduce(
    (acc, v) => acc + ((v.total_value ?? 0) - (v.remaining_debt ?? 0)),
    0
  );
  const totalAssets = liquidAssets + homeEquity + vehicleEquity;
  const totalDebts =
    (scholarship?.debts_credit_cards ?? 0) +
    (scholarship?.debts_student_loans ?? 0) +
    (scholarship?.debts_personal_loans ?? 0);
  const netAssets = totalAssets - totalDebts;
  const useNetAssetsMatrix = netAssets > 100_000;

  // Letter-sized portrait. `unit: "pt"` so 12pt body text + 0.5"
  // margins (36pt) work out to readable line heights and column
  // widths without manual conversion.
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 36;
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - marginX * 2;

  /** Cursor tracking the current Y position. Sections push the
   *  cursor down as they render so the next section knows where
   *  to start without manual addPage() calls. */
  let cursorY = 0;

  /** Document-level header — drawn once at the very top. Tighter
   *  vertical rhythm than the prior version to keep the cover
   *  block from eating half the first page. */
  function documentHeader(): void {
    let y = 36;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text("SAILFUTURE ACADEMY · ADMISSIONS", marginX, y);
    y += 14;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.setTextColor(20);
    doc.text("Family Acceptance Summary", marginX, y);
    y += 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(120);
    doc.text(
      `${familyName} · ${schoolYear?.year_name ?? ""}`,
      marginX,
      y
    );
    y += 6;
    doc.setDrawColor(200);
    doc.setLineWidth(0.75);
    doc.line(marginX, y, pageWidth - marginX, y);
    cursorY = y + 10;
  }

  /** Section header — bold title rule that introduces each block of
   *  tables. The top gap (22px) is intentionally generous: with
   *  several sections stacked on a single page, the prior
   *  ~4px-of-air felt cramped. The bottom gap (8px) keeps the
   *  title rule visually attached to its table while still
   *  separating it from the rule line. */
  function sectionHeader(title: string): void {
    cursorY += 22;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(20);
    doc.text(title, marginX, cursorY);
    cursorY += 5;
    doc.setDrawColor(225);
    doc.setLineWidth(0.4);
    doc.line(marginX, cursorY, pageWidth - marginX, cursorY);
    cursorY += 8;
  }

  /** Read autoTable's post-render finalY off the runtime-only
   *  `lastAutoTable` field (jspdf-autotable adds it but it's not on
   *  the public type), then bump the cursor for whatever's next.
   *  Default extra is 4px — barely enough breathing room without
   *  leaving the page feeling spaced-out. */
  function bumpCursorAfterTable(extra = 4): void {
    const finalY = (
      doc as unknown as { lastAutoTable?: { finalY: number } }
    ).lastAutoTable?.finalY;
    if (typeof finalY === "number") cursorY = finalY + extra;
  }

  /* ────────── Document header + Acceptance Summary ────────── */

  documentHeader();

  const path = scholarship?.isNotParticipating
    ? "Opted out of the Opportunity Scholarship"
    : scholarship?.isSNAPBenefits
      ? "SNAP benefits pre-qualified"
      : scholarship?.isOpportunityScholarship
        ? "Full Opportunity Scholarship application"
        : "No scholarship path on file";

  // Active-student names — comma-separated. Admin reading the
  // PDF should see "Jane Smith, John Smith" instead of a bare
  // count: the names are the meaningful identifier, the count
  // is implicit in the list length.
  const activeStudentNames = activeApps
    .map((a) => studentNameFor(Number(a.registration_students_id)))
    .filter((n) => n !== "—");
  const activeStudentsCell =
    activeStudentNames.length > 0 ? activeStudentNames.join(", ") : "—";

  autoTable(doc, {
    startY: cursorY,
    head: [["Field", "Value"]],
    body: [
      ["Family", familyName],
      ["School year", schoolYear?.year_name ?? "—"],
      ["Active students", activeStudentsCell],
      ["Scholarship path", path],
      [
        "Acceptance status",
        familyPayment?.isFamilyAccepted ? "Accepted" : "Pending",
      ],
    ],
    theme: "striped",
    margin: { left: marginX, right: marginX },
    styles: { cellPadding: compactCellPadding },
    headStyles: { fillColor: [240, 240, 240], textColor: 40, fontSize: 8.5 },
    bodyStyles: { fontSize: 9.5 },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.35, fontStyle: "bold" },
      1: { cellWidth: contentWidth * 0.65 },
    },
  });
  bumpCursorAfterTable(6);

  // The 3×2 totals cards strip used to live here — removed per
  // request. The same numbers (monthly tuition, annual fees,
  // transportation, SUFS total, tuition for year, annual fee per
  // student) show up later in the Pay Matrix Determination and
  // Total Tuition tables, so dropping the cover cards trims
  // duplication without losing the data.

  /* ────────── Financial Aid Application ────────── */

  sectionHeader("Financial Aid Application");
  if (!scholarship) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(
      "No scholarship row on file for this family / year.",
      marginX,
      cursorY
    );
    cursorY += 14;
  } else if (scholarship.isNotParticipating) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(
      "Family opted out of the Opportunity Scholarship. No financial information was collected.",
      marginX,
      cursorY,
      { maxWidth: contentWidth }
    );
    cursorY += 22;
  } else {
    /** Helper — render a labeled key/value sub-table. Each block
     *  takes the current `cursorY` and bumps it past the table. */
    function subTable(
      title: string,
      rows: Array<[string, string]>
    ): void {
      autoTable(doc, {
        startY: cursorY,
        head: [[title, ""]],
        body: rows,
        theme: "striped",
        margin: { left: marginX, right: marginX },
        styles: { cellPadding: compactCellPadding },
        headStyles: {
          fillColor: [60, 60, 60],
          textColor: 255,
          fontSize: 8.5,
          fontStyle: "bold",
        },
        bodyStyles: { fontSize: 9.5 },
        columnStyles: {
          0: { cellWidth: contentWidth * 0.5, fontStyle: "bold" },
          1: { cellWidth: contentWidth * 0.5, halign: "right" },
        },
      });
      bumpCursorAfterTable(4);
    }
    subTable("Household", [
      ["Adults", String(scholarship.household_adults ?? 0)],
      ["Children", String(scholarship.household_children ?? 0)],
      [
        "No contributing members",
        scholarship.no_contributing_member ? "Yes" : "No",
      ],
      [
        "Government benefits",
        scholarship.government_benefits ? "Yes" : "No",
      ],
    ]);
    subTable("Monthly Income", [
      ["Business", fmt$(scholarship.business_income_monthly)],
      ["Capital gains", fmt$(scholarship.capital_gains_monthly)],
      ["Child support", fmt$(scholarship.child_support_monthly)],
      ["Alimony", fmt$(scholarship.alimony_monthly)],
      ["Trusts", fmt$(scholarship.trusts_monthly)],
      ["Other", fmt$(scholarship.other_income_monthly)],
    ]);
    subTable("Assets", [
      ["Checking", fmt$(scholarship.assets_checking)],
      ["Savings", fmt$(scholarship.assets_savings)],
      ["Retirement", fmt$(scholarship.assets_retirement_savings)],
      ["Securities", fmt$(scholarship.assets_stocks_bonds_securities)],
      ["Trusts / inheritance", fmt$(scholarship.assets_trusts_inheritance)],
      ["Business", fmt$(scholarship.assets_business)],
    ]);
    subTable("Debts", [
      ["Credit cards", fmt$(scholarship.debts_credit_cards)],
      ["Student loans", fmt$(scholarship.debts_student_loans)],
      ["Personal loans", fmt$(scholarship.debts_personal_loans)],
    ]);
    subTable("Family Contribution", [
      [
        "Per month",
        fmt$(scholarship.family_contribution_per_month),
      ],
    ]);

    // Scholarship advocacy letter — the family's own narrative
    // ("why do you want / need this scholarship?"). Rendered as a
    // soft-bordered block under Family Contribution so admin
    // reviewing the PDF can read the family's case in context with
    // the income / asset / debt totals just above it. Falls back
    // to a placeholder line when empty so the section header
    // doesn't dangle without a body.
    const advocacy = scholarship.scholarship_advocacy_letter?.trim() ?? "";
    autoTable(doc, {
      startY: cursorY,
      head: [["Why the Family Needs the Scholarship", ""]],
      body: [
        [
          advocacy.length > 0
            ? advocacy
            : "Family did not provide an advocacy letter.",
          "",
        ],
      ],
      theme: "striped",
      margin: { left: marginX, right: marginX },
      styles: { cellPadding: compactCellPadding },
      headStyles: {
        fillColor: [60, 60, 60],
        textColor: 255,
        fontSize: 8.5,
        fontStyle: "bold",
      },
      bodyStyles: {
        fontSize: 9.5,
        textColor: advocacy.length > 0 ? 20 : 120,
        fontStyle: advocacy.length > 0 ? "normal" : "italic",
      },
      columnStyles: {
        0: { cellWidth: contentWidth },
        // Second column is a layout artifact of the head [["…", ""]]
        // shape — collapse it to zero so the body cell spans the
        // full content width.
        1: { cellWidth: 0 },
      },
    });
    bumpCursorAfterTable(4);
  }

  /* ────────── Contributing Members & Property ────────── */

  sectionHeader("Contributing Members & Property");
  if (scholarship?.no_contributing_member) {
    autoTable(doc, {
      startY: cursorY,
      head: [["Contributing Members"]],
      body: [["Family declared no contributing members."]],
      theme: "plain",
      margin: { left: marginX, right: marginX },
      styles: { cellPadding: compactCellPadding },
      headStyles: { fontStyle: "bold", fontSize: 9 },
      bodyStyles: { fontSize: 9.5, textColor: 120 },
    });
    bumpCursorAfterTable(4);
  } else if (members.length === 0) {
    autoTable(doc, {
      startY: cursorY,
      head: [["Contributing Members"]],
      body: [["No contributing members on file."]],
      theme: "plain",
      margin: { left: marginX, right: marginX },
      styles: { cellPadding: compactCellPadding },
      headStyles: { fontStyle: "bold", fontSize: 9 },
      bodyStyles: { fontSize: 9.5, textColor: 120 },
    });
    bumpCursorAfterTable(4);
  } else {
    autoTable(doc, {
      startY: cursorY,
      head: [["Name", "Address", "Annual income", "Method"]],
      body: members.map((m) => [
        fmtMaybe(`${m.first_name ?? ""} ${m.last_name ?? ""}`),
        [m.address_1, m.city, m.state, m.zipcode]
          .filter(Boolean)
          .join(", ") || "—",
        fmt$(m.estimated_annual_income),
        m.isW2 ? "W-2" : m.isPayStubs ? "Pay stubs" : "—",
      ]),
      theme: "striped",
      margin: { left: marginX, right: marginX },
      styles: { cellPadding: compactCellPadding },
      headStyles: { fillColor: [60, 60, 60], textColor: 255, fontSize: 8.5 },
      bodyStyles: { fontSize: 8.5 },
    });
    bumpCursorAfterTable(4);
  }

  function arrayTable(
    head: string[],
    body: string[][],
    emptyMessage: string
  ): void {
    if (body.length === 0) {
      autoTable(doc, {
        startY: cursorY,
        head: [[head[0]]],
        body: [[emptyMessage]],
        theme: "plain",
        margin: { left: marginX, right: marginX },
        styles: { cellPadding: compactCellPadding },
        headStyles: { fontStyle: "bold", fontSize: 9 },
        bodyStyles: { fontSize: 9.5, textColor: 120 },
      });
    } else {
      autoTable(doc, {
        startY: cursorY,
        head: [head],
        body,
        theme: "striped",
        margin: { left: marginX, right: marginX },
        styles: { cellPadding: compactCellPadding },
        headStyles: { fillColor: [60, 60, 60], textColor: 255, fontSize: 8.5 },
        bodyStyles: { fontSize: 8.5 },
      });
    }
    bumpCursorAfterTable(4);
  }
  arrayTable(
    ["Purchased Houses", "Address", "Total value", "Outstanding debt"],
    homes.map((h) => [
      fmtMaybe(h.type),
      [h.address_1, h.city, h.state, h.zipcode]
        .filter(Boolean)
        .join(", ") || "—",
      fmt$(h.total_value),
      fmt$(h.outstanding_debt),
    ]),
    "No purchased houses declared."
  );
  arrayTable(
    [
      "Purchased Vehicles",
      "Make / Model / Year",
      "Total value",
      "Remaining debt",
    ],
    vehicles.map((v) => [
      fmtMaybe(v.type),
      [v.car_make, v.car_model, v.car_year].filter(Boolean).join(" ") ||
        "—",
      fmt$(v.total_value),
      fmt$(v.remaining_debt),
    ]),
    "No purchased vehicles declared."
  );

  /* ────────── Per-Student Scholarship Awards ────────── */

  sectionHeader("Per-Student Scholarship Awards");
  if (activeApps.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(
      "No active applications on file for this year.",
      marginX,
      cursorY
    );
    cursorY += 14;
  } else {
    const sufsSum = activeApps.reduce(
      (acc, a) => acc + (a.sufs_award_amount ?? 0),
      0
    );
    const oppSum = activeApps.reduce(
      (acc, a) => acc + (a.opportunity_scholarship_award_amount ?? 0),
      0
    );
    autoTable(doc, {
      startY: cursorY,
      head: [
        [
          "Student",
          "SUFS tier",
          "SUFS status",
          "SUFS award",
          "Opp. Scholarship",
          "Confirmed",
        ],
      ],
      body: activeApps.map((a) => {
        // Use the shared `studentNameFor` helper so this row
        // never falls through to a numeric "Student #N" — the
        // helper returns "—" when the relation didn't expand,
        // which keeps the table free of internal database ids.
        const sid = Number(a.registration_students_id);
        return [
          studentNameFor(sid),
          fmtMaybe(a.sufs_type),
          fmtMaybe(a.sufs_status),
          fmt$(a.sufs_award_amount ?? null),
          fmt$(a.opportunity_scholarship_award_amount),
          a.confirmed_scholarship ? "Yes" : "No",
        ];
      }),
      foot: [
        [
          { content: "Totals", colSpan: 3, styles: { fontStyle: "bold" } },
          { content: fmt$(sufsSum), styles: { fontStyle: "bold" } },
          { content: fmt$(oppSum), styles: { fontStyle: "bold" } },
          "",
        ],
      ],
      theme: "striped",
      margin: { left: marginX, right: marginX },
      styles: { cellPadding: compactCellPadding },
      headStyles: { fillColor: [60, 60, 60], textColor: 255, fontSize: 8.5 },
      bodyStyles: { fontSize: 8.5 },
      footStyles: { fillColor: [240, 240, 240], textColor: 20, fontSize: 8.5 },
      columnStyles: {
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "center" },
      },
    });
    bumpCursorAfterTable(4);
  }

  /* ────────── Pay Matrix (full table with highlighted row) ────────── */

  sectionHeader(
    useNetAssetsMatrix
      ? "Net Assets > $100k Payment Matrix"
      : "Family Tuition Payment Matrix"
  );
  // Context line above the matrix so admin reading the PDF knows
  // which bracket the family lands in without having to scan the
  // whole table.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(80);
  const contextLine = useNetAssetsMatrix
    ? `Net assets ${fmt$(netAssets)} exceed $100k — high-net-assets sliding scale.`
    : `Household of ${householdSize}, annual income ${fmt$(totalAnnualIncome)} — standard tuition matrix.`;
  doc.text(contextLine, marginX, cursorY, { maxWidth: contentWidth });
  cursorY += 10;
  const baseTuition = schoolYear?.tuition ?? 0;
  if (useNetAssetsMatrix) {
    renderNetAssetsMatrix(doc, autoTable, {
      cells: netAssetsCells,
      netAssets,
      baseTuition,
      marginX,
      contentWidth,
      startY: cursorY,
    });
  } else {
    renderStandardMatrix(doc, autoTable, {
      cells: payCells,
      householdSize,
      totalAnnualIncome,
      baseTuition,
      marginX,
      contentWidth,
      startY: cursorY,
    });
  }
  bumpCursorAfterTable(4);

  /* ────────── Pay Matrix Determination (snapshot totals) ────────── */

  sectionHeader("Pay Matrix Determination");
  autoTable(doc, {
    startY: cursorY,
    head: [["Snapshot Totals", ""]],
    body: [
      ["Monthly tuition payment", fmt$(familyBillingTotals.monthlyTotal)],
      ["Annual fee total", fmt$(familyBillingTotals.annualFeeTotal)],
      [
        "Transportation total (year)",
        fmt$(familyPayment?.transportation_total),
      ],
      ["SUFS total", fmt$(familyBillingTotals.sufsTotal)],
    ],
    theme: "grid",
    margin: { left: marginX, right: marginX },
    styles: { cellPadding: compactCellPadding },
    headStyles: {
      fillColor: [220, 240, 220],
      textColor: 20,
      fontSize: 8.5,
      fontStyle: "bold",
    },
    bodyStyles: { fontSize: 9.5, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.5 },
      1: { cellWidth: contentWidth * 0.5, halign: "right" },
    },
  });
  bumpCursorAfterTable(4);

  /* ────────── Total Tuition Receipt ────────── */

  sectionHeader("Total Tuition");
  const monthly =
    familyBillingTotals.monthlyTotal > 0
      ? familyBillingTotals.monthlyTotal
      : null;
  const annualFromMonthly = monthly != null ? monthly * 12 : null;
  autoTable(doc, {
    startY: cursorY,
    head: [["Receipt", ""]],
    body: [
      ["Active students", String(activeApps.length)],
      ["Annual admin fees", fmt$(familyBillingTotals.annualFeeTotal)],
      ["Annual transportation", fmt$(familyPayment?.transportation_total)],
      ["SUFS scholarship awarded", fmt$(familyBillingTotals.sufsTotal)],
      ["Monthly tuition payment", fmt$(monthly)],
      ["Annual tuition (monthly × 12)", fmt$(annualFromMonthly)],
    ],
    theme: "striped",
    margin: { left: marginX, right: marginX },
    styles: { cellPadding: compactCellPadding },
    headStyles: { fillColor: [60, 60, 60], textColor: 255, fontSize: 8.5 },
    bodyStyles: { fontSize: 9.5 },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.5, fontStyle: "bold" },
      1: { cellWidth: contentWidth * 0.5, halign: "right" },
    },
    didParseCell: (cell) => {
      // Bold + green-tinted highlight on the final annual row so
      // admin's eye lands on the headline number.
      if (cell.section === "body" && cell.row.index === 5) {
        cell.cell.styles.fontStyle = "bold";
        cell.cell.styles.fillColor = [220, 240, 220];
      }
    },
  });
  bumpCursorAfterTable(4);

  // Footer timestamp on the last drawn page — admin reading the
  // PDF days later can tell when it was generated.
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(140);
  doc.text(
    `Generated ${new Date().toLocaleString()}`,
    marginX,
    doc.internal.pageSize.getHeight() - 24
  );

  // File-name pattern: `Family Name · 2026-2027 · Acceptance.pdf`.
  // Sanitize the family name so OS path separators don't leak in.
  const safeName = familyName.replace(/[/\\:*?"<>|]+/g, "").trim() || "Family";
  const year = schoolYear?.year_name ?? `Year ${yearId}`;
  doc.save(`${safeName} · ${year} · Acceptance.pdf`);
}

/* ─────────────────────── Matrix renderers ─────────────────────── */

type AutoTableFn = (typeof import("jspdf-autotable"))["default"];

/**
 * Render the standard 2D household-size × income pay matrix as a
 * table, highlighting the row + column where the family lands.
 * Mirrors `PayMatrixView` on the page: each cell shows the tuition
 * percentage. The matched cell gets a stronger fill; the matched
 * row + column get a softer fill so admin's eye is guided to the
 * intersection.
 */
function renderStandardMatrix(
  doc: jsPDF,
  autoTable: AutoTableFn,
  {
    cells,
    householdSize,
    totalAnnualIncome,
    baseTuition,
    marginX,
    contentWidth,
    startY,
  }: {
    cells: AwardBracketCell[];
    householdSize: number;
    totalAnnualIncome: number;
    baseTuition: number;
    marginX: number;
    contentWidth: number;
    startY: number;
  }
): void {
  void baseTuition;
  if (cells.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(
      "No matrix configured for this year yet.",
      marginX,
      startY
    );
    return;
  }

  // Distinct household sizes (rows) sorted ascending.
  const sizes = Array.from(
    new Set(cells.map((c) => c.household_size ?? 0).filter((s) => s > 0))
  ).sort((a, b) => a - b);

  // Distinct income brackets (columns), sorted by `income_min`;
  // null `income_max` (open-ended "+" bracket) sinks to the bottom.
  const brackets: Array<{
    key: string;
    min: number;
    max: number | null;
  }> = [];
  const seen = new Set<string>();
  for (const c of cells) {
    const min = c.income_min ?? 0;
    const max = c.income_max ?? null;
    const key = `${min}-${max ?? "null"}`;
    if (!seen.has(key)) {
      seen.add(key);
      brackets.push({ key, min, max });
    }
  }
  brackets.sort((a, b) => {
    if (a.max === null && b.max !== null) return 1;
    if (b.max === null && a.max !== null) return -1;
    return a.min - b.min;
  });

  // Find the matched (row, col) so we can highlight in `didParseCell`.
  const matchedRowIdx = sizes.indexOf(householdSize); // -1 when missing
  const matchedColIdx = brackets.findIndex(
    (b) =>
      b.min <= totalAnnualIncome &&
      (b.max === null || totalAnnualIncome < b.max)
  );

  // Build a lookup so cell renders pull the percentage by
  // `${size}::${bracket.key}`.
  const cellLookup = new Map<string, AwardBracketCell>();
  for (const c of cells) {
    cellLookup.set(
      `${c.household_size}::${c.income_min}-${c.income_max ?? "null"}`,
      c
    );
  }

  // Header row: first col = "Household", then one column per bracket.
  const head: string[] = ["Household"];
  for (const b of brackets) head.push(bracketLabel(b.min, b.max));

  // Body rows: first cell = household-size label, then percentages.
  const body: string[][] = sizes.map((size) => {
    const row: string[] = [`${size} ${size === 1 ? "person" : "people"}`];
    for (const b of brackets) {
      const cell = cellLookup.get(`${size}::${b.key}`);
      const pct = cell?.tuition_percentage ?? 0;
      row.push(`${pct}%`);
    }
    return row;
  });

  autoTable(doc, {
    startY,
    head: [head],
    body,
    theme: "grid",
    margin: { left: marginX, right: marginX },
    styles: { cellPadding: compactCellPadding },
    headStyles: {
      fillColor: [60, 60, 60],
      textColor: 255,
      fontSize: 7.5,
      fontStyle: "bold",
      halign: "center",
    },
    bodyStyles: { fontSize: 7.5, halign: "center" },
    columnStyles: {
      0: {
        cellWidth: contentWidth * 0.18,
        halign: "left",
        fontStyle: "bold",
      },
    },
    // Per-cell highlight — soft yellow on the matched row, soft
    // yellow on the matched column, slightly darker yellow on
    // their intersection. Use jspdf-autotable's `didParseCell`
    // hook to override the body/head style on the fly. Matched
    // row index lines up with body's `row.index`; matched col
    // includes the +1 offset because column 0 is the Household
    // label.
    didParseCell: (cell) => {
      if (cell.section === "head") {
        if (matchedColIdx >= 0 && cell.column.index === matchedColIdx + 1) {
          cell.cell.styles.fillColor = [255, 240, 160];
          cell.cell.styles.textColor = 30;
        }
        return;
      }
      if (cell.section !== "body") return;
      const isMatchedRow =
        matchedRowIdx >= 0 && cell.row.index === matchedRowIdx;
      const isMatchedCol =
        matchedColIdx >= 0 && cell.column.index === matchedColIdx + 1;
      if (isMatchedRow && isMatchedCol) {
        cell.cell.styles.fillColor = [253, 224, 71]; // amber-300
        cell.cell.styles.fontStyle = "bold";
      } else if (isMatchedRow || isMatchedCol) {
        cell.cell.styles.fillColor = [254, 252, 232]; // amber-50
      }
    },
  });
}

/**
 * Render the 1D net-assets payment matrix as a two-column table.
 * Each row shows a bracket and the family-pays percentage; the
 * row where the family's `netAssets` falls is highlighted.
 */
function renderNetAssetsMatrix(
  doc: jsPDF,
  autoTable: AutoTableFn,
  {
    cells,
    netAssets,
    baseTuition,
    marginX,
    contentWidth,
    startY,
  }: {
    cells: AwardBracketCell[];
    netAssets: number;
    baseTuition: number;
    marginX: number;
    contentWidth: number;
    startY: number;
  }
): void {
  if (cells.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(
      "No high-net-assets brackets configured for this year yet.",
      marginX,
      startY
    );
    return;
  }

  // Sort by net_asset_min; null max sinks to the bottom.
  const sorted = [...cells].sort((a, b) => {
    if (a.net_asset_max === null && b.net_asset_max !== null) return 1;
    if (b.net_asset_max === null && a.net_asset_max !== null) return -1;
    return (a.net_asset_min ?? 0) - (b.net_asset_min ?? 0);
  });
  const matchedIdx = sorted.findIndex(
    (c) =>
      (c.net_asset_min ?? 0) <= netAssets &&
      (c.net_asset_max === null ||
        c.net_asset_max === undefined ||
        netAssets < (c.net_asset_max as number))
  );

  autoTable(doc, {
    startY,
    head: [["Net Asset Bracket", "Family Pays"]],
    body: sorted.map((c) => {
      const pct = c.percentage_of_total_tuition ?? 0;
      const dollars = baseTuition * (pct / 100);
      return [
        bracketLabel(c.net_asset_min ?? 0, c.net_asset_max),
        `${pct}% • ${fmt$(dollars)}`,
      ];
    }),
    theme: "grid",
    margin: { left: marginX, right: marginX },
    styles: { cellPadding: compactCellPadding },
    headStyles: { fillColor: [60, 60, 60], textColor: 255, fontSize: 8.5 },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.5, fontStyle: "bold" },
      1: { cellWidth: contentWidth * 0.5, halign: "right" },
    },
    didParseCell: (cell) => {
      if (cell.section === "body" && cell.row.index === matchedIdx) {
        cell.cell.styles.fillColor = [253, 224, 71]; // amber-300
        cell.cell.styles.fontStyle = "bold";
      }
    },
  });
}
