import { xano, LEAD_NOTE_SOURCES, type LeadNoteSource } from "@/lib/xano";

/**
 * Duplicate-lead links. One family often shows up as several lead
 * records — two website inquiries, a camp sign-up and an inquiry, a
 * TASCO visit and a waiver — and each one carried its own notes,
 * texts and tours. A link folds the duplicates under ONE primary
 * lead: the All Leads board shows the primary alone (with a "linked"
 * count), the primary's activity log merges the others' history, its
 * text thread carries their texts and calls, and a conversion on any
 * member counts for the group.
 *
 * Storage is two columns on every lead table — `linked_to_source`
 * (inquiry|camp|visit|tasco) and `linked_to_id` (0 = not linked) —
 * pointing at the primary. Groups are kept ONE level deep: the
 * leads PATCH always links to the target's primary and re-points a
 * lead's own members when it gets linked under someone else. The
 * index below still flattens chains defensively, so a hand-edited
 * row can't hide a lead.
 *
 * Reversible by design: unlinking writes `linked_to_id: 0` and
 * nothing else changes — no rows are merged or deleted.
 */

export interface LeadRef {
  source: LeadNoteSource;
  id: number;
}

/** `${source}-${id}` — the same key the all-leads feed uses. */
export function leadRefKey(ref: LeadRef): string {
  return `${ref.source}-${ref.id}`;
}

/** `{ source, id }` from a request body / stored pair; null when it
 *  isn't a real lead reference. */
export function parseLeadRef(v: unknown): LeadRef | null {
  if (!v || typeof v !== "object") return null;
  const source = (v as { source?: unknown }).source;
  const id = Number((v as { id?: unknown }).id);
  if (!LEAD_NOTE_SOURCES.includes(source as LeadNoteSource)) return null;
  if (!Number.isInteger(id) || id <= 0) return null;
  return { source: source as LeadNoteSource, id };
}

/** The primary a lead row points at, or null when unlinked. */
export function leadLinkTarget(row: {
  linked_to_source?: string | null;
  linked_to_id?: number | string | null;
}): LeadRef | null {
  const id = Number(row.linked_to_id) || 0;
  if (id <= 0) return null;
  const source = (row.linked_to_source ?? "").trim() as LeadNoteSource;
  if (!LEAD_NOTE_SOURCES.includes(source)) return null;
  return { source, id };
}

interface LinkRow {
  id: number;
  linked_to_source?: string | null;
  linked_to_id?: number | string | null;
}

export interface LeadLinkRows {
  inquiries: LinkRow[];
  camps: LinkRow[];
  visits: LinkRow[];
  tascos: LinkRow[];
}

export interface LeadLinkIndex {
  /** Linked lead key → its primary (chains flattened to the root). */
  primaryOf: Map<string, LeadRef>;
  /** Primary key → the leads folded under it. */
  membersOf: Map<string, LeadRef[]>;
}

/** How many hops a (malformed) chain is followed before giving up. */
const MAX_CHAIN = 8;

/**
 * Pure index over the four lead tables. A lead whose pointer forms a
 * cycle, or points at a row that no longer exists, is treated as
 * unlinked rather than vanishing from every board.
 */
export function buildLeadLinkIndex(rows: LeadLinkRows): LeadLinkIndex {
  const target = new Map<string, LeadRef>();
  const exists = new Set<string>();
  const ingest = (source: LeadNoteSource, list: LinkRow[]) => {
    for (const r of list) {
      const key = `${source}-${r.id}`;
      exists.add(key);
      const t = leadLinkTarget(r);
      if (t && leadRefKey(t) !== key) target.set(key, t);
    }
  };
  ingest("inquiry", rows.inquiries);
  ingest("camp", rows.camps);
  ingest("visit", rows.visits);
  ingest("tasco", rows.tascos);

  const primaryOf = new Map<string, LeadRef>();
  const membersOf = new Map<string, LeadRef[]>();
  for (const [key, first] of target) {
    // Walk to the root. Stop at a missing row (dangling pointer) or
    // when the walk loops back — both mean "no usable primary".
    let cur: LeadRef | null = first;
    const seen = new Set<string>([key]);
    let hops = 0;
    while (cur) {
      const ck = leadRefKey(cur);
      if (!exists.has(ck) || seen.has(ck) || hops++ >= MAX_CHAIN) {
        cur = null;
        break;
      }
      seen.add(ck);
      const next = target.get(ck);
      if (!next) break; // ck is the root
      cur = next;
    }
    if (!cur) continue;
    primaryOf.set(key, cur);
    const [source, idStr] = key.split("-");
    const member: LeadRef = { source: source as LeadNoteSource, id: Number(idStr) };
    const pk = leadRefKey(cur);
    membersOf.set(pk, [...(membersOf.get(pk) ?? []), member]);
  }
  return { primaryOf, membersOf };
}

/** The lead a reference resolves to for thread / board purposes —
 *  its primary when linked, itself otherwise. */
export function resolvePrimary(index: LeadLinkIndex, ref: LeadRef): LeadRef {
  return index.primaryOf.get(leadRefKey(ref)) ?? ref;
}

/** All four lead tables, as the index needs them. Each read is the
 *  Data-Cached list the lead pages already use. */
export async function loadLeadLinkRows(): Promise<
  LeadLinkRows & {
    rowsOf: (source: LeadNoteSource) => LinkRow[];
  }
> {
  const [inquiries, camps, visits, tascos] = await Promise.all([
    xano.inquiries.getAll().catch(() => []),
    xano.summerCamp.getAll().catch(() => []),
    xano.websiteWaivers.getAll().catch(() => []),
    xano.tascoSummerVisits.getAll().catch(() => []),
  ]);
  const rows = { inquiries, camps, visits, tascos };
  return {
    ...rows,
    rowsOf: (source) =>
      source === "inquiry"
        ? rows.inquiries
        : source === "camp"
          ? rows.camps
          : source === "visit"
            ? rows.visits
            : rows.tascos,
  };
}

export async function loadLeadLinkIndex(): Promise<LeadLinkIndex> {
  return buildLeadLinkIndex(await loadLeadLinkRows());
}

/** The leads folded under this one (empty when it's not a primary,
 *  or is itself linked under another lead). */
export async function linkedLeadMembers(ref: LeadRef): Promise<LeadRef[]> {
  const index = await loadLeadLinkIndex();
  return index.membersOf.get(leadRefKey(ref)) ?? [];
}
