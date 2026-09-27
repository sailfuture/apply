import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import type {
  XanoSchoolCalendarDay,
  XanoSchoolCalendarEvent,
} from "@/lib/xano";

/** One family's sign-up for an event, with what they said they'd
 *  bring. A family can hold item claims without an RSVP row (both are
 *  written together, but nothing enforces it), so `has_rsvp` tells the
 *  two apart rather than inventing a spot count. */
export interface AdminEventSignup {
  family_id: number;
  family_name: string;
  /** Parent full names in the family's own order. */
  parents: string[];
  has_rsvp: boolean;
  /** Parent spots reserved; 0 when `has_rsvp` is false. */
  spots: number;
  /** The parent's "who's coming" note. */
  comment: string;
  bringing: Array<{ item_id: number; label: string; quantity: number }>;
}

/** One thing the event needs, with every family that claimed some. */
export interface AdminEventItem {
  id: number;
  label: string;
  /** How many admin asked for. Always >= 1. */
  quantity: number;
  /** Sum of every family's claim. */
  claimed: number;
  claims: Array<{ family_id: number; family_name: string; quantity: number }>;
}

export type AdminEvent = XanoSchoolCalendarEvent & {
  /** The event's day, "YYYY-MM-DD" (events pin to a day row). */
  date: string;
  /** Families first by name — RSVP'd or holding a claim. */
  signups: AdminEventSignup[];
  /** Needs in the order admin listed them. */
  items: AdminEventItem[];
  /** Parent spots reserved across every RSVP. */
  spots_taken: number;
};

export interface AdminEventsResponse {
  events: AdminEvent[];
  /** The year's day rows, date-ascending — the shared event dialog
   *  resolves a picked date to its `school_calendar_id` from these. */
  days: XanoSchoolCalendarDay[];
}

