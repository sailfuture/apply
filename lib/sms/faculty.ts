import { xanoFetch } from "@/lib/xano-fetch";
import { getXanoHost } from "@/lib/xano";
import { normPhone } from "./contacts";

/**
 * Active faculty who can be added to a group text. Source is the staff
 * `teachers` table (Xano workspace 2, read through the Toddle API
 * group's public `GET /teachers`); `phone` was added for this on
 * 2026-10-01. Faculty have no FK on `sms_messages` — their ids are
 * UUIDs — so they're texted as ad-hoc contacts keyed by phone, and
 * this list is what puts a name back on those numbers.
 */
export interface FacultyMember {
  /** `teachers.id` (UUID). */
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  /** What `{{first_name}}` becomes: the first name, or the full
   *  "Ms. Manke" when the row stores a title in `firstName`. */
  greetingName: string;
  /** Bare 10 digits. */
  phone: string;
  role: string;
  department: string;
}

interface RawTeacher {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  role?: string | null;
  department?: string | null;
  isArchived?: boolean | null;
  phone?: string | null;
}

/** Rows like "Ms." + "Manke" keep the title in `firstName`. */
const TITLE_RE = /^(mr|mrs|ms|miss|dr|coach|captain|capt)\.?$/i;

/** Non-archived teachers with a usable 10-digit phone, A–Z. */
export async function getActiveFaculty(): Promise<FacultyMember[]> {
  const res = await xanoFetch(`${getXanoHost()}/api:fJsHVIeC/teachers`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Xano error ${res.status}: ${await res.text()}`);
  }
  const rows = (await res.json()) as RawTeacher[];
  return (Array.isArray(rows) ? rows : [])
    .filter((t) => t.isArchived !== true)
    .map((t) => {
      const firstName = (t.firstName ?? "").trim();
      const lastName = (t.lastName ?? "").trim();
      return {
        id: t.id,
        firstName,
        lastName,
        name: `${firstName} ${lastName}`.trim(),
        greetingName: TITLE_RE.test(firstName)
          ? `${firstName} ${lastName}`.trim()
          : firstName,
        phone: normPhone(t.phone),
        role: (t.role ?? "").trim(),
        department: (t.department ?? "").trim(),
      };
    })
    .filter((t) => t.phone.length === 10)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Active faculty keyed by bare 10-digit phone. Empty on any failure —
 *  callers only use it to put names on numbers. */
export async function getFacultyByPhone(): Promise<Map<string, FacultyMember>> {
  try {
    const list = await getActiveFaculty();
    return new Map(list.map((f) => [f.phone, f]));
  } catch (err) {
    console.error("[sms/faculty] teachers read failed:", err);
    return new Map();
  }
}
