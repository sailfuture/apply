"use client";

import useSWR from "swr";
import { LeadTriageSheet } from "@/components/admin/lead-triage";
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatUSPhone } from "@/lib/phone";
import type { AllLeadRow, LeadSource } from "@/app/api/admin/all-leads/route";

/**
 * The one way to open a lead's triage sheet from anywhere.
 *
 * Every recruitment surface — All Leads, Inquiries, Summer Camp,
 * Liability Waiver, TASCO, Campus Tours, the dashboard — shows the
 * same drawer for the same lead. They used to each map their own row
 * shape onto `LeadTriageSheet`'s props, which is how they drifted:
 * some passed `details`, none of the per-source pages passed the
 * conversion link or the lifecycle status, so an inquiry looked
 * different depending on where you clicked it.
 *
 * This component owns that mapping once and reads the ALL-LEADS feed
 * rather than any page's own row shape, because that feed carries the
 * derived facts the sheet needs (conversion link, funnel stage,
 * normalized lead status) which the per-source APIs don't compute.
 * The fetch is lazy — nothing loads until a lead is actually opened.
 *
 * Hosts that already hold an `AllLeadRow` (All Leads itself) can keep
 * rendering `LeadTriageSheet` directly; everyone else should use this.
 */

/** Full label per source — the sheet's subtitle and title fallback.
 *  Same vocabulary the lists use. */
export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  inquiry: "Inquiry",
  camp: "Summer Camp",
  visit: "Liability Waiver Visit",
  tasco: "TASCO",
};

export function LeadSheet({
  lead,
  onOpenChange,
  onChanged,
  extraFields,
  extraContent,
  headerBadges,
  onMissing,
}: {
  /** Which lead to show; null closes the sheet (nothing is fetched). */
  lead: { source: LeadSource; id: number } | null;
  onOpenChange: (open: boolean) => void;
  /** Fires after any write inside the sheet — hosts revalidate their
   *  own list here. The all-leads row backing the sheet refreshes
   *  itself, so hosts only need to refresh what THEY render. */
  onChanged?: () => void;
  /** Source-specific read-only facts to append to the details block
   *  (e.g. an inquiry's "About the student"). */
  extraFields?: Array<{ label: string; value: string }>;
  /** Source-specific markup a label/value pair can't carry — the
   *  liability waiver's signature image, for one. */
  extraContent?: React.ReactNode;
  /** Badges pinned beside the sheet title — for facts that must be
   *  seen first (a camp registration's "Carries EpiPen"). */
  headerBadges?: React.ReactNode;
  /** Called when the lead isn't in the feed — deleted, or pointed at
   *  by a stale FK. Hosts that can repair the link (Campus Tours)
   *  hook in here; without it the sheet simply stays closed. */
  onMissing?: () => void;
}) {
  const { data, isLoading, mutate } = useSWR<AllLeadRow[]>(
    lead ? "/api/admin/all-leads" : null,
    adminFetcher,
    {
      revalidateOnFocus: false,
      onSuccess: (rows) => {
        if (!lead || !onMissing) return;
        // Guard the shape before .some — a route that returned an
        // error payload would otherwise throw here.
        const found =
          Array.isArray(rows) &&
          rows.some((r) => r.source === lead.source && r.id === lead.id);
        if (!found) onMissing();
      },
    }
  );

  const row =
    lead && Array.isArray(data)
      ? (data.find((r) => r.source === lead.source && r.id === lead.id) ?? null)
      : null;

  if (!row) {
    // Cold feed: the all-leads aggregation can take a couple of
    // seconds, and returning null here left the FIRST click on a
    // page with zero feedback — the sheet seemed to ignore the
    // click. Open the shell immediately with a spinner instead; the
    // real content swaps in place when the feed lands (same
    // component, same position, so the slide-in doesn't replay).
    // Once the fetch settles without a match (deleted lead, stale
    // FK) `isLoading` is false: render nothing, exactly as before —
    // `onMissing` has already told hosts that can react.
    if (!lead || !isLoading) return null;
    return (
      <LeadTriageSheet
        open
        loading
        onOpenChange={onOpenChange}
        scope={{ source: lead.source, id: lead.id }}
        title={LEAD_SOURCE_LABEL[lead.source]}
        rating={0}
        isFollowedUp={false}
      />
    );
  }

  const label = LEAD_SOURCE_LABEL[row.source];
  return (
    <LeadTriageSheet
      open
      onOpenChange={onOpenChange}
      scope={{ source: row.source, id: row.id }}
      title={
        row.student_name || row.parent_name || `${label} #${row.id}`
      }
      subtitle={[
        label,
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
        // TASCO has no parent-name column — null hides the input
        // rather than offering an edit that can't save.
        parent_name: row.source === "tasco" ? null : row.parent_name,
        phone: row.phone,
        email: row.email,
        grade: row.grade_raw,
        school: row.school,
        opt_in: row.opt_in,
        // Camp has no consent column — sign-up is the implied consent.
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
      schoolYearId={row.school_year_id}
      extraFields={extraFields}
      extraContent={extraContent}
      headerBadges={headerBadges}
      onChanged={() => {
        void mutate();
        onChanged?.();
      }}
    />
  );
}
