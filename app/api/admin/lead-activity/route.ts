import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import {
  xano,
  LEAD_NOTE_COLUMN,
  LEAD_NOTE_SOURCES,
  type LeadNoteSource,
} from "@/lib/xano";
import { counterpartyPhone, messageContactRef } from "@/lib/sms/contacts";
import { formatUSPhone } from "@/lib/phone";

/**
 * Recent activity across every recruitment lead — one merged, newest-
 * first stream of the two things that actually constitute "contact":
 * admin notes (calls, visits, logged context) and real text messages
 * in either direction.
 *
 * This is the dashboard's answer to "what's happened lately, and who
 * has gone quiet". It deliberately reads the same two tables the lead
 * triage sheet renders, so a row here and the sheet can't disagree.
 *
 * Rows carry the lead's `source` + `id`, so the client can deep-link
 * straight into that lead's triage sheet
 * (`/admin/all-leads?open=<source>-<id>`).
 */

export type LeadActivityKind = "note" | "sms_out" | "sms_in";

export interface LeadActivityRow {
  /** Stable render key. */
  key: string;
  source: LeadNoteSource;
  leadId: number;
  /** Lead display name, or the formatted phone when there's no name. */
  name: string;
  kind: LeadActivityKind;
  /** Note category ("Phone call") or the SMS direction label. */
  label: string;
  /** Note body or message text, truncated. */
  body: string;
  /** Who did it — note author; empty for inbound texts. */
  author: string;
  ts: number;
}

export interface LeadActivityResponse {
  rows: LeadActivityRow[];
  /** True when more activity exists than the returned slice — the UI
   *  says so rather than implying this is everything. */
  truncated: boolean;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const BODY_CHARS = 140;

/** Long-form labels for the note categories still present on rows;
 *  the composer only writes "other" and "sms" now, but historical
 *  notes carry the retired call/email/in-person values. */
const CATEGORY_LABEL: Record<string, string> = {
  phone: "Phone call",
  email: "Email",
  "in-person": "In-person",
  sms: "Text message",
  other: "Note",
};

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const limitParam = Number(req.nextUrl.searchParams.get("limit"));
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(limitParam, MAX_LIMIT)
        : DEFAULT_LIMIT;

    const [notesRes, msgsRes, inqRes, campRes, visitRes, tascoRes] =
      await Promise.allSettled([
        xano.adminNotes.getAllLeadNotes(),
        xano.smsMessages.getAll(),
        xano.inquiries.getAll(),
        xano.summerCamp.getAll(),
        xano.websiteWaivers.getAll(),
        xano.tascoSummerVisits.getAll(),
      ]);
    const val = <T,>(r: PromiseSettledResult<T[]>, label: string): T[] => {
      if (r.status === "fulfilled") return r.value;
      console.error(`[/api/admin/lead-activity] ${label} failed:`, r.reason);
      return [];
    };
    const notes = val(notesRes, "notes");
    const messages = val(msgsRes, "messages");
    const inquiries = val(inqRes, "inquiries");
    const camps = val(campRes, "camp");
    const visits = val(visitRes, "visits");
    const tascos = val(tascoRes, "tasco");

    // Name lookup per source, built once.
    const names: Record<LeadNoteSource, Map<number, string>> = {
      inquiry: new Map(
        inquiries.map((i) => [
          i.id,
          `${i.primary_first_name ?? ""} ${i.primary_last_name ?? ""}`.trim(),
        ])
      ),
      camp: new Map(
        camps.map((c) => [
          c.id,
          `${c.primary_parent_first_name ?? ""} ${c.primary_parent_last_name ?? ""}`.trim(),
        ])
      ),
      visit: new Map(
        visits.map((w) => [w.id, (w.parent_name ?? "").trim()])
      ),
      tasco: new Map(
        tascos.map((t) => {
          const s = (t.student_name ?? "").trim();
          return [t.id, s ? `Parent of ${s}` : ""];
        })
      ),
    };
    const nameFor = (source: LeadNoteSource, id: number, fallback: string) =>
      names[source].get(id)?.trim() ||
      fallback ||
      `${source === "inquiry" ? "Inquiry" : source === "camp" ? "Camp" : source === "visit" ? "Visit" : "TASCO"} #${id}`;

    const rows: LeadActivityRow[] = [];

    // Notes — one row per lead-scoped note.
    for (const n of notes) {
      for (const source of LEAD_NOTE_SOURCES) {
        const leadId = Number(n[LEAD_NOTE_COLUMN[source]]);
        if (!Number.isFinite(leadId) || leadId <= 0) continue;
        rows.push({
          key: `note-${n.id}`,
          source,
          leadId,
          name: nameFor(source, leadId, ""),
          kind: "note",
          label: CATEGORY_LABEL[n.category ?? "other"] ?? "Note",
          body: (n.body ?? "").trim().slice(0, BODY_CHARS),
          author: (n.author_name ?? "").trim(),
          ts: Number(n.created_at) || 0,
        });
        break; // exactly one lead FK is set per note
      }
    }

    // Texts — only those attributed to a lead (family threads belong
    // to the family surfaces, not the recruitment pipeline).
    for (const m of messages) {
      const contact = messageContactRef(m);
      if (!contact) continue;
      if (!LEAD_NOTE_SOURCES.includes(contact.type as LeadNoteSource)) {
        continue;
      }
      const source = contact.type as LeadNoteSource;
      const inbound = m.direction === "inbound";
      rows.push({
        key: `sms-${m.id}`,
        source,
        leadId: contact.id,
        name: nameFor(
          source,
          contact.id,
          formatUSPhone(counterpartyPhone(m)) || ""
        ),
        kind: inbound ? "sms_in" : "sms_out",
        label: inbound ? "Text received" : "Text sent",
        body: (m.body ?? "").trim().slice(0, BODY_CHARS),
        author: inbound ? "" : (m.author_name ?? "").trim(),
        ts: Number(m.created_at) || 0,
      });
    }

    rows.sort((a, b) => b.ts - a.ts);
    return NextResponse.json({
      rows: rows.slice(0, limit),
      truncated: rows.length > limit,
    } satisfies LeadActivityResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}
