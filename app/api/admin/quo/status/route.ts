import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";
import { isQuoConfigured, listWebhooks, resolveMainLine } from "@/lib/quo";

/**
 * Health of the Quo connection, for the status card on the Follow-ups
 * page: is the key set, is the Main Line found, is the live webhook
 * registered and on, and when did a text or call last arrive. A
 * connection that has quietly stopped shows up here as an old "last
 * mirrored" time or a webhook that reads Off.
 */
export const dynamic = "force-dynamic";

export interface QuoStatus {
  /** QUO_API_KEY is set. */
  configured: boolean;
  /** QUO_WEBHOOK_SECRET is set (without it, live updates are refused). */
  webhookSecretSet: boolean;
  mainLine: { id: string; number: string } | null;
  webhook: {
    id: string;
    enabled: boolean;
    /** Registered for the Main Line only (not every number). */
    mainLineOnly: boolean;
  } | null;
  /** Unix ms of the newest mirrored text / call; null when none. */
  lastTextAt: number | null;
  lastCallAt: number | null;
  textsMirrored: number;
  callsMirrored: number;
  /** Why the Quo side couldn't be checked, when it couldn't. */
  error: string | null;
}

const WEBHOOK_PATH = "/api/webhooks/quo";
const LOOKBACK_MS = 30 * 86_400_000;

export async function GET() {
  try {
    await requireAdmin();
    const status: QuoStatus = {
      configured: isQuoConfigured(),
      webhookSecretSet: Boolean(process.env.QUO_WEBHOOK_SECRET),
      mainLine: null,
      webhook: null,
      lastTextAt: null,
      lastCallAt: null,
      textsMirrored: 0,
      callsMirrored: 0,
      error: null,
    };

    const [texts, calls] = await Promise.all([
      xano.smsMessages.getSince(Date.now() - LOOKBACK_MS),
      xano.calls.getAll(),
    ]);
    const quoTexts = texts.filter((m) => m.provider === "quo");
    status.textsMirrored = quoTexts.length;
    status.lastTextAt = quoTexts.reduce<number | null>(
      (max, m) => (max === null || m.created_at > max ? m.created_at : max),
      null
    );
    status.callsMirrored = calls.length;
    status.lastCallAt = calls.reduce<number | null>(
      (max, c) => (max === null || c.started_at > max ? c.started_at : max),
      null
    );

    if (status.configured) {
      try {
        const [mainLine, webhooks] = await Promise.all([
          resolveMainLine(),
          listWebhooks(),
        ]);
        status.mainLine = { id: mainLine.id, number: mainLine.number };
        const hook = webhooks.find((w) => w.url.endsWith(WEBHOOK_PATH)) ?? null;
        if (hook) {
          status.webhook = {
            id: hook.id,
            enabled: hook.status === "enabled",
            mainLineOnly:
              hook.resourceIds.length === 1 && hook.resourceIds[0] === mainLine.id,
          };
        }
      } catch (err) {
        status.error = err instanceof Error ? err.message : "Couldn't reach Quo";
      }
    }
    return NextResponse.json(status);
  } catch (err) {
    return handleAdminError(err);
  }
}
