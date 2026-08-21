/**
 * Family scholarship-award PDF export — builds a printable 8.5×11
 * (letter portrait) summary of everything admin needs to decide the
 * Opportunity Scholarship award for a family, entirely client-side
 * via jsPDF + jspdf-autotable. Triggered by the "Export PDF" button
 * on the family detail page; downloads the file directly (no print
 * dialog).
 *
 * Sections mirror the on-page review cards, in the same order the
 * screenshots read:
 *   1. Overview (family, year, students, path, verification stamp)
 *   2. Step Up For Students — per-student tier / amount / status /
 *      award ID + Opportunity award
 *   3. Financial Aid Application — household, monthly income, assets
 *   4. Contributing Members
 *   5. Documents to Review — every uploaded file as a CLICKABLE link
 *      into the Xano vault, with its confirmation audit trail
 *   6. Purchased Houses / Vehicles, Debts, Family Contribution
 *   7. Advocacy Letter + Signature (clickable) + verification stamp
 *   8. Award Determination — computed income/asset totals, the
 *      payment matrix with the family's bracket highlighted, and the
 *      tuition/billing summary
 *
 * Why client-side: keeps the runtime simple — no Puppeteer / headless
 * Chrome dependency on the server, no extra route round-trip — and
 * means the PDF reflects whatever's currently in the admin's SWR
 * cache. Bundle cost is bearable because the import is dynamic; the
 * jsPDF/autotable code only loads when admin actually clicks Export.
 *
 * Layout — no manual `addPage()` calls anywhere. The document flows
 * as one continuous report; jsPDF-autotable handles automatic page
 * breaks when a table overflows the current page. File links are
 * attached per-cell in `didDrawCell`, which fires with the cell's
 * final page-local coordinates, so links stay clickable across page
 * breaks.
 */

import type {
  XanoApplicationByFamily,
  XanoFamilyApplicationProgress,
  XanoFamilyPayment,
  XanoScholarship,
  XanoScholarshipBenefit,
  XanoScholarshipContributingMember,
  XanoScholarshipHome,
  XanoScholarshipVehicle,
  XanoSchoolYear,
} from "@/lib/xano";
import { sumFamilyBillingTotals } from "@/lib/per-student-billing";

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

/** File metadata shape Xano returns inside the multi-file array
 *  slots. Mirrors `documents-to-review-block.tsx`'s local copy. */
interface XanoFileMetadata {
  name?: string;
  path?: string;
  size?: number;
  url?: string;
  [key: string]: unknown;
}

/** Xano vault base — instance URL (no `/api:*` suffix). The vault
 *  serves uploaded files at `${INSTANCE}/vault/...`, with `path`
 *  on each file metadata object holding the trailing portion.
 *  Falls back to the production hostname when the env var is
 *  missing so dev exports still link correctly. */
const XANO_VAULT_BASE =
  process.env.NEXT_PUBLIC_XANO_BASE ?? "https://xsc3-mvx7-r86m.n7e.xano.io";

/** Resolve a viewable URL for a Xano file — `url` first, then
 *  construct from `path`. Null when neither is usable (the PDF
 *  renders a plain non-link name). Same logic as the on-page
 *  Documents to Review block so the PDF links exactly what the
 *  page links. */
function fileViewUrl(file: XanoFileMetadata): string | null {
  if (typeof file.url === "string" && file.url.length > 0) return file.url;
  if (typeof file.path === "string" && file.path.startsWith("/")) {
    return `${XANO_VAULT_BASE}${file.path}`;
  }
  return null;
}

