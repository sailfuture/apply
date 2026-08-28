"use client";

import { LeadTriageSheet } from "@/components/admin/lead-triage";
import { formatUSPhone } from "@/lib/phone";
import type { AllLeadRow } from "@/app/api/admin/all-leads/route";

/** Display label per lead source — the sheet's title/subtitle use it. */
export const LEAD_SOURCE_LABEL: Record<AllLeadRow["source"], string> = {
  inquiry: "Inquiry",
  camp: "Summer Camp",
  visit: "Liability Waiver Visit",
  tasco: "TASCO",
};

/**
 * `AllLeadRow` → `LeadTriageSheet`. The mapping is fiddly in ways
 * worth doing once (TASCO has no parent-name column, camp has no
 * consent column), so every surface that opens a lead — All Leads,
 * and the family/application pages via LinkedLeadsButton — shares
 * this instead of keeping its own copy to drift.
 */
export function LeadRowSheet({
  row,
  onOpenChange,
  onChanged,
}: {
  row: AllLeadRow;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}) {
  return (
    <LeadTriageSheet
      open
      onOpenChange={onOpenChange}
      scope={{ source: row.source, id: row.id }}
      title={
        row.student_name ||
        row.parent_name ||
        `${LEAD_SOURCE_LABEL[row.source]} #${row.id}`
      }
      subtitle={[
        LEAD_SOURCE_LABEL[row.source],
        row.parent_name || null,
        formatUSPhone(row.phone) || null,
        row.detail || null,
      ]
        .filter(Boolean)
        .join(" · ")}
      rating={row.rating}
      isFollowedUp={row.followed_up}
      lastReachOut={row.last_reach_out || null}
      details={{
        student_name: row.student_name,
        // TASCO rows have no parent-name column — null hides the
        // input instead of offering an edit that can't save.
        parent_name: row.source === "tasco" ? null : row.parent_name,
        phone: row.phone,
        email: row.email,
        grade: row.grade_raw,
        school: row.school,
        opt_in: row.opt_in,
        // Camp has no consent column — implied by sign-up.
        opt_in_editable: row.source !== "camp",
      }}
      conversion={{
        family_id: row.converted_family_id,
        family_name: row.converted_family_name,
        stage: row.funnel_stage,
        converted_at: row.converted_at,
      }}
      leadStatus={row.lead_status}
      statusReason={row.status_reason}
      extraFields={row.extra_fields}
      onChanged={onChanged}
    />
  );
}
