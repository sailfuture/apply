"use client";

import { useState } from "react";
import useSWR from "swr";
import { ChevronDown, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LeadRowSheet, LEAD_SOURCE_LABEL } from "@/components/admin/lead-row-sheet";
import { adminFetcher } from "@/lib/admin-fetcher";
import type { AllLeadRow } from "@/app/api/admin/all-leads/route";

/**
 * "View inquiry" — surfaces the recruitment lead(s) this family
 * converted FROM, right on the family/application detail page.
 *
 * Opens the lead's triage sheet in place rather than navigating to
 * All Leads: the question being asked here is "what did this family
 * originally say?", which is context for the page you're on, not a
 * reason to leave it and lose your place. The sheet is the same one
 * All Leads opens, so notes and edits made here behave identically.
 *
 * Renders nothing while loading or when the family has no linked
 * leads (most pre-conversion-feature families), so the header row
 * doesn't jump. One lead gets a button; several get a dropdown.
 */
export function LinkedLeadsButton({ familyId }: { familyId: number }) {
  const { data, mutate } = useSWR<AllLeadRow[]>(
    familyId > 0 ? `/api/admin/all-leads?familyId=${familyId}` : null,
    adminFetcher,
    { revalidateOnFocus: false }
  );
  const [openKey, setOpenKey] = useState<string | null>(null);

  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return null;
  const active = rows.find((r) => r.key === openKey) ?? null;

  return (
    <>
      {rows.length === 1 ? (
        <Button
          variant="outline"
          size="sm"
          className="bg-white"
          title={`${LEAD_SOURCE_LABEL[rows[0].source]}${
            rows[0].student_name ? ` — ${rows[0].student_name}` : ""
          }`}
          onClick={() => setOpenKey(rows[0].key)}
        >
          <MessageSquare className="size-3.5 mr-1.5" />
          {rows[0].source === "inquiry" ? "View inquiry" : "View lead"}
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="bg-white">
              <MessageSquare className="size-3.5 mr-1.5" />
              View leads ({rows.length})
              <ChevronDown className="ml-1 size-3.5 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Converted from</DropdownMenuLabel>
            {rows.map((lead) => (
              <DropdownMenuItem
                key={lead.key}
                onSelect={() => setOpenKey(lead.key)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">
                    {lead.student_name || lead.parent_name || lead.key}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {LEAD_SOURCE_LABEL[lead.source]}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {active ? (
        <LeadRowSheet
          key={active.key}
          row={active}
          onOpenChange={(o) => !o && setOpenKey(null)}
          onChanged={() => void mutate()}
        />
      ) : null}
    </>
  );
}
