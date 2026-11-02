"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Circle, CircleDot, Link2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatUSPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { AllLeadRow, LeadSource } from "@/app/api/admin/all-leads/route";

/**
 * "Find duplicates" — scans the lead board for records that share a
 * parent phone or email across any of the four sources and proposes
 * them as groups. Nothing is linked until the admin clicks Link on a
 * group, and the primary is a radio they can change first (default:
 * the converted one, else the website inquiry, else the oldest).
 *
 * Groups split into two lists. "Same student" groups share a
 * student first name (or some members have no student name) — the
 * ordinary duplicate. "Same contact, different students" groups
 * share a phone or email but name different children — siblings, a
 * grandparent signing up two families, or a shared number — and are
 * shown apart so a shared phone never quietly merges two kids.
 */

const SOURCE_SHORT: Record<LeadSource, string> = {
  inquiry: "Inquiry",
  camp: "Camp",
  visit: "Visit",
  tasco: "TASCO",
};

interface DupGroup {
  key: string;
  rows: AllLeadRow[];
  matchedOn: ("phone" | "email")[];
  sameStudent: boolean;
  defaultPrimary: string;
}

function normPhone(raw: string): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? ten : "";
}

function normEmail(raw: string): string {
  const e = String(raw ?? "").trim().toLowerCase();
  return e.includes("@") ? e : "";
}

function studentFirst(name: string): string {
  return String(name ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
}

/** Union-find over phone + email keys. Archived rows and rows already
 *  folded under a primary are out; primaries with members stay in
 *  (they can still match a third record). */
export function findDuplicateGroups(rows: AllLeadRow[]): DupGroup[] {
  const candidates = rows.filter(
    (r) => r.lead_status !== "archived" && !r.linked_to
  );
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let cur = k;
    while (parent.get(cur) !== cur) {
      const p = parent.get(cur)!;
      parent.set(cur, parent.get(p)!);
      cur = p;
    }
    return cur;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const r of candidates) parent.set(r.key, r.key);

  const byPhone = new Map<string, string[]>();
  const byEmail = new Map<string, string[]>();
  for (const r of candidates) {
    const p = normPhone(r.phone);
    if (p) byPhone.set(p, [...(byPhone.get(p) ?? []), r.key]);
    const e = normEmail(r.email);
    if (e) byEmail.set(e, [...(byEmail.get(e) ?? []), r.key]);
  }
  for (const keys of byPhone.values()) {
    for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
  }
  for (const keys of byEmail.values()) {
    for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
  }

  const members = new Map<string, AllLeadRow[]>();
  for (const r of candidates) {
    const root = find(r.key);
    members.set(root, [...(members.get(root) ?? []), r]);
  }

  const groups: DupGroup[] = [];
  for (const [root, list] of members) {
    if (list.length < 2) continue;
    const phones = new Set(list.map((r) => normPhone(r.phone)).filter(Boolean));
    const emails = new Set(list.map((r) => normEmail(r.email)).filter(Boolean));
    const matchedOn: ("phone" | "email")[] = [];
    if (phones.size < list.filter((r) => normPhone(r.phone)).length) {
      matchedOn.push("phone");
    }
    if (emails.size < list.filter((r) => normEmail(r.email)).length) {
      matchedOn.push("email");
    }
    const firsts = new Set(
      list.map((r) => studentFirst(r.student_name)).filter(Boolean)
    );
    const sameStudent = firsts.size <= 1;
    const sorted = [...list].sort((a, b) => a.submitted_ts - b.submitted_ts);
    const defaultPrimary =
      sorted.find((r) => r.converted_family_id > 0) ??
      sorted.find((r) => r.linked_leads.length > 0) ??
      sorted.find((r) => r.source === "inquiry") ??
      sorted[0];
    groups.push({
      key: root,
      rows: sorted,
      matchedOn,
      sameStudent,
      defaultPrimary: defaultPrimary.key,
    });
  }
  // Most-recent activity first, so the live duplicates surface.
  groups.sort(
    (a, b) =>
      Math.max(...b.rows.map((r) => r.submitted_ts)) -
      Math.max(...a.rows.map((r) => r.submitted_ts))
  );
  return groups;
}

