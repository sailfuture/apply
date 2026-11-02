import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { LEAD_NOTE_SOURCES, type LeadNoteSource } from "@/lib/xano";
import {
  buildLeadContactPatch,
  updateLead,
  type LeadAdminPatch,
  type LeadContactFields,
} from "@/lib/leads";
import { writeLeadConversion } from "@/lib/lead-conversion";
import {
  leadRefKey,
  loadLeadLinkIndex,
  loadLeadLinkRows,
  parseLeadRef,
  resolvePrimary,
} from "@/lib/lead-links";

/**
 * Admin writes for any recruitment lead, routed to the lead's own
 * source table:
 *
 *   PATCH { source, id, interest_level?, isFollowedUp?, opt_in?,
 *           student_name?, parent_name?, phone?, email?, grade?,
 *           school?, family_id?, status?, status_reason?,
 *           school_year_id?, camp_year_attended?, link_to? }
 *
 * `link_to` folds this lead under another as a duplicate:
 * `{ source, id }` links (always to that lead's PRIMARY, and this
 * lead's own members follow it, so groups stay one level deep);
 * `null` unlinks. See lib/lead-links.ts.
 *
 * `school_year_id` is the academic year the family is interested in
 * (FK to `registration_school_years`; 0 = unassigned). Hand-set from
 * the lead lists — never inferred from the submission date.
 *
 * `camp_year_attended` is the camp the student actually attended
 * (same FK target, camp leads only) — a record of what happened,
 * where `school_year_id` is a statement of intent.
 *
 * `status` is the lead's lifecycle bucket: "not_interested" (family
 * declined — pair it with a `status_reason`), "archived" (duplicate /
 * junk / test row parked off every board, reason optional) or
 * "active" (restore; "active" rather than "" because Xano drops
 * empty inputs). Only the
 * inquiry table is guaranteed to have the columns — the other three
 * need them added in Xano, and the echo check below warns when a
 * write didn't land.
 *
 * `family_id` is the manual conversion link — the
 * `registration_families` row this lead became (0 unlinks; the
 * columns clear with integer-0 sentinels because Xano skips empty
 * inputs). Routed through `writeLeadConversion` so the manual path,
 * the on-submit auto-matcher, and the re-match sweep all write and
 * echo-verify identically.
 *
 * Admin-owned triage fields, shared by all four lead tables:
 *   - `interest_level` — 1–5 conversion stars; 0 clears (integer 0 IS
 *     applied by Xano's field mapping, unlike empty strings/null)
 *   - `isFollowedUp`   — "we've reached out" flag
 *
 * Contact fields are generic; `buildLeadContactPatch` maps each onto
 * the source table's own columns (splitting names into first/last for
 * inquiry + camp). `opt_in` maps to `messaging_opt_in` (inquiry) or
 * `marketing_opt_in` (visit, tasco); camp has no consent column, so
 * `opt_in` on a camp lead is a 400.
 *
 * `last_reach_out` is deliberately NOT writable here — it's stamped
 * server-side when a note is added (see `/api/admin/notes`), so it
 * stays an honest record of contact rather than a hand-editable field.
 *
 * The response echoes the updated row, plus a `warning` string when
 * part of the write couldn't land (blank values Xano skips, or a
 * column the Xano edit endpoint dropped because its input isn't
 * wired) — the editor toasts it so a silent no-op never reads as
 * saved.
 */
