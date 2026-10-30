import { xano, type XanoAppSetting } from "@/lib/xano";

/**
 * Typed access to the `registration_app_settings` rows. Each setting is
 * one row keyed by `name`, its JSON payload in `value`. Parsing is
 * defensive — a hand-edited or partial row degrades field by field to
 * the default instead of throwing.
 */

/** Automated follow-up texts to leads (`lib/nurture`). */
export interface NurtureSettings {
  /** Master switch. Off = the cron sends nothing (the preview still
   *  shows what WOULD go out). */
  enabled: boolean;
  /** Name that signs the personal-style follow-up ("it's Jane from
   *  SailFuture Academy"). Blank = signed by the admissions team. */
  senderName: string;
  /** When follow-ups were FIRST switched on (unix ms). Inquiry and
   *  post-tour texts only go to leads/tours from then on, so switching
   *  on never texts the backlog. Null until the first switch-on. */
  startedAt: number | null;
}

/** Copying parents' replies to the Main Line (`lib/sms/forward.ts`). */
export interface ReplyForwardingSettings {
  enabled: boolean;
}

/** Tuition due-soon and past-due texts (`lib/billing-texts.ts`). */
export interface BillingTextSettings {
  enabled: boolean;
}

/** A setting value the caller should fix (surfaced as a 400). */
export class InvalidSettingError extends Error {}

export const NURTURE_DEFAULTS: NurtureSettings = {
  enabled: false,
  senderName: "",
  startedAt: null,
};

const FORWARDING_DEFAULTS: ReplyForwardingSettings = { enabled: true };

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** A name, and nothing else: letters (accents ok), spaces, hyphens,
 *  apostrophes, up to 40 characters — and a period only where it ends
 *  a word ("Ms. Lopez"), so a domain like "x.com" can't get through.
 *  The sender name is pasted into texts to parents, and the Xano
 *  settings endpoints aren't authenticated — so anything that isn't
 *  plainly a name is refused on save and ignored on read. */
