import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";
import type { XanoScholarship } from "@/lib/xano";
import {
  denyScholarshipAccess,
  pickAllowedFields,
} from "@/lib/scholarship-access";

// Fields the parent Financial Aid page is allowed to PATCH. Anything
// outside this list — the admin document-confirm flags
// (`is_snap_confirmed`, `is_unemployment_confirm`,
// `tax_document_confirm`), their audit stamps, `last_edited_admin`, the
// family / year foreign keys — is admin-owned and writable only through
// `/api/admin/scholarships/[id]`. Keep this in step with the PATCH
// bodies in `app/(dashboard)/apply/year/[yearId]/scholarship/page.tsx`:
// a field the page sends that's missing here is silently dropped.
const PARENT_FIELD_ALLOWLIST = [
  // Scholarship path
  "isNotParticipating",
  "isSNAPBenefits",
  "isOpportunityScholarship",
  // Household
  "household_adults",
  "household_children",
  "no_contributing_member",
  // Income
  "business_income_monthly",
  "capital_gains_monthly",
  "child_support_monthly",
  "alimony_monthly",
  "trusts_monthly",
  "other_income_monthly",
  "describe_other_income",
  // Assets
  "assets_checking",
  "assets_savings",
  "assets_retirement_savings",
  "assets_stocks_bonds_securities",
  "assets_trusts_inheritance",
  "assets_business",
  // Debts
  "debts_credit_cards",
  "debts_student_loans",
  "debts_personal_loans",
  // Benefits + contribution
  "government_benefits",
  "family_contribution_per_month",
  // Uploaded documents
  "snap_benefits",
  "other_benefits",
  "unemployment_letter",
  "tax_return",
  // Certification
  "scholarship_advocacy_letter",
  "signature",
  "full_name_signature",
] as const satisfies ReadonlyArray<keyof XanoScholarship>;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  // Ownership guard — admin or owning family only (prevents IDOR).
  const denied = await denyScholarshipAccess(id);
  if (denied) return denied;

  // Return the WRAPPED shape the parent Financial Aid edit page expects:
  // `{ opportunity_scholarship, homes, vehicles, contributing_members,
  // benefits }`. `getById` unwraps to the flat scholarship row (no child
  // arrays + no `opportunity_scholarship` key), which made the edit
  // page's hydrate guard bail and render an EMPTY form — parents then
  // re-entered everything and resubmitted, creating duplicate child rows
  // (contributing members, etc.). `getByIdWithChildren` returns the
  // normalized children in one round trip.
  const full = await xano.scholarship.getByIdWithChildren(id);
  return NextResponse.json({
    opportunity_scholarship: full.scholarship,
    homes: full.homes,
    vehicles: full.vehicles,
    contributing_members: full.contributing_members,
    benefits: full.benefits,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  // Ownership guard — admin or owning family only (prevents IDOR).
  const denied = await denyScholarshipAccess(id);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const patch = pickAllowedFields(body, PARENT_FIELD_ALLOWLIST);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No editable fields in body" },
      { status: 400 }
    );
  }
  // Server-stamped rather than taken from the body, same as the admin
  // scholarships route.
  patch.last_edited = Date.now();

  const updated = await xano.scholarship.update(id, patch);
  return NextResponse.json(updated);
}