export function LeadDuplicatesDialog({
  open,
  onOpenChange,
  rows,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: AllLeadRow[];
  /** Fired after a group is linked — the host revalidates the feed,
   *  which re-runs the scan without the rows that just folded. */
  onLinked: () => void;
}) {
  const groups = useMemo(() => findDuplicateGroups(rows), [rows]);
  const [primaryChoice, setPrimaryChoice] = useState<Record<string, string>>(
    {}
  );
  const [linking, setLinking] = useState<string | null>(null);

  const same = groups.filter((g) => g.sameStudent);
  const different = groups.filter((g) => !g.sameStudent);

  async function linkGroup(group: DupGroup) {
    const primaryKey = primaryChoice[group.key] ?? group.defaultPrimary;
    const primary = group.rows.find((r) => r.key === primaryKey);
    if (!primary) return;
    setLinking(group.key);
    try {
      for (const r of group.rows) {
        if (r.key === primary.key) continue;
        const res = await fetch("/api/admin/leads", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: r.source,
            id: r.id,
            link_to: { source: primary.source, id: primary.id },
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error ?? `Link failed (${res.status})`);
        }
        if (data?.warning) toast.warning(data.warning);
      }
      toast.success(
        `${group.rows.length - 1} lead${group.rows.length - 1 === 1 ? "" : "s"} linked under ${primary.student_name || primary.parent_name || SOURCE_SHORT[primary.source]}.`
      );
      onLinked();
    } catch (err) {
      console.error("[LeadDuplicatesDialog.linkGroup]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't link those leads."
      );
    } finally {
      setLinking(null);
    }
  }

  function renderGroup(group: DupGroup) {
    const primaryKey = primaryChoice[group.key] ?? group.defaultPrimary;
    const primary = group.rows.find((r) => r.key === primaryKey);
    const busy = linking === group.key;
    return (
      <div key={group.key} className="rounded-md border bg-white">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
          <span>
            Same {group.matchedOn.join(" and ") || "contact"} ·{" "}
            {group.rows.length} records
          </span>
          <span>Pick the primary, then link</span>
        </div>
        <ul className="divide-y">
          {group.rows.map((r) => {
            const isPrimary = r.key === primaryKey;
            return (
              <li key={r.key}>
                <button
                  type="button"
                  disabled={busy || linking !== null}
                  onClick={() =>
                    setPrimaryChoice((prev) => ({ ...prev, [group.key]: r.key }))
                  }
                  className={cn(
                    "flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted/40",
                    isPrimary && "bg-muted/30"
                  )}
                  title={isPrimary ? "Primary" : "Make this the primary"}
                >
                  {isPrimary ? (
                    <CircleDot className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">
                        {r.student_name || "—"}
                      </span>
                      <Badge variant="outline" className="px-1 py-0 text-[10px]">
                        {SOURCE_SHORT[r.source]}
                      </Badge>
                      {r.converted_family_name ? (
                        <Badge className="bg-emerald-100 px-1 py-0 text-[10px] text-emerald-800 hover:bg-emerald-100">
                          {r.converted_family_name}
                        </Badge>
                      ) : null}
                      {r.linked_leads.length > 0 ? (
                        <Badge variant="outline" className="px-1 py-0 text-[10px] text-muted-foreground">
                          <Link2 className="mr-0.5 size-3" />
                          {r.linked_leads.length}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[
                        r.parent_name,
                        formatUSPhone(r.phone) || r.phone,
                        r.email,
                        r.submitted_ts
                          ? new Date(r.submitted_ts).toLocaleDateString()
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end border-t px-3 py-2">
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={!primary || linking !== null}
            onClick={() => void linkGroup(group)}
          >
            {busy ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : (
              <Link2 className="size-3.5 mr-1.5" />
            )}
            Link under{" "}
            {primary?.student_name ||
              primary?.parent_name ||
              (primary ? SOURCE_SHORT[primary.source] : "primary")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => linking === null && onOpenChange(o)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Possible duplicate leads</DialogTitle>
          <DialogDescription>
            Leads sharing a parent phone or email. Linking folds the
            others under the primary — nothing is deleted, and a link
            can be undone from the lead&rsquo;s sheet.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
          {groups.length === 0 ? (
            <p className="rounded-md border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
              No duplicates found — every phone and email on the board
              belongs to one lead.
            </p>
          ) : null}
          {same.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Same student · {same.length}
              </h3>
              {same.map(renderGroup)}
            </section>
          ) : null}
          {different.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Same contact, different students · {different.length}
              </h3>
              <p className="text-xs text-muted-foreground">
                Siblings or a shared number — link only if they really
                are one family&rsquo;s records.
              </p>
              {different.map(renderGroup)}
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