export function isValidSenderName(name: string): boolean {
  return (
    name === "" ||
    (name.length <= 40 && /^\p{L}(?:[\p{L} '-]|\.(?= |$))*$/u.test(name))
  );
}

/** Follow-ups launched 2026-09-28 (midnight Eastern). `startedAt` can
 *  never read earlier than this — the settings endpoints are open, and
 *  a forged early date would pull the inquiry backlog into the nudges. */
const NURTURE_LAUNCH_FLOOR = Date.UTC(2026, 8, 28, 4);

function parseNurture(v: unknown): NurtureSettings {
  const r = asRecord(v);
  const startedAt = Number(r.startedAt);
  const sender = typeof r.senderName === "string" ? r.senderName.trim() : "";
  return {
    enabled: r.enabled === true,
    senderName: isValidSenderName(sender) ? sender : "",
    startedAt:
      Number.isFinite(startedAt) && startedAt > 0
        ? Math.max(startedAt, NURTURE_LAUNCH_FLOOR)
        : null,
  };
}

function parseForwarding(v: unknown): ReplyForwardingSettings {
  const r = asRecord(v);
  return { enabled: r.enabled !== false };
}

/** On unless switched off: the texts were live before the switch. */
function parseBillingTexts(v: unknown): BillingTextSettings {
  const r = asRecord(v);
  return { enabled: r.enabled !== false };
}

/** Lowest id wins if a race ever created two rows for one name. */
function rowFor(rows: XanoAppSetting[], name: string) {
  return (
    rows
      .filter((r) => r.name === name)
      .sort((a, b) => a.id - b.id)[0] ?? null
  );
}

/** Both settings, strictly — throws when the table can't be read. */
/** Which system carries the texts Apply sends (`lib/sms/send.ts`). */
export type SmsProvider = "twilio" | "quo";

export interface SmsSettings {
  provider: SmsProvider;
}

/** Twilio until the switch is flipped — the number families have been
 *  texting with, and the one whose registration is proven. */
function parseSmsProvider(v: unknown): SmsSettings {
  const r = asRecord(v);
  return { provider: r.provider === "quo" ? "quo" : "twilio" };
}

export async function readAppSettings(): Promise<{
  nurture: NurtureSettings;
  forwarding: ReplyForwardingSettings;
  sms: SmsSettings;
  billingTexts: BillingTextSettings;
}> {
  const rows = await xano.appSettings.getAllStrict();
  return {
    nurture: parseNurture(rowFor(rows, "nurture")?.value),
    forwarding: parseForwarding(rowFor(rows, "sms_forwarding")?.value),
    sms: parseSmsProvider(rowFor(rows, "sms_provider")?.value),
    billingTexts: parseBillingTexts(rowFor(rows, "billing_texts")?.value),
  };
}

const PROVIDER_CACHE_MS = 30_000;
let providerCache: { at: number; value: SmsProvider } | null = null;

/**
 * The provider every send consults. Cached for 30 seconds so a group
 * text doesn't read the settings once per recipient; a flip of the
 * switch takes effect within that. When the settings can't be read
 * the last known value is used, and before any is known,
 * `SMS_PROVIDER` from the environment, then Twilio — the switch never
 * silently changes which number a family hears from.
 */
export async function currentSmsProvider(): Promise<SmsProvider> {
  if (providerCache && Date.now() - providerCache.at < PROVIDER_CACHE_MS) {
    return providerCache.value;
  }
  try {
    const value = (await readAppSettings()).sms.provider;
    providerCache = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.error("[app-settings] provider read failed:", err);
    if (providerCache) return providerCache.value;
    return process.env.SMS_PROVIDER === "quo" ? "quo" : "twilio";
  }
}

export async function writeSmsProvider(
  provider: SmsProvider,
  updatedBy: string
): Promise<SmsSettings> {
  const row = await upsert("sms_provider", { provider }, updatedBy);
  const saved = parseSmsProvider(row.value);
  // What was just written is the freshest value this process can
  // have — never fall back to the environment default right after a
  // flip because the read-back blipped.
  providerCache = { at: Date.now(), value: saved.provider };
  return saved;
}

/** Reply forwarding, defaulting ON: it only ever texts the school's own
 *  Main Line, so a settings blip shouldn't silence it. */
export async function readForwardingSettings(): Promise<ReplyForwardingSettings> {
  try {
    return (await readAppSettings()).forwarding;
  } catch (err) {
    console.error("[app-settings] forwarding read failed, using default:", err);
    return FORWARDING_DEFAULTS;
  }
}

async function upsert(name: string, value: unknown, updatedBy: string) {
  const rows = await xano.appSettings.getAllStrict();
  const existing = rowFor(rows, name);
  return existing
    ? xano.appSettings.update(existing.id, { value, updated_by: updatedBy })
    : xano.appSettings.create({ name, value, updated_by: updatedBy });
}

/** Save follow-up settings. The first switch-on stamps `startedAt`;
 *  later toggles keep it, so an off/on cycle doesn't reset who's in. */
export async function writeNurtureSettings(
  patch: Partial<Pick<NurtureSettings, "enabled" | "senderName">>,
  updatedBy: string
): Promise<NurtureSettings> {
  const senderName = (patch.senderName ?? "").trim();
  if (patch.senderName !== undefined && !isValidSenderName(senderName)) {
    throw new InvalidSettingError(
      "Use just a name for the sender: letters, spaces, hyphens or apostrophes, up to 40 characters."
    );
  }
  const current = (await readAppSettings()).nurture;
  const next: NurtureSettings = {
    enabled: patch.enabled ?? current.enabled,
    senderName: patch.senderName !== undefined ? senderName : current.senderName,
    startedAt:
      current.startedAt ??
      ((patch.enabled ?? current.enabled) ? Date.now() : null),
  };
  const row = await upsert("nurture", next, updatedBy);
  return parseNurture(row.value);
}

/** The carrier-filtering watch (lib/sms/delivery-alert.ts): when the
 *  open alert was sent, and when the episode's first filtered text
 *  went out. Both null = no alert open. */
export interface DeliveryAlertState {
  alertedAt: number | null;
  filteredSince: number | null;
}

function parseDeliveryAlert(v: unknown): DeliveryAlertState {
  const r = asRecord(v);
  const ms = (x: unknown) => (Number(x) > 0 ? Number(x) : null);
  return { alertedAt: ms(r.alertedAt), filteredSince: ms(r.filteredSince) };
}

export async function readDeliveryAlertState(): Promise<DeliveryAlertState> {
  const rows = await xano.appSettings.getAllStrict();
  return parseDeliveryAlert(rowFor(rows, "sms_delivery_alert")?.value);
}

export async function writeDeliveryAlertState(
  state: DeliveryAlertState,
  updatedBy: string
): Promise<DeliveryAlertState> {
  // 0, not null: Xano's PATCH drops null inputs, so a closed alert
  // is written as zeros (parsed back to null).
  const row = await upsert(
    "sms_delivery_alert",
    { alertedAt: state.alertedAt ?? 0, filteredSince: state.filteredSince ?? 0 },
    updatedBy
  );
  return parseDeliveryAlert(row.value);
}

/* ── Closed conversations ────────────────────────────────────────── */

/** `${contactType}:${contactId}` → when staff closed that thread
 *  (unix ms). A thread is HIDDEN from the inbox lists while nothing
 *  newer than its close stamp has arrived; a new text or call reopens
 *  it on its own. Shared by all staff (one settings row), not
 *  per-admin like the viewed stamps. */
export type ClosedConversations = Record<string, number>;

const CLOSED_SETTING = "sms_closed_conversations";

function parseClosed(v: unknown): ClosedConversations {
  const r = asRecord(asRecord(v).closed);
  const out: ClosedConversations = {};
  for (const [key, at] of Object.entries(r)) {
    const ms = Number(at);
    if (/^[a-z]+:\d+$/.test(key) && Number.isFinite(ms) && ms > 0) out[key] = ms;
  }
  return out;
}

/** Never throws — an unreadable row hides nothing. Reads from the
 *  cache: this runs on every badge poll from every admin tab, and
 *  `writeClosedConversation` expires the table's tag. */
export async function readClosedConversations(): Promise<ClosedConversations> {
  try {
    const rows = await xano.appSettings.getAll();
    return parseClosed(rowFor(rows, CLOSED_SETTING)?.value);
  } catch (err) {
    console.error("[app-settings] closed-conversations read failed:", err);
    return {};
  }
}

/** Close (`closedAt` > 0) or reopen (`closedAt` = 0) one thread. The
 *  row's value always carries `version` beside the map, so an empty
 *  map is still a non-empty value — Xano's PATCH drops empty inputs,
 *  which would otherwise leave the last close in place forever. */
export async function writeClosedConversation(
  key: string,
  closedAt: number,
  updatedBy: string
): Promise<ClosedConversations> {
  const rows = await xano.appSettings.getAllStrict();
  const existing = rowFor(rows, CLOSED_SETTING);
  const closed = parseClosed(existing?.value);
  if (closedAt > 0) closed[key] = Math.floor(closedAt);
  else delete closed[key];
  const value = { version: 1, closed };
  const row = existing
    ? await xano.appSettings.update(existing.id, { value, updated_by: updatedBy })
    : await xano.appSettings.create({ name: CLOSED_SETTING, value, updated_by: updatedBy });
  return parseClosed(row.value);
}

export async function writeForwardingSettings(
  patch: ReplyForwardingSettings,
  updatedBy: string
): Promise<ReplyForwardingSettings> {
  const row = await upsert("sms_forwarding", { enabled: patch.enabled }, updatedBy);
  return parseForwarding(row.value);
}

export async function writeBillingTextSettings(
  patch: BillingTextSettings,
  updatedBy: string
): Promise<BillingTextSettings> {
  const row = await upsert("billing_texts", { enabled: patch.enabled }, updatedBy);
  return parseBillingTexts(row.value);
}
