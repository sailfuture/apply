/**
 * Recruitment / outreach events — the festivals, tabling shifts,
 * church visits and school fairs staff attend to find families.
 * Replaces the Notion "recruitment events" table; one Xano row per
 * event in `registration_recruitment_events`.
 *
 * Shared by the admin page, its sheet/dialog and the API routes:
 * the row shape, the two small option sets, body validation for the
 * create/edit routes (a route file can only export handlers), and the
 * file-URL resolver for vault attachments.
 *
 * Column notes:
 *   - `event_date` is the school day as "YYYY-MM-DD"; `start_time` /
 *     `end_time` are unix-ms at the school's wall clock (0 = unset),
 *     the same encoding the school calendar uses.
 *   - `hours` is what staff log for the event — prefilled from the
 *     times in the dialog but editable (setup, travel).
 *   - `hours_type` is "working" | "outside" (the Notion "PTO Balance"
 *     column: whether the event fell inside working hours).
 *   - `event_type` is "event" | "tabling" | "" (not set yet).
 *   - `staff` is a JSON array of staff names (free text, picked from
 *     the admin + faculty lists or typed).
 *   - `files` holds Xano vault attachment metadata, as uploaded
 *     through `/api/upload`.
 */

export const HOURS_TYPES = [
  { value: "working", label: "Working hours" },
  { value: "outside", label: "Outside working hours" },
] as const;
export type HoursType = (typeof HOURS_TYPES)[number]["value"];

export const EVENT_TYPES = [
  {
    value: "event",
    label: "Event",
    chip: "bg-emerald-100 text-emerald-900",
  },
  {
    value: "tabling",
    label: "Tabling",
    chip: "bg-sky-100 text-sky-900",
  },
] as const;
export type EventType = (typeof EVENT_TYPES)[number]["value"];

export function eventTypeOption(value: string | null | undefined) {
  return EVENT_TYPES.find((t) => t.value === value) ?? null;
}

export function hoursTypeLabel(value: string | null | undefined): string {
  return HOURS_TYPES.find((t) => t.value === value)?.label ?? "";
}

/** Xano vault file metadata as `/api/upload` hands it back. Only the
 *  keys the UI reads are typed; the rest pass through untouched. */
export interface RecruitmentEventFile {
  name?: string;
  url?: string;
  path?: string;
  mime?: string;
  type?: string;
  size?: number;
  [key: string]: unknown;
}

/** One row of `registration_recruitment_events`, normalized — the
 *  arrays are always arrays and the strings always strings, whatever
 *  Xano echoed for a column that was never written. */
