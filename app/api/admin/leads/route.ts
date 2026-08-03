import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { LEAD_NOTE_SOURCES, type LeadNoteSource } from "@/lib/xano";
import {
  buildLeadContactPatch,
  updateLead,
  type LeadAdminPatch,
  type LeadContactFields,
} from "@/lib/leads";

/**
 * Admin writes for any recruitment lead, routed to the lead's own
 * source table:
 *
 *   PATCH { source, id, interest_level?, isFollowedUp?, opt_in?,
 *           student_name?, parent_name?, phone?, email?, grade?,
 *           school? }
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

    if (Object.keys(patch).length === 0 && skippedEmpty.length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated =
      Object.keys(patch).length > 0
        ? await updateLead(source, id, patch)
        : null;

    // Echo verification on the contact columns — Xano silently drops
    // inputs its edit endpoint doesn't declare, so a mis-wired column
    // would report success while saving nothing. Booleans compare as
    // booleans; everything else through String() (Xano stores some
    // phones as numbers).
    const row = (updated ?? {}) as Record<string, unknown>;
    const dropped =
      updated == null
        ? []
        : Object.entries(contactPatch)
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
    return NextResponse.json(
      warnings.length > 0
        ? { ...row, warning: warnings.join(" ") }
        : (updated ?? { ok: true })
    );
  } catch (err) {
    return handleAdminError(err);
  }
}
