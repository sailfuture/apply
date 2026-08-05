import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { leadConvertedFamilyId } from "@/lib/lead-conversion";

/**
 * Recruitment leads linked to one family — the reverse of the
 * conversion link the leads carry (`registration_families_id` on each
 * of the four lead tables). Backs the "View inquiry" button on the
 * family/application detail page, which deep-links each lead's triage
 * sheet on All Leads (`?open=<source>-<id>`).
 *
 * Deliberately light: just the four lead tables, no funnel joins —
 * this renders in the page header on every family visit.
 */

export interface LinkedLeadRow {
  /** All Leads deep-link key: `${source}-${id}`. */
  key: string;
  source: "inquiry" | "camp" | "visit" | "tasco";
  /** Full source label ("Inquiry", "Summer Camp", …). */
  label: string;
  /** Student name, falling back to parent name, falling back to "". */
  name: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id: idParam } = await params;
    const familyId = Number(idParam);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const [inquiries, campRows, waivers, tascoRows] = await Promise.all([
      xano.inquiries.getAll().catch(() => []),
      xano.summerCamp.getAll().catch(() => []),
      xano.websiteWaivers.getAll().catch(() => []),
      xano.tascoSummerVisits.getAll().catch(() => []),
    ]);

    const rows: LinkedLeadRow[] = [
      ...inquiries
        .filter((i) => leadConvertedFamilyId(i) === familyId)
        .map(
          (i): LinkedLeadRow => ({
            key: `inquiry-${i.id}`,
            source: "inquiry",
            label: "Inquiry",
            name:
              `${i.student_first_name ?? ""} ${i.student_last_name ?? ""}`.trim() ||
              `${i.primary_first_name ?? ""} ${i.primary_last_name ?? ""}`.trim(),
          })
        ),
      ...campRows
        .filter((c) => leadConvertedFamilyId(c) === familyId)
        .map(
          (c): LinkedLeadRow => ({
            key: `camp-${c.id}`,
            source: "camp",
            label: "Summer Camp",
            name:
              `${c.student_first_name ?? ""} ${c.student_last_name ?? ""}`.trim() ||
              `${c.primary_parent_first_name ?? ""} ${c.primary_parent_last_name ?? ""}`.trim(),
          })
        ),
      ...waivers
        .filter((w) => leadConvertedFamilyId(w) === familyId)
        .map(
          (w): LinkedLeadRow => ({
            key: `visit-${w.id}`,
            source: "visit",
            label: "Liability Waiver Visit",
            name: (w.student_name ?? "").trim() || (w.parent_name ?? "").trim(),
          })
        ),
      ...tascoRows
        .filter((t) => leadConvertedFamilyId(t) === familyId)
        .map(
          (t): LinkedLeadRow => ({
            key: `tasco-${t.id}`,
            source: "tasco",
            label: "TASCO",
            name: (t.student_name ?? "").trim(),
          })
        ),
    ];

    return NextResponse.json(rows);
  } catch (err) {
    return handleAdminError(err);
  }
}