export interface RecruitmentEvent {
  id: number;
  created_at: number;
  name: string;
  /** "YYYY-MM-DD" */
  event_date: string;
  /** Unix ms at the school's clock; 0 = unset. */
  start_time: number;
  end_time: number;
  hours: number;
  hours_type: HoursType | "";
  event_type: EventType | "";
  paid: boolean;
  staff: string[];
  description: string;
  location: string;
  event_link: string;
  application_link: string;
  files: RecruitmentEventFile[];
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Coerce a raw Xano row into `RecruitmentEvent`. */
export function normalizeRecruitmentEvent(
  raw: Record<string, unknown>
): RecruitmentEvent {
  const staff = Array.isArray(raw.staff)
    ? raw.staff.map((s) => str(s).trim()).filter(Boolean)
    : [];
  const files = Array.isArray(raw.files)
    ? (raw.files.filter(
        (f) => f && typeof f === "object"
      ) as RecruitmentEventFile[])
    : [];
  const hoursType = str(raw.hours_type);
  const eventType = str(raw.event_type);
  return {
    id: num(raw.id),
    created_at: num(raw.created_at),
    name: str(raw.name),
    event_date: str(raw.event_date),
    start_time: num(raw.start_time),
    end_time: num(raw.end_time),
    hours: num(raw.hours),
    hours_type: HOURS_TYPES.some((t) => t.value === hoursType)
      ? (hoursType as HoursType)
      : "",
    event_type: EVENT_TYPES.some((t) => t.value === eventType)
      ? (eventType as EventType)
      : "",
    paid: raw.paid === true,
    staff,
    description: str(raw.description),
    location: str(raw.location),
    event_link: str(raw.event_link),
    application_link: str(raw.application_link),
    files,
  };
}

/** What the create/edit routes accept — every column but id/created_at. */
export type RecruitmentEventInput = Omit<RecruitmentEvent, "id" | "created_at">;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A link typed without a scheme ("eventbrite.com/e/…") still opens. */
function normalizeLink(v: string): string {
  const t = v.trim();
  if (!t) return "";
  return /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
}

/**
 * Validate a create/edit body. Only the keys present in the body come
 * back, so PATCH stays partial; `forCreate` additionally requires a
 * name and a date. Empty strings, `false` and `0` are kept — the
 * table's PATCH endpoint writes them through, which is how the type
 * or the paid flag gets unset.
 */
export function parseRecruitmentEventBody(
  body: unknown,
  { forCreate = false }: { forCreate?: boolean } = {}
): Partial<RecruitmentEventInput> | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Invalid JSON body" };
  }
  const b = body as Record<string, unknown>;
  const out: Partial<RecruitmentEventInput> = {};

  if ("name" in b) {
    const name = str(b.name).trim();
    if (!name) return { error: "Event name can't be empty" };
    out.name = name;
  } else if (forCreate) {
    return { error: "Event name is required" };
  }

  if ("event_date" in b) {
    const d = str(b.event_date).trim();
    if (!DATE_RE.test(d)) return { error: "Date must be YYYY-MM-DD" };
    out.event_date = d;
  } else if (forCreate) {
    return { error: "Date is required" };
  }

  for (const key of ["start_time", "end_time"] as const) {
    if (!(key in b)) continue;
    const v = b[key] == null ? 0 : Number(b[key]);
    if (!Number.isInteger(v) || v < 0) {
      return { error: `${key} must be a unix-ms timestamp (0 = unset)` };
    }
    out[key] = v;
  }
  if (
    out.start_time &&
    out.end_time &&
    out.end_time < out.start_time
  ) {
    return { error: "End time must be after the start time" };
  }

  if ("hours" in b) {
    const v = b.hours === "" || b.hours == null ? 0 : Number(b.hours);
    if (!Number.isFinite(v) || v < 0 || v > 24 * 7) {
      return { error: "Hours must be a number of hours" };
    }
    out.hours = Math.round(v * 100) / 100;
  }

  if ("hours_type" in b) {
    const v = str(b.hours_type);
    if (v && !HOURS_TYPES.some((t) => t.value === v)) {
      return { error: "hours_type must be working or outside" };
    }
    out.hours_type = v as HoursType | "";
  }

  if ("event_type" in b) {
    const v = str(b.event_type);
    if (v && !EVENT_TYPES.some((t) => t.value === v)) {
      return { error: "event_type must be event or tabling" };
    }
    out.event_type = v as EventType | "";
  }

  if ("paid" in b) out.paid = b.paid === true;

  if ("staff" in b) {
    if (!Array.isArray(b.staff)) return { error: "staff must be a list" };
    const seen = new Set<string>();
    const staff: string[] = [];
    for (const s of b.staff) {
      const name = str(s).trim().replace(/\s+/g, " ");
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      staff.push(name);
    }
    out.staff = staff;
  }

  for (const key of ["description", "location"] as const) {
    if (key in b) out[key] = str(b[key]).trim();
  }
  for (const key of ["event_link", "application_link"] as const) {
    if (key in b) out[key] = normalizeLink(str(b[key]));
  }

  if ("files" in b) {
    if (!Array.isArray(b.files)) return { error: "files must be a list" };
    out.files = b.files.filter(
      (f): f is RecruitmentEventFile => !!f && typeof f === "object"
    );
  }

  return out;
}

/** Xano host for `/vault/...` paths — mirrors the other admin surfaces. */
const XANO_VAULT_BASE =
  process.env.NEXT_PUBLIC_XANO_BASE ?? "https://xsc3-mvx7-r86m.n7e.xano.io";

/** A viewable URL for an uploaded file: Xano's signed `url` when it
 *  gave one, else the vault path on the instance host. */
export function recruitmentFileUrl(file: RecruitmentEventFile): string | null {
  if (typeof file.url === "string" && file.url.length > 0) return file.url;
  if (typeof file.path === "string" && file.path.startsWith("/")) {
    return `${XANO_VAULT_BASE}${file.path}`;
  }
  return null;
}

/** "2.5", "6", "0.75" — hours as staff write them, no trailing zeros. */
export function formatHours(h: number): string {
  if (!Number.isFinite(h)) return "0";
  return String(Math.round(h * 100) / 100);
}

/** Hours between two school-clock instants, to the quarter hour; 0
 *  when either is unset or the order is wrong. */
export function hoursBetween(startMs: number, endMs: number): number {
  if (!startMs || !endMs || endMs <= startMs) return 0;
  return Math.round(((endMs - startMs) / 3_600_000) * 4) / 4;
}
