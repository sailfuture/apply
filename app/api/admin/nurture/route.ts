import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import {
  InvalidSettingError,
  writeForwardingSettings,
  writeNurtureSettings,
  writeSmsProvider,
} from "@/lib/app-settings";
import { loadNurtureInput } from "@/lib/nurture/run";
import {
  NURTURE_TEMPLATE_PREFIX,
  STEP_LABEL,
  buildLeads,
  leadKey,
  planNurture,
  projectUpcoming,
  type NurtureItem,
  type NurtureStep,
} from "@/lib/nurture/plan";
import * as tpl from "@/lib/nurture/templates";

/**
 * Admin Follow-ups page (Recruitment → Follow-ups).
 *
 * GET  — the switches plus a live preview built by the SAME planner
 *        the cron runs: texts due on the next run, texts held (and
 *        why), what comes due over the next 48 hours, what went out
 *        in the last 14 days, and every template with sample names.
 * PATCH — { enabled?, senderName?, forwardReplies? }.
 */
export const dynamic = "force-dynamic";

export interface NurturePreviewItem {
  key: string;
  source: string;
  leadId: number;
  parentName: string;
  studentName: string;
  step: NurtureStep;
  stepLabel: string;
  /** The dedupe key — unique per lead, so it keys table rows. */
  template: string;
  body: string;
  reason: string | null;
  /** Upcoming only: when it's expected to go out (unix ms). */
  at?: number;
}

export interface NurtureRecentItem {
  key: string;
  parentName: string;
  studentName: string;
  stepLabel: string;
  body: string;
  status: string;
  sentAt: number;
}

export interface NurtureOverview {
  settings: { enabled: boolean; senderName: string; startedAt: number | null };
  forwardReplies: boolean;
  inWindow: boolean;
  due: NurturePreviewItem[];
  held: NurturePreviewItem[];
  upcoming: NurturePreviewItem[];
  recent: NurtureRecentItem[];
  examples: Array<{ step: NurtureStep; label: string; body: string }>;
}

const RECENT_MS = 14 * 86_400_000;

function toPreview(item: NurtureItem, at?: number): NurturePreviewItem {
  return {
    key: leadKey(item.lead),
    source: item.lead.source,
    leadId: item.lead.id,
    parentName: item.lead.parentName,
    studentName: item.lead.studentName,
    step: item.step,
    stepLabel: STEP_LABEL[item.step],
    template: item.template,
    body: item.body,
    reason: item.reason,
    ...(at ? { at } : {}),
  };
}

/** "nurture:tour_reminder:12:…" → "tour_reminder". */
function stepOf(template: string): NurtureStep | null {
  const step = template.slice(NURTURE_TEMPLATE_PREFIX.length).split(":")[0];
  return step in STEP_LABEL ? (step as NurtureStep) : null;
}

export async function GET() {
  try {
    await requireAdmin();
    const input = await loadNurtureInput();
    const plan = planNurture(input);
    const leads = buildLeads(input);

    const recent: NurtureRecentItem[] = [];
    for (const m of input.messages) {
      const template = m.template ?? "";
      if (
        m.direction !== "outbound" ||
        !template.startsWith(NURTURE_TEMPLATE_PREFIX) ||
        m.created_at < input.now - RECENT_MS
      ) {
        continue;
      }
      const key = m.registration_inquiry_id
        ? `inquiry:${m.registration_inquiry_id}`
        : m.registration_summer_camp_id
          ? `camp:${m.registration_summer_camp_id}`
          : m.website_liability_waiver_id
            ? `visit:${m.website_liability_waiver_id}`
            : m.tasco_summer_visit_id
              ? `tasco:${m.tasco_summer_visit_id}`
              : "";
      const lead = leads.get(key);
      const step = stepOf(template);
      recent.push({
        key,
        parentName: lead?.parentName ?? "",
        studentName: lead?.studentName ?? "",
        stepLabel: step ? STEP_LABEL[step] : template,
        body: m.body,
        status: m.status,
        sentAt: m.created_at,
      });
    }
    recent.sort((a, b) => b.sentAt - a.sentAt);

    const sample = { parentFirst: "Maria", studentFirst: "Alex" };
    const examples: NurtureOverview["examples"] = [
      {
        step: "inquiry_day2",
        label: STEP_LABEL.inquiry_day2,
        body: tpl.inquiryDay2Sms({
          ...sample,
          senderName: input.settings.senderName,
        }),
      },
      {
        step: "inquiry_day7",
        label: STEP_LABEL.inquiry_day7,
        body: tpl.inquiryDay7Sms(sample),
      },
      {
        step: "tour_reminder",
        label: STEP_LABEL.tour_reminder,
        body: tpl.tourReminderSms({
          ...sample,
          // A sample slot: tomorrow, top of the hour.
          scheduledAt: Math.ceil((input.now + 86_400_000) / 3_600_000) * 3_600_000,
        }),
      },
      {
        step: "tour_thanks",
        label: STEP_LABEL.tour_thanks,
        body: tpl.tourThanksSms(sample),
      },
      {
        step: "tour_noshow",
        label: STEP_LABEL.tour_noshow,
        body: tpl.tourNoShowSms(sample),
      },
    ];

    const overview: NurtureOverview = {
      settings: input.settings,
      forwardReplies: input.forwardReplies,
      inWindow: plan.inWindow,
      due: plan.items.filter((i) => i.state === "due").map((i) => toPreview(i)),
      held: plan.items.filter((i) => i.state === "held").map((i) => toPreview(i)),
      upcoming: projectUpcoming(input, 48).map(({ item, at }) =>
        toPreview(item, at)
      ),
      recent,
      examples,
    };
    return NextResponse.json(overview);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { admin } = await requireAdmin();
    const body = await req.json().catch(() => null);
    const by = admin.email || admin.name || "admin";

    if (
      body?.enabled !== undefined ||
      body?.senderName !== undefined
    ) {
      if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
        return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
      }
      if (body.senderName !== undefined && typeof body.senderName !== "string") {
        return NextResponse.json({ error: "senderName must be text" }, { status: 400 });
      }
      await writeNurtureSettings(
        { enabled: body.enabled, senderName: body.senderName },
        by
      );
    }
    if (body?.forwardReplies !== undefined) {
      if (typeof body.forwardReplies !== "boolean") {
        return NextResponse.json(
          { error: "forwardReplies must be true or false" },
          { status: 400 }
        );
      }
      await writeForwardingSettings({ enabled: body.forwardReplies }, by);
    }
    // Which number every text Apply sends goes out from — the phase 2
    // cutover switch (Phone system card on this page).
    if (body?.smsProvider !== undefined) {
      if (body.smsProvider !== "quo" && body.smsProvider !== "twilio") {
        return NextResponse.json(
          { error: "smsProvider must be quo or twilio" },
          { status: 400 }
        );
      }
      await writeSmsProvider(body.smsProvider, by);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof InvalidSettingError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return handleAdminError(err);
  }
}