function toFileArray(v: unknown): XanoFileMetadata[] {
  if (!v) return [];
  if (Array.isArray(v)) return v as XanoFileMetadata[];
  if (typeof v === "object") return [v as XanoFileMetadata];
  return [];
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
function fmtDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
/** SUFS tier key → human label. Mirrors the SUFS_TIERS list on the
 *  family detail page (keys are the `sufs_type` column values); the
 *  PDF only needs the label side, not the school-year amount
 *  columns, so this is a plain lookup map. */
const SUFS_TIER_LABELS: Record<string, string> = {
  "": "Not on a SUFS scholarship",
  fes_eo_8: "FES-EO · Grade 8",
  fes_eo_9: "FES-EO · Grade 9",
  ftc_8: "FTC · Grade 8",
  ftc_9: "FTC · Grade 9",
  fes_ua_8_ese_1_3: "FES-UA · Grade 8 (ESE 1-3)",
  fes_ua_9_ese_1_3: "FES-UA · Grade 9 (ESE 1-3)",
  fes_ua_ese_4: "FES-UA · ESE 4",
  fes_ua_ese_5: "FES-UA · ESE 5",
  custom: "Custom amount",
};
function sufsTierLabel(type: string | null | undefined): string {
  const key = (type ?? "").trim();
  return SUFS_TIER_LABELS[key] ?? (key.length > 0 ? key : "—");
}

/** Link-text color (blue-600) applied to clickable cells so the
 *  affordance is visible on paper-style output too. */
const LINK_COLOR: [number, number, number] = [37, 99, 235];

/** Shared autoTable cell-padding override — applied to every table
 *  in the document so a single tweak adjusts the whole report's
 *  density. */
const compactCellPadding = { top: 3, right: 5, bottom: 3, left: 5 };

/* ─────────────── Documents to Review row model ─────────────── */

/** One reviewable document slot, flattened to what the PDF renders:
 *  label + files + confirmation audit. Read-only mirror of the row
 *  model in `documents-to-review-block.tsx`. */
interface PdfDocRow {
  label: string;
  /** Small context line (e.g. a benefit's monthly amount). */
  sublabel?: string;
  files: XanoFileMetadata[];
  emptyHint: string;
  /** Whether this slot has a confirm flow at all. */
  confirmable: boolean;
  confirmed: boolean;
  confirmedByName: string | null;
  confirmedAt: number | null;
}

/** Resolve a confirming-admin display for the legacy int-typed
 *  `*_confirm_admin` columns via the teacher-id → name map. */
function adminNameForId(
  id: number | null | undefined,
  adminNameByTeacherId: Map<number, string>
): string | null {
  if (!id || id <= 0) return null;
  return adminNameByTeacherId.get(id) ?? "an admin";
}

/** Normalize the newer text-typed `*_admin_confirm` columns — Xano
 *  left the int default behind when the type flipped, so legacy rows
 *  carry the literal string "0". Treat that as unset. */
function cleanAdminName(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  if (t.length === 0 || t === "0") return null;
  return t;
}

/**
 * Build the flat Documents-to-Review list for the PDF. Mirrors the
 * path logic of the on-page block:
 *  - SNAP path → only the SNAP award letter row (short-circuit)
 *  - Opportunity path → tax return, unemployment letter (when no
 *    contributing members), per-member W-2 / pay-stub slots, and
 *    per-benefit documentation rows
 */
function buildDocRows({
  scholarship,
  members,
  benefits,
  adminNameByTeacherId,
}: {
  scholarship: XanoScholarship;
  members: XanoScholarshipContributingMember[];
  benefits: XanoScholarshipBenefit[];
  adminNameByTeacherId: Map<number, string>;
}): PdfDocRow[] {
  const rows: PdfDocRow[] = [];

  if (scholarship.isSNAPBenefits) {
    const confirmed = scholarship.is_snap_confirmed === true;
    rows.push({
      label: "SNAP benefits award letter",
      files: toFileArray(scholarship.snap_benefits),
      emptyHint: "No award letter uploaded yet.",
      confirmable: true,
      confirmed,
      confirmedByName: confirmed
        ? adminNameForId(scholarship.snap_confirm_admin, adminNameByTeacherId)
        : null,
      confirmedAt: confirmed ? scholarship.snap_confirm_time ?? null : null,
    });
    return rows;
  }

  if (!scholarship.isNotParticipating) {
    const confirmed = scholarship.tax_document_confirm === true;
    rows.push({
      label: "Prior-year tax return",
      sublabel: "Most recent federal 1040 + supporting schedules",
      files: toFileArray(scholarship.tax_return),
      emptyHint: "No tax return uploaded yet.",
      confirmable: true,
      confirmed,
      confirmedByName: confirmed
        ? cleanAdminName(scholarship.tax_document_confirm_admin)
        : null,
      confirmedAt: confirmed
        ? scholarship.tax_document_confirm_time ?? null
        : null,
    });
  }

  if (scholarship.no_contributing_member) {
    const confirmed = scholarship.is_unemployment_confirm === true;
    rows.push({
      label: "Unemployment / termination letter",
      files: toFileArray(scholarship.unemployment_letter),
      emptyHint: "No unemployment paperwork uploaded yet.",
      confirmable: true,
      confirmed,
      confirmedByName: confirmed
        ? adminNameForId(
            scholarship.unemployment_confirm_admin,
            adminNameByTeacherId
          )
        : null,
      confirmedAt: confirmed
        ? scholarship.unemployment_confirm_time ?? null
        : null,
    });
  }

  if (!scholarship.no_contributing_member) {
    for (const m of members) {
      const memberLabel =
        m.first_name || m.last_name
          ? `${m.first_name} ${m.last_name}`.trim()
          : `Contributing member #${m.id}`;
      // NB: the W-2 timestamp column is `w2_confirmation` (not
      // `w2_confirm_time`) — Xano schema divergence, typed
      // faithfully on the member interface.
      const slots: Array<{
        label: string;
        files: XanoFileMetadata[];
        confirmed: boolean;
        confirmedByName: string | null;
        confirmedAt: number | null;
      }> = [
        {
          label: "W-2",
          files: toFileArray(m.w2),
          confirmed: m.w2_confirm === true,
          confirmedByName: cleanAdminName(m.w2_admin_confirm),
          confirmedAt: m.w2_confirmation ?? null,
        },
        {
          label: "Pay stub 1",
          files: toFileArray(m.paystub_1),
          confirmed: m.paystub_1_confirm === true,
          confirmedByName: cleanAdminName(m.paystub_1_admin_confirm),
          confirmedAt: m.paystub_1_confirm_time ?? null,
        },
        {
          label: "Pay stub 2",
          files: toFileArray(m.paystub_2),
          confirmed: m.paystub_2_confirm === true,
          confirmedByName: cleanAdminName(m.paystub_2_admin_confirm),
          confirmedAt: m.paystub_2_confirm_time ?? null,
        },
        {
          label: "Pay stub 3",
          files: toFileArray(m.paystub_3),
          confirmed: m.paystub_3_confirm === true,
          confirmedByName: cleanAdminName(m.paystub_3_admin_confirm),
          confirmedAt: m.paystub_3_confirm_time ?? null,
        },
        {
          label: "Pay stub 4",
          files: toFileArray(m.paystub_4),
          confirmed: m.paystub_4_confirm === true,
          confirmedByName: cleanAdminName(m.paystub_4_admin_confirm),
          confirmedAt: m.paystub_4_confirm_time ?? null,
        },
      ].filter((s) => s.files.length > 0);

      if (slots.length === 0) {
        rows.push({
          label: memberLabel,
          files: [],
          emptyHint: "No income documents uploaded.",
          confirmable: false,
          confirmed: false,
          confirmedByName: null,
          confirmedAt: null,
        });
        continue;
      }
      for (const s of slots) {
        rows.push({
          label: `${memberLabel} · ${s.label}`,
          files: s.files,
          emptyHint: "No file uploaded.",
          confirmable: true,
          confirmed: s.confirmed,
          confirmedByName: s.confirmed ? s.confirmedByName : null,
          confirmedAt: s.confirmed ? s.confirmedAt : null,
        });
      }
    }
  }

  if (scholarship.government_benefits) {
    for (const b of benefits) {
      const confirmed = b.benefit_is_confirmed === true;
      rows.push({
        label: b.type || "Government benefit",
        sublabel: `${fmt$(b.amount_monthly ?? 0)}/mo`,
        files: toFileArray(b.benefit_documentation),
        emptyHint: "No documentation uploaded.",
        confirmable: true,
        confirmed,
        confirmedByName: confirmed
          ? adminNameForId(b.benefit_confirm_admin, adminNameByTeacherId)
          : null,
        confirmedAt: confirmed ? b.benefit_confirm_time ?? null : null,
      });
    }
  }

  return rows;
}

/**
 * Generate + download the family scholarship-award PDF. Fetches every
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

  // Fetch every payload in parallel. The primary fetch is the
  // `registration_application_by_family` query — one row per active
  // application, pre-joined with the student / family / school-year
  // rows the report needs. The progress row carries the Financial
  // Aid verification stamp; the admins list resolves legacy int
  // `*_confirm_admin` audit columns to display names. Only the
  // primary fetch is fatal — every other payload degrades to a
  // placeholder so a single flaky endpoint doesn't block the export.
  const [
    appsRes,
    paymentRes,
    progressRes,
    adminsRes,
  ] = await Promise.all([
    fetch(
      `/api/admin/registration-application-by-family?familyId=${familyId}&yearId=${yearId}`
    ),
    fetch(
      `/api/admin/family-payment?familyId=${familyId}&yearId=${yearId}`
    ),
    fetch(
      `/api/admin/family-progress?familyId=${familyId}&yearId=${yearId}`
    ),
    fetch(`/api/admin/admins`),
  ]);
  if (!appsRes.ok) {
    throw new Error(`Family applications fetch failed (${appsRes.status})`);
  }
  const activeApps = (await appsRes.json()) as XanoApplicationByFamily[];
  const familyPayment = paymentRes.ok
    ? ((await paymentRes.json()) as XanoFamilyPayment | null)
    : null;
  const progress = progressRes.ok
    ? ((await progressRes.json()) as XanoFamilyApplicationProgress | null)
    : null;
  const admins = adminsRes.ok
    ? ((await adminsRes.json()) as Array<{
        id: string;
        teacherId: number;
        name: string;
        email: string;
      }>)
    : [];
  const adminNameByTeacherId = new Map<number, string>();
  for (const a of admins) {
    if (a.teacherId > 0) adminNameByTeacherId.set(a.teacherId, a.name);
  }
  // Per-student billing math lives on the application row.
  // `activeApps` already carries the seven billing columns, so we
  // sum directly — no second fetch needed.
  const familyBillingTotals = sumFamilyBillingTotals(activeApps);

  // The endpoint pre-joins the student row, family row, and
  // school-year row onto every app — read the first app's addons
  // for the shared labels. Falls back gracefully when the family
  // has no active apps: the report still renders with placeholders.
  const firstApp = activeApps[0];
  const schoolYear: XanoSchoolYear | null =
    firstApp?._registration_school_years ?? null;
  const familyName =
    firstApp?._registration_families?.family_name ?? "Family";
  // Scholarship + its child rows, resolved by (family, year).
  //
  // NOT read off `firstApp._registration_opportunity_scholarship`:
  // that addon comes back NULL on every row of the by-family query
  // (the application table has no FK to the scholarship — it's keyed
  // by family + year), which silently emptied this report. Every
  // financial-aid section and the whole Documents-to-Review table are
  // gated on `scholarship` being non-null, so the addon returning
  // null rendered the PDF as "no scholarship on file" for families
  // who had a complete application on the page.
  let scholarship: XanoScholarship | null = null;
  let scholarshipDetails: ScholarshipDetailsPayload | null = null;
  const scholarshipRes = await fetch(
    `/api/admin/scholarships?familyId=${familyId}&yearId=${yearId}`
  );
  if (scholarshipRes.ok) {
    const payload = (await scholarshipRes.json()) as
      | (ScholarshipDetailsPayload & { scholarship: XanoScholarship | null })
      | null;
    if (payload?.scholarship) {
      scholarship = payload.scholarship;
      scholarshipDetails = payload as ScholarshipDetailsPayload;
    }
  }

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
  const benefits = scholarshipDetails?.benefits ?? [];
  const householdSize =
    (scholarship?.household_adults ?? 0) +
    (scholarship?.household_children ?? 0);
  const wagesAnnualIncome = members.reduce(
    (acc, m) => acc + (m.estimated_annual_income ?? 0),
    0
  );
  const passiveMonthlyIncome =
    (scholarship?.business_income_monthly ?? 0) +
    (scholarship?.capital_gains_monthly ?? 0) +
    (scholarship?.child_support_monthly ?? 0) +
    (scholarship?.alimony_monthly ?? 0) +
    (scholarship?.trusts_monthly ?? 0) +
    (scholarship?.other_income_monthly ?? 0);
  const passiveAnnualIncome = passiveMonthlyIncome * 12;
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

  // Financial Aid section verification stamp (progress row).
  const faVerified = progress?.financial_aid_admin_confirm === true;
  const faVerifiedBy = faVerified
    ? cleanAdminName(progress?.financial_aid_admin_confirm_admin)
    : null;
  const faVerifiedAt = faVerified
    ? progress?.financial_aid_admin_confirm_time ?? null
    : null;
  const faStamp = faVerified
    ? `Verified${faVerifiedBy ? ` by ${faVerifiedBy}` : ""}${
        faVerifiedAt ? ` · ${fmtDate(faVerifiedAt)}` : ""
      }`
    : "Not yet verified";

  // Letter-sized portrait — 8.5×11. `unit: "pt"` so 12pt body text
  // + 0.5" margins (36pt) work out to readable line heights and
  // column widths without manual conversion.
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 36;
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - marginX * 2;

  /** Cursor tracking the current Y position. Sections push the
   *  cursor down as they render so the next section knows where
   *  to start without manual addPage() calls. */
  let cursorY = 0;

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
    doc.text("Scholarship Award Summary", marginX, y);
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
   *  tables. When the remaining space on the page can't fit the
   *  header plus a couple of table rows, break first so a title
   *  never strands alone at a page bottom. */
  function sectionHeader(title: string): void {
    const pageHeight = doc.internal.pageSize.getHeight();
    if (cursorY + 80 > pageHeight - 36) {
      doc.addPage();
      cursorY = 36;
    }
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

  /** Muted single-line note under a section header. */
  function sectionNote(text: string): void {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(text, marginX, cursorY + 4, { maxWidth: contentWidth });
    cursorY += 18;
  }

  /** Read autoTable's post-render finalY off the runtime-only
   *  `lastAutoTable` field (jspdf-autotable adds it but it's not on
   *  the public type), then bump the cursor for whatever's next. */
  function bumpCursorAfterTable(extra = 4): void {
    const finalY = (
      doc as unknown as { lastAutoTable?: { finalY: number } }
    ).lastAutoTable?.finalY;
    if (typeof finalY === "number") cursorY = finalY + extra;
  }

  /** Labeled key/value sub-table (dark header strip). */
  function subTable(title: string, rows: Array<[string, string]>): void {
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

  /* ────────── Document header + Overview ────────── */

  documentHeader();

  const path = scholarship?.isNotParticipating
    ? "Opted out of the Opportunity Scholarship"
    : scholarship?.isSNAPBenefits
      ? "SNAP benefits pre-qualified"
      : scholarship?.isOpportunityScholarship
        ? "Full Opportunity Scholarship application"
        : "No scholarship path on file";

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
      ["Financial Aid verification", faStamp],
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

  /* ────────── Step Up For Students (per student) ────────── */

  sectionHeader("Step Up For Students");
  if (activeApps.length === 0) {
    sectionNote("No active applications on file for this year.");
  } else {
    // Prefer the canonical stored `sufs_amount` (written by the
    // per-student billing route — also the only home of a "custom"
    // tier's typed amount), falling back to the legacy
    // `sufs_award_amount` for rows that pre-date the column.
    const sufsAmountOf = (a: XanoApplicationByFamily): number | null =>
      a.sufs_amount ?? a.sufs_award_amount ?? null;
    const sufsSum = activeApps.reduce(
      (acc, a) => acc + (sufsAmountOf(a) ?? 0),
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
          "SUFS award tier",
          "SUFS status",
          "SUFS award ID",
          "SUFS amount",
          "Opp. award",
        ],
      ],
      body: activeApps.map((a) => {
        const sid = Number(a.registration_students_id);
        return [
          studentNameFor(sid),
          sufsTierLabel(a.sufs_type),
          fmtMaybe(a.sufs_status),
          a.sufs_award_id ? String(a.sufs_award_id) : "—",
          fmt$(sufsAmountOf(a)),
          fmt$(a.opportunity_scholarship_award_amount),
        ];
      }),
      foot: [
        [
          { content: "Totals", colSpan: 4, styles: { fontStyle: "bold" } },
          { content: fmt$(sufsSum), styles: { fontStyle: "bold" } },
          { content: fmt$(oppSum), styles: { fontStyle: "bold" } },
        ],
      ],
      theme: "striped",
      margin: { left: marginX, right: marginX },
      styles: { cellPadding: compactCellPadding },
      headStyles: { fillColor: [60, 60, 60], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 8.5 },
      footStyles: { fillColor: [240, 240, 240], textColor: 20, fontSize: 8.5 },
      columnStyles: {
        4: { halign: "right" },
        5: { halign: "right" },
      },
    });
    bumpCursorAfterTable(2);
    // Per-student award confirmation stamps — who locked each award
    // in and when. A caption line per confirmed student keeps the
    // table above narrow while preserving the audit trail.
    const confirmLines = activeApps
      .filter((a) => a.confirmed_scholarship === true)
      .map((a) => {
        const name = studentNameFor(Number(a.registration_students_id));
        const by = cleanAdminName(a.confirmed_scholarship_admin);
        const at = a.confirmed_scholarship_time;
        return `${name}: award confirmed${by ? ` by ${by}` : ""}${
          at ? ` · ${fmtDate(at)}` : ""
        }`;
      });
    if (confirmLines.length > 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(100);
      for (const line of confirmLines) {
        doc.text(line, marginX, cursorY + 8, { maxWidth: contentWidth });
        cursorY += 10;
      }
      cursorY += 4;
    }
  }

  /* ────────── Financial Aid Application ────────── */
  //
  // Sections + field labels below deliberately MIRROR the parent-
  // facing application (`/apply/year/[yearId]/scholarship`) so admin
  // reads this as the family's filled-in copy of the form they
  // submitted — same order, same wording:
  //   Household Information → Household Members with Income → Other
  //   Money Received Each Month → Savings, Property & Other Assets →
  //   Your Tuition Contribution.
  // Keep them in sync when the form's wording changes.

  sectionHeader(`Financial Aid Application — ${path}`);
  if (!scholarship) {
    sectionNote("No scholarship row on file for this family / year.");
  } else if (scholarship.isNotParticipating) {
    sectionNote(
      "Family opted out of the Opportunity Scholarship. No financial information was collected."
    );
  } else if (scholarship.isSNAPBenefits) {
    sectionNote(
      "Family pre-qualified via SNAP benefits — the award letter below stands in for the full financial application."
    );
  } else {
    /* ── Household Information ── */
    subTable("Household Information", [
      ["Number of Adults", String(scholarship.household_adults ?? 0)],
      ["Number of Children", String(scholarship.household_children ?? 0)],
      ["Household size", String(householdSize)],
      [
        "Household receives government benefits",
        scholarship.government_benefits ? "Yes" : "No",
      ],
      [
        "No household members earn income",
        scholarship.no_contributing_member ? "Yes" : "No",
      ],
    ]);

    // Government benefit rows carry the form's own "Type / Monthly
    // Amount" pair; the paperwork for each lands in Documents below.
    if (scholarship.government_benefits) {
      if (benefits.length === 0) {
        sectionNote("Benefits declared, but no benefit rows on file.");
      } else {
        autoTable(doc, {
          startY: cursorY,
          head: [["Government Benefit — Type", "Monthly Amount"]],
          body: benefits.map((b) => [
            fmtMaybe(b.type) === "—" ? "Government benefit" : b.type,
            fmt$(b.amount_monthly ?? 0),
          ]),
          foot: [
            [
              { content: "Total", styles: { fontStyle: "bold" } },
              {
                content: fmt$(
                  benefits.reduce((a, b) => a + (b.amount_monthly ?? 0), 0)
                ),
                styles: { fontStyle: "bold", halign: "right" },
              },
            ],
          ],
          theme: "striped",
          margin: { left: marginX, right: marginX },
          styles: { cellPadding: compactCellPadding },
          headStyles: {
            fillColor: [60, 60, 60],
            textColor: 255,
            fontSize: 8.5,
          },
          bodyStyles: { fontSize: 8.5 },
          footStyles: { fillColor: [240, 240, 240], textColor: 20 },
          columnStyles: {
            0: { cellWidth: contentWidth * 0.6 },
            1: { cellWidth: contentWidth * 0.4, halign: "right" },
          },
        });
        bumpCursorAfterTable(4);
      }
    }

    /* ── Household Members with Income ── */
    sectionHeader("Household Members with Income");
    if (scholarship.no_contributing_member) {
      sectionNote(
        "Family declared that no household member earns income. Unemployment / termination paperwork is listed in Documents to Review."
      );
    } else if (members.length === 0) {
      sectionNote("No household members with income on file.");
    } else {
      autoTable(doc, {
        startY: cursorY,
        head: [
          [
            "First / Last Name",
            "Street Address",
            "City / State / ZIP",
            "Estimated Annual Income",
            "Income Verification",
          ],
        ],
        body: members.map((m) => [
          fmtMaybe(`${m.first_name ?? ""} ${m.last_name ?? ""}`),
          [m.address_1, m.address_2].filter(Boolean).join(", ") || "—",
          [m.city, m.state, m.zipcode].filter(Boolean).join(", ") || "—",
          fmt$(m.estimated_annual_income),
          m.isW2 ? "W-2" : m.isPayStubs ? "Pay stubs" : "—",
        ]),
        foot: [
          [
            {
              content: "Total estimated annual income",
              colSpan: 3,
              styles: { fontStyle: "bold" },
            },
            {
              content: fmt$(wagesAnnualIncome),
              styles: { fontStyle: "bold", halign: "right" },
            },
            { content: "" },
          ],
        ],
        theme: "striped",
        margin: { left: marginX, right: marginX },
        styles: { cellPadding: compactCellPadding },
        headStyles: { fillColor: [60, 60, 60], textColor: 255, fontSize: 8 },
        bodyStyles: { fontSize: 8.5 },
        footStyles: { fillColor: [240, 240, 240], textColor: 20, fontSize: 8.5 },
        columnStyles: {
          0: { cellWidth: contentWidth * 0.2 },
          1: { cellWidth: contentWidth * 0.24 },
          2: { cellWidth: contentWidth * 0.22 },
          3: { cellWidth: contentWidth * 0.19, halign: "right" },
          4: { cellWidth: contentWidth * 0.15 },
        },
      });
      bumpCursorAfterTable(4);
    }

    /* ── Other Money Your Household Receives Each Month ── */
    const incomeRows: Array<[string, string]> = [
      [
        "Money from a Business or Side Job",
        fmt$(scholarship.business_income_monthly),
      ],
      ["Money from Investments", fmt$(scholarship.capital_gains_monthly)],
      ["Child Support", fmt$(scholarship.child_support_monthly)],
      ["Alimony / Spousal Support", fmt$(scholarship.alimony_monthly)],
      ["Money from Trusts or Inheritance", fmt$(scholarship.trusts_monthly)],
      ["Other Income", fmt$(scholarship.other_income_monthly)],
    ];
    const otherDesc = (scholarship.describe_other_income ?? "").trim();
    if (otherDesc.length > 0) {
      incomeRows.push(["Describe Other Income", otherDesc]);
    }
    incomeRows.push([
      "Total per month",
      `${fmt$(passiveMonthlyIncome)}/mo → ${fmt$(passiveAnnualIncome)}/yr`,
    ]);
    subTable("Other Money Your Household Receives Each Month", incomeRows);

    /* ── Savings, Property & Other Assets ── */
    subTable("Savings, Property & Other Assets", [
      ["Money in Checking Accounts", fmt$(scholarship.assets_checking)],
      ["Money in Savings Accounts", fmt$(scholarship.assets_savings)],
      [
        "Retirement Accounts (401k, IRA)",
        fmt$(scholarship.assets_retirement_savings),
      ],
      [
        "Investments (Stocks or Bonds)",
        fmt$(scholarship.assets_stocks_bonds_securities),
      ],
      [
        "Trust Funds or Inheritance",
        fmt$(scholarship.assets_trusts_inheritance),
      ],
      ["Money in a Business You Own", fmt$(scholarship.assets_business)],
      ["Total liquid assets", fmt$(liquidAssets)],
    ]);

    /** Array-backed sub-block (properties / vehicles) — renders a
     *  muted one-liner instead of an empty table when the family
     *  declared none. */
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
          headStyles: {
            fillColor: [60, 60, 60],
            textColor: 255,
            fontSize: 8.5,
          },
          bodyStyles: { fontSize: 8.5 },
          columnStyles: {
            2: { halign: "right" },
            3: { halign: "right" },
          },
        });
      }
      bumpCursorAfterTable(4);
    }

    arrayTable(
      ["Property — Type", "Address", "Total Value", "Outstanding Debt"],
      homes.map((h) => [
        fmtMaybe(h.type),
        [h.address_1, h.address_2, h.city, h.state, h.zipcode]
          .filter(Boolean)
          .join(", ") || "—",
        fmt$(h.total_value),
        fmt$(h.outstanding_debt),
      ]),
      "No property declared."
    );
    arrayTable(
      [
        "Vehicle — Type",
        "Year / Make / Model",
        "Total Value",
        "Remaining Debt",
      ],
      vehicles.map((v) => [
        fmtMaybe(v.type),
        [v.car_year, v.car_make, v.car_model].filter(Boolean).join(" ") || "—",
        fmt$(v.total_value),
        fmt$(v.remaining_debt),
      ]),
      "No vehicles declared."
    );

    subTable("Debts", [
      ["Credit Cards (total owed)", fmt$(scholarship.debts_credit_cards)],
      ["Student Loans (total owed)", fmt$(scholarship.debts_student_loans)],
      ["Other Loans (total owed)", fmt$(scholarship.debts_personal_loans)],
      ["Total debts", fmt$(totalDebts)],
    ]);

    /* ── Your Tuition Contribution ── */
    subTable("Your Tuition Contribution", [
      [
        "Amount the family can contribute per month",
        fmt$(scholarship.family_contribution_per_month),
      ],
    ]);
  }

  /* ────────── Documents to Review (clickable links) ────────── */

  sectionHeader("Documents to Review");
  if (!scholarship || scholarship.isNotParticipating) {
    sectionNote(
      "No documents required — the family is not on a scholarship documentation path."
    );
  } else {
    const docRows = buildDocRows({
      scholarship,
      members,
      benefits,
      adminNameByTeacherId,
    });
    if (docRows.length === 0) {
      sectionNote("No documents required for this family's scholarship path.");
    } else {
      // Flatten to one PDF table row per uploaded file. The doc
      // label + confirmation columns render on the first file's row
      // only, so multi-file documents read as one grouped block.
      // `linkByBodyRow` maps body-row index → vault URL for the
      // didParseCell (blue styling) + didDrawCell (link annotation)
      // hooks below.
      const body: string[][] = [];
      const linkByBodyRow = new Map<number, string>();
      const italicRows = new Set<number>();
      for (const row of docRows) {
        const label =
          row.sublabel && row.sublabel.length > 0
            ? `${row.label}\n${row.sublabel}`
            : row.label;
        const status = row.confirmable
          ? row.confirmed
            ? "Confirmed"
            : "Pending"
          : "—";
        const by = row.confirmedByName ?? "—";
        const at = fmtDate(row.confirmedAt);
        if (row.files.length === 0) {
          italicRows.add(body.length);
          body.push([label, row.emptyHint, status, by, at]);
          continue;
        }
        row.files.forEach((f, i) => {
          const name =
            typeof f.name === "string" && f.name.length > 0
              ? f.name
              : typeof f.path === "string" && f.path.length > 0
                ? f.path.split("/").pop() ?? `File ${i + 1}`
                : `File ${i + 1}`;
          const sizeKb =
            typeof f.size === "number"
              ? ` · ${(f.size / 1024).toFixed(0)} KB`
              : "";
          const url = fileViewUrl(f);
          if (url) linkByBodyRow.set(body.length, url);
          body.push([
            i === 0 ? label : "",
            `${name}${sizeKb}`,
            i === 0 ? status : "",
            i === 0 ? by : "",
            i === 0 ? at : "",
          ]);
        });
      }
      const confirmable = docRows.filter((r) => r.confirmable);
      const confirmedCount = confirmable.filter((r) => r.confirmed).length;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(80);
      doc.text(
        `${confirmedCount}/${confirmable.length} documents confirmed. File names link to the uploaded document — click to open.`,
        marginX,
        cursorY + 4,
        { maxWidth: contentWidth }
      );
      cursorY += 14;
      autoTable(doc, {
        startY: cursorY,
        head: [["Document", "File(s)", "Status", "Confirmed by", "Date"]],
        body,
        theme: "striped",
        margin: { left: marginX, right: marginX },
        styles: { cellPadding: compactCellPadding },
        headStyles: { fillColor: [60, 60, 60], textColor: 255, fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: contentWidth * 0.27 },
          1: { cellWidth: contentWidth * 0.36 },
          2: { cellWidth: contentWidth * 0.11 },
          3: { cellWidth: contentWidth * 0.16 },
          4: { cellWidth: contentWidth * 0.1 },
        },
        didParseCell: (data) => {
          if (data.section !== "body") return;
          // Blue + bold file names that carry a link so the click
          // affordance survives on screen; italic-muted empty hints.
          if (data.column.index === 1 && linkByBodyRow.has(data.row.index)) {
            data.cell.styles.textColor = LINK_COLOR;
          }
          if (italicRows.has(data.row.index)) {
            if (data.column.index === 1) {
              data.cell.styles.fontStyle = "italic";
              data.cell.styles.textColor = 130;
            }
          }
          if (data.column.index === 2 && data.cell.raw === "Confirmed") {
            data.cell.styles.textColor = [22, 130, 70];
            data.cell.styles.fontStyle = "bold";
          }
        },
        // Attach the actual PDF link annotation over the file cell.
        // didDrawCell fires with page-local coordinates after the
        // page break logic ran, so links land on the right page.
        didDrawCell: (data) => {
          if (data.section !== "body" || data.column.index !== 1) return;
          const url = linkByBodyRow.get(data.row.index);
          if (!url) return;
          doc.link(
            data.cell.x,
            data.cell.y,
            data.cell.width,
            data.cell.height,
            { url }
          );
        },
      });
      bumpCursorAfterTable(4);
    }
  }

  /* ────────── Advocacy Letter + Signature ────────── */

  if (scholarship && !scholarship.isNotParticipating && !scholarship.isSNAPBenefits) {
    sectionHeader("Advocacy Letter & Signature");
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
    bumpCursorAfterTable(8);

    // Signature line — typed full name plus a clickable link to the
    // drawn-signature image in the vault when one is on file.
    const typedName = (scholarship.full_name_signature ?? "").trim();
    const signatureFile = scholarship.signature
      ? (scholarship.signature as XanoFileMetadata)
      : null;
    const signatureUrl = signatureFile ? fileViewUrl(signatureFile) : null;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text("SIGNATURE", marginX, cursorY + 6);
    cursorY += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    if (typedName.length > 0) {
      doc.setTextColor(20);
      doc.text(`Signed (typed): ${typedName}`, marginX, cursorY);
      cursorY += 13;
    }
    if (signatureUrl) {
      doc.setTextColor(...LINK_COLOR);
      doc.textWithLink("Open drawn signature", marginX, cursorY, {
        url: signatureUrl,
      });
      cursorY += 13;
    } else if (typedName.length === 0) {
      doc.setFont("helvetica", "italic");
      doc.setTextColor(120);
      doc.text("No signature on file.", marginX, cursorY);
      cursorY += 13;
    }
    // Section verification stamp — mirrors the card footer on the
    // page ("Verified by Mr. Thompson · Mon, Aug 10th").
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(faVerified ? 22 : 150, faVerified ? 130 : 150, faVerified ? 70 : 150);
    doc.text(`Financial Aid section: ${faStamp}`, marginX, cursorY + 2);
    cursorY += 14;
  }

  /* ────────── Award Determination ────────── */

  sectionHeader("Award Determination Inputs");
  subTable("Computed Family Financial Picture", [
    ["Household size", String(householdSize)],
    ["Wages (contributing members, annual)", fmt$(wagesAnnualIncome)],
    [
      "Passive income (monthly × 12)",
      `${fmt$(passiveMonthlyIncome)}/mo → ${fmt$(passiveAnnualIncome)}`,
    ],
    ["Total annual income", fmt$(totalAnnualIncome)],
    ["Liquid assets", fmt$(liquidAssets)],
    ["Home equity (value − debt)", fmt$(homeEquity)],
    ["Vehicle equity (value − debt)", fmt$(vehicleEquity)],
    ["Total assets", fmt$(totalAssets)],
    ["Total debts", fmt$(totalDebts)],
    ["Net assets", fmt$(netAssets)],
    [
      "Matrix path",
      useNetAssetsMatrix
        ? "High-net-assets sliding scale (net assets > $100k)"
        : "Standard household-size × income matrix",
    ],
  ]);

  /* ────────── Tuition & Billing Summary ────────── */

  sectionHeader("Tuition & Billing Summary");
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
      ["SUFS scholarship awarded", fmt$(familyBillingTotals.sufsTotal)],
      ["Annual admin fees", fmt$(familyBillingTotals.annualFeeTotal)],
      ["Annual transportation", fmt$(familyPayment?.transportation_total)],
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

  // File-name pattern: `Family Name · 2026-2027 · Award Summary.pdf`.
  // Sanitize the family name so OS path separators don't leak in.
  const safeName = familyName.replace(/[/\\:*?"<>|]+/g, "").trim() || "Family";
  const year = schoolYear?.year_name ?? `Year ${yearId}`;
  doc.save(`${safeName} · ${year} · Award Summary.pdf`);
}