const CONTACT_STRING_FIELDS = [
  "student_name",
  "parent_name",
  "phone",
  "email",
  "grade",
  "school",
] as const;

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const source = body?.source as LeadNoteSource;
    const id = Number(body?.id);
    if (!LEAD_NOTE_SOURCES.includes(source) || !Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { error: "source (inquiry|camp|visit|tasco) and id are required" },
        { status: 400 }
      );
    }

    const patch: LeadAdminPatch & Record<string, unknown> = {};
    if ("interest_level" in body) {
      const v = body.interest_level;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 5) {
        return NextResponse.json(
          { error: "interest_level must be an integer from 0 to 5" },
          { status: 400 }
        );
      }
      patch.interest_level = v;
    }
    if ("isFollowedUp" in body) {
      if (typeof body.isFollowedUp !== "boolean") {
        return NextResponse.json(
          { error: "isFollowedUp must be a boolean" },
          { status: 400 }
        );
      }
      patch.isFollowedUp = body.isFollowedUp;
    }

    // Academic year the family is interested in — a hand-assigned FK
    // to `registration_school_years`. 0 clears it back to unassigned
    // (integer 0 DOES land on a Xano reference column, unlike an
    // empty string). Verified in the echo check below like the rest.
    const yearPatch: Record<string, number> = {};
    if ("school_year_id" in body) {
      const v = body.school_year_id;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        return NextResponse.json(
          {
            error:
              "school_year_id must be a non-negative integer (0 = unassigned)",
          },
          { status: 400 }
        );
      }
      yearPatch.registration_school_years_id = v;
    }
    // Which summer camp the student actually attended — camp rows
    // only (the other three sources have no camp to attend, so this
    // is a 400 rather than a write Xano would silently drop). Also
    // an FK to `registration_school_years`; 0 clears it.
    if ("camp_year_attended" in body) {
      if (source !== "camp") {
        return NextResponse.json(
          {
            error: `camp_year_attended only applies to summer-camp leads, not ${source}.`,
          },
          { status: 400 }
        );
      }
      const v = body.camp_year_attended;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        return NextResponse.json(
          {
            error:
              "camp_year_attended must be a non-negative integer (0 = not recorded)",
          },
          { status: 400 }
        );
      }
      yearPatch.summer_camp_year_attended = v;
    }
    Object.assign(patch, yearPatch);

    // Lifecycle status + decline reason. Folded into the main patch
    // AND the echo verification below (via `verifyPatch`) so a source
    // table missing the columns warns instead of silently no-oping.
    const statusPatch: Record<string, string> = {};
    if ("status" in body) {
      if (
        body.status !== "active" &&
        body.status !== "not_interested" &&
        body.status !== "archived"
      ) {
        return NextResponse.json(
          { error: 'status must be "active", "not_interested" or "archived"' },
          { status: 400 }
        );
      }
      statusPatch.status = body.status;
    }
    if ("status_reason" in body) {
      if (typeof body.status_reason !== "string" || !body.status_reason.trim()) {
        return NextResponse.json(
          { error: "status_reason must be a non-empty string" },
          { status: 400 }
        );
      }
      statusPatch.status_reason = body.status_reason.trim();
    }
    Object.assign(patch, statusPatch);

    // Duplicate-lead link. Resolved against the live index so a link
    // to an already-linked lead lands on its primary, and a lead
    // being folded under someone else takes its own members along.
    const linkPatch: Record<string, string | number> = {};
    if ("link_to" in body) {
      const v = body.link_to;
      if (v === null || v === 0) {
        linkPatch.linked_to_id = 0;
      } else {
        const target = parseLeadRef(v);
        if (!target) {
          return NextResponse.json(
            { error: "link_to must be { source, id } or null" },
            { status: 400 }
          );
        }
        if (target.source === source && target.id === id) {
          return NextResponse.json(
            { error: "A lead can't be linked to itself." },
            { status: 400 }
          );
        }
        const linkRows = await loadLeadLinkRows();
        if (!linkRows.rowsOf(target.source).some((r) => r.id === target.id)) {
          return NextResponse.json(
            { error: "That lead doesn't exist." },
            { status: 404 }
          );
        }
        const index = await loadLeadLinkIndex();
        const primary = resolvePrimary(index, target);
        if (primary.source === source && primary.id === id) {
          return NextResponse.json(
            { error: "That lead is already linked under this one." },
            { status: 400 }
          );
        }
        linkPatch.linked_to_source = primary.source;
        linkPatch.linked_to_id = primary.id;
        const own = index.membersOf.get(leadRefKey({ source, id })) ?? [];
        for (const m of own) {
          await updateLead(m.source, m.id, {
            linked_to_source: primary.source,
            linked_to_id: primary.id,
          });
        }
      }
    }
    Object.assign(patch, linkPatch);

    // Generic contact fields → the source table's own columns.
    const contactFields: LeadContactFields = {};
    for (const field of CONTACT_STRING_FIELDS) {
      if (field in body) {
        if (typeof body[field] !== "string") {
          return NextResponse.json(
            { error: `${field} must be a string` },
            { status: 400 }
          );
        }
        contactFields[field] = body[field];
      }
    }
    if ("opt_in" in body) {
      if (typeof body.opt_in !== "boolean") {
        return NextResponse.json(
          { error: "opt_in must be a boolean" },
          { status: 400 }
        );
      }
      contactFields.opt_in = body.opt_in;
    }
    const { patch: contactPatch, unsupported, skippedEmpty } =
      buildLeadContactPatch(source, contactFields);
    if (unsupported.length > 0) {
      return NextResponse.json(
        {
          error: `${unsupported.join(", ")} can't be edited on ${source} leads — the table has no such column.`,
        },
        { status: 400 }
      );
    }
    Object.assign(patch, contactPatch);

    // Conversion link — written through the shared helper (its own
    // updateLead call) so the stamp/clear sentinels + inquiry status
    // side-effect + echo verification match the auto-match paths.
    let conversionRow: Record<string, unknown> | null = null;
    let conversionWarning: string | null = null;
    if ("family_id" in body) {
      const v = body.family_id;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        return NextResponse.json(
          { error: "family_id must be a non-negative integer (0 unlinks)" },
          { status: 400 }
        );
      }
      const { row, dropped } = await writeLeadConversion(source, id, v);
      conversionRow = row;
      if (dropped.length > 0) {
        conversionWarning = `Xano ignored ${dropped.join(", ")} — expose these as inputs on the ${source} table's edit endpoint.`;
      }
    }

    if (
      Object.keys(patch).length === 0 &&
      skippedEmpty.length === 0 &&
      conversionRow === null
    ) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated =
      Object.keys(patch).length > 0
        ? await updateLead(source, id, patch)
        : conversionRow;

    // Echo verification on the contact + status columns — Xano
    // silently drops inputs its edit endpoint doesn't declare, so a
    // mis-wired column would report success while saving nothing.
    // Booleans compare as booleans; everything else through String()
    // (Xano stores some phones as numbers).
    const verifyPatch = {
      ...contactPatch,
      ...statusPatch,
      ...yearPatch,
      ...linkPatch,
    };
    const row = (updated ?? {}) as Record<string, unknown>;
    const dropped =
      updated == null
        ? []
        : Object.entries(verifyPatch)
            .filter(([col, v]) =>
              typeof v === "boolean"
                ? Boolean(row[col]) !== v
                : String(row[col] ?? "") !== String(v ?? "")
            )
            .map(([col]) => col);

    const warnings: string[] = [];
    if (skippedEmpty.length > 0) {
      warnings.push(
        `${skippedEmpty.join(", ")} left blank — blank values can't be saved (Xano skips empty inputs).`
      );
    }
    if (dropped.length > 0) {
      warnings.push(
        `Xano ignored ${dropped.join(", ")} — expose these as inputs on the ${source} table's edit endpoint.`
      );
    }
    if (conversionWarning) warnings.push(conversionWarning);
    return NextResponse.json(
      warnings.length > 0
        ? { ...row, warning: warnings.join(" ") }
        : (updated ?? { ok: true })
    );
  } catch (err) {
    return handleAdminError(err);
  }
}