/**
 * Every event on one school year's calendar, joined with its sign-ups:
 *
 *   GET /api/admin/events?yearId=Y → { events, days }
 *
 * RSVPs (`school_event_rsvps`) and item claims
 * (`registration_school_event_item_claims`) are both keyed by family
 * id, so this resolves family and parent names here once rather than
 * making the page cross-reference four tables.
 *
 * Days and events are required. Everything else degrades to empty, so
 * the page still lists events when a sign-up table is unreachable.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const yearId = Number(req.nextUrl.searchParams.get("yearId"));
    if (!Number.isFinite(yearId) || yearId <= 0) {
      return NextResponse.json(
        { error: "yearId is required" },
        { status: 400 }
      );
    }

    const [daysR, eventsR, rsvpsR, itemsR, claimsR, familiesR, parentsR] =
      await Promise.allSettled([
        xano.schoolCalendar.getByYear(yearId),
        xano.schoolCalendarEvents.getAll(),
        xano.eventRsvps.getAll(),
        xano.eventItems.getAll(),
        xano.eventItemClaims.getAll(),
        xano.families.getAll(),
        xano.parents.getAll(),
      ]);
    if (daysR.status === "rejected" || eventsR.status === "rejected") {
      const reason =
        daysR.status === "rejected"
          ? daysR.reason
          : (eventsR as PromiseRejectedResult).reason;
      console.error("[/api/admin/events] calendar load failed:", reason);
      return NextResponse.json(
        { error: "Couldn't load the calendar, please retry" },
        { status: 503 }
      );
    }
    for (const [label, r] of [
      ["rsvps", rsvpsR],
      ["items", itemsR],
      ["claims", claimsR],
      ["families", familiesR],
      ["parents", parentsR],
    ] as const) {
      if (r.status === "rejected") {
        console.error(`[/api/admin/events] failed to load ${label}:`, r.reason);
      }
    }
    const val = <T,>(r: PromiseSettledResult<T[]>): T[] =>
      r.status === "fulfilled" ? r.value : [];

    const days = daysR.value.sort((a, b) => a.date.localeCompare(b.date));
    const dateByDay = new Map(days.map((d) => [d.id, d.date]));

    // Family display: the family name, plus its parents' full names so
    // staff can see WHO is bringing something, not just which surname.
    const parentName = new Map(
      val(parentsR).map((p) => [
        p.id,
        `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      ])
    );
    const familyInfo = new Map(
      val(familiesR).map((f) => [
        f.id,
        {
          name: f.family_name?.trim() || `Family #${f.id}`,
          parents: xano.families
            .getParentIds(f)
            .map((id) => parentName.get(id) ?? "")
            .filter(Boolean),
        },
      ])
    );
    const familyOf = (id: number) =>
      familyInfo.get(id) ?? { name: `Family #${id}`, parents: [] };

    const itemsByEvent = new Map<number, AdminEventItem[]>();
    const eventByItem = new Map<number, number>();
    const sortedItems = [...val(itemsR)].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id
    );
    for (const it of sortedItems) {
      const eventId = Number(it.school_calendar_events_id);
      eventByItem.set(it.id, eventId);
      const list = itemsByEvent.get(eventId) ?? [];
      list.push({
        id: it.id,
        label: it.label,
        quantity: Math.max(1, Number(it.quantity) || 1),
        claimed: 0,
        claims: [],
      });
      itemsByEvent.set(eventId, list);
    }

    // Sign-ups keyed "event:family" — an RSVP row and that family's
    // claims on the same event fold into one row.
    const signups = new Map<string, AdminEventSignup>();
    const signupFor = (eventId: number, familyId: number) => {
      const key = `${eventId}:${familyId}`;
      let row = signups.get(key);
      if (!row) {
        const fam = familyOf(familyId);
        row = {
          family_id: familyId,
          family_name: fam.name,
          parents: fam.parents,
          has_rsvp: false,
          spots: 0,
          comment: "",
          bringing: [],
        };
        signups.set(key, row);
      }
      return row;
    };

    for (const r of val(rsvpsR)) {
      const row = signupFor(
        Number(r.school_calendar_events_id),
        Number(r.registration_families_id)
      );
      row.has_rsvp = true;
      row.spots += Number(r.spots) || 0;
      // " " is the table's clear-sentinel; trim folds it to empty.
      row.comment = (r.comment ?? "").trim();
    }

    for (const c of val(claimsR)) {
      const itemId = Number(c.registration_school_event_items_id);
      const quantity = Number(c.quantity) || 0;
      const eventId = eventByItem.get(itemId);
      if (eventId === undefined || quantity <= 0) continue;
      const item = itemsByEvent.get(eventId)?.find((i) => i.id === itemId);
      if (!item) continue;
      const familyId = Number(c.registration_families_id);
      const row = signupFor(eventId, familyId);
      item.claimed += quantity;
      // One claim row per (item, family) is the contract, but fold any
      // duplicate into the same line rather than listing a family twice.
      const claim = item.claims.find((x) => x.family_id === familyId);
      if (claim) claim.quantity += quantity;
      else
        item.claims.push({
          family_id: familyId,
          family_name: row.family_name,
          quantity,
        });
      const held = row.bringing.find((b) => b.item_id === itemId);
      if (held) held.quantity += quantity;
      else row.bringing.push({ item_id: itemId, label: item.label, quantity });
    }

    const signupsByEvent = new Map<number, AdminEventSignup[]>();
    for (const [key, row] of signups) {
      const eventId = Number(key.split(":")[0]);
      const list = signupsByEvent.get(eventId) ?? [];
      list.push(row);
      signupsByEvent.set(eventId, list);
    }

    const events: AdminEvent[] = eventsR.value
      .filter((e) => dateByDay.has(Number(e.school_calendar_id)))
      .map((e) => {
        const rows = (signupsByEvent.get(e.id) ?? []).sort((a, b) =>
          a.family_name.localeCompare(b.family_name)
        );
        // Bringing lists follow the needs list's order, not claim ids.
        const order = new Map(
          (itemsByEvent.get(e.id) ?? []).map((it, i) => [it.id, i])
        );
        for (const row of rows) {
          row.bringing.sort(
            (a, b) => (order.get(a.item_id) ?? 0) - (order.get(b.item_id) ?? 0)
          );
        }
        const items = itemsByEvent.get(e.id) ?? [];
        for (const it of items) {
          it.claims.sort((a, b) => a.family_name.localeCompare(b.family_name));
        }
        return {
          ...e,
          date: dateByDay.get(Number(e.school_calendar_id)) ?? "",
          signups: rows,
          items,
          spots_taken: rows.reduce((s, r) => s + r.spots, 0),
        };
      })
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          (a.start_time ?? 0) - (b.start_time ?? 0) ||
          a.id - b.id
      );

    return NextResponse.json({
      events,
      days,
    } satisfies AdminEventsResponse);
  } catch (err) {
    return handleAdminError(err);
  }
}
