"use client";

import Link from "next/link";
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
import { adminFetcher } from "@/lib/admin-fetcher";
import type { LinkedLeadRow } from "@/app/api/admin/families/[id]/leads/route";

/**
 * "View inquiry" — surfaces the recruitment lead(s) this family
 * converted FROM, right on the family/application detail page. Renders
 * nothing while loading or when the family has no linked leads (most
 * pre-conversion-feature families), so the header row doesn't jump.
 *
 * One linked lead links straight to its triage sheet on All Leads
 * (`?open=<key>`); several become a small dropdown, one item per lead.
 */
export function LinkedLeadsButton({ familyId }: { familyId: number }) {
  const { data } = useSWR<LinkedLeadRow[]>(
    familyId > 0 ? `/api/admin/families/${familyId}/leads` : null,
    adminFetcher
  );
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return null;

  if (rows.length === 1) {
    const lead = rows[0];
    return (
      <Button asChild variant="outline" size="sm" className="bg-white">
        <Link
          href={`/admin/all-leads?open=${encodeURIComponent(lead.key)}`}
          title={`${lead.label}${lead.name ? ` — ${lead.name}` : ""}`}
        >
          <MessageSquare className="size-3.5 mr-1.5" />
          {lead.source === "inquiry" ? "View inquiry" : "View lead"}
        </Link>
      </Button>
    );
  }

  return (
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
          <DropdownMenuItem key={lead.key} asChild>
            <Link
              href={`/admin/all-leads?open=${encodeURIComponent(lead.key)}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm">
                  {lead.name || lead.key}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {lead.label}
                </span>
              </span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
