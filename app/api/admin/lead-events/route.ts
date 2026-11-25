import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { isLeadEventSource } from "@/lib/lead-events";

/**
 * Lead ↔ recruitment-event links (`registration_lead_events`).
 *
 * GET  → every link (the table is small; the combobox filters).
 * PUT  { source, id, event: { id, title, date } | null }
 *      → sets this lead's one event (null clears it). Replaces any
 *        existing row(s) for the lead: create first, then delete the
 *        old ones, so a failed create never leaves the lead unlinked.
 */
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await xano.leadEvents.getAll());
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { admin } = await requireAdmin();
    const body = await req.json().catch(() => null);
    const source = body?.source;
    const id = Number(body?.id);
    if (!isLeadEventSource(source) || !Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid lead" }, { status: 400 });
    }
    const ev = body?.event;
    if (ev !== null && (typeof ev?.id !== "string" || !ev.id.trim())) {
      return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    }

    const existing = (await xano.leadEvents.getAll()).filter(
      (r) => r.lead_source === source && Number(r.lead_id) === id
    );
    let created = null;
    if (ev) {
      created = await xano.leadEvents.create({
        lead_source: source,
        lead_id: id,
        event_id: String(ev.id).trim().slice(0, 200),
        event_title: String(ev.title ?? "").trim().slice(0, 300),
        event_date: /^\d{4}-\d{2}-\d{2}$/.test(String(ev.date ?? ""))
          ? String(ev.date)
          : "",
        linked_by: admin.name || admin.email,
      });
    }
    for (const row of existing) await xano.leadEvents.remove(row.id);
    return NextResponse.json({ link: created });
  } catch (err) {
    return handleAdminError(err);
  }
}
