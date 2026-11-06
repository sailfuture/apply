import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { ADMIN_YEAR_COOKIE, parseAdminYearId } from "@/lib/school-year-default";
import { buildStageIndex, type StageTarget } from "@/lib/admin-stage";
import { xano } from "@/lib/xano";

/**
 * Quick-search index — one compact payload with every student,
 * parent, family, and open inquiry, fetched once by the dashboard
 * search box and filtered client-side as the admin types. Xano's
 * list endpoints ignore query params anyway (server-side search
 * isn't an option), and the whole school fits comfortably in one
 * response, so an index-then-filter design gives instant keystroke
 * feedback.
 *
 * Every result carries a resolved `target` — the family's or the
 * student's CURRENT stage page (application review / registration /
 * the enrolled student page) and the year it is scoped to — so the
 * dropdown both answers "where is this person in the funnel" and
 * lands on that page when picked. The resolution is the shared
 * `lib/admin-stage` rule the list pages use: per student where the
 * app distinguishes students (an enrolled student next to a sibling
 * still applying), per family otherwise; a year that is not past
 * beats a past one, then the most advanced stage, then the admin's
 * working year (`?yearId=`, else the remembered-year cookie).
 * Students and parents without a family of their own fall back to
 * the application page; standalone inquiry rows are the "inquiry"
 * stage (converted inquiries are excluded — they exist as families).
 *
 * Joins are isolated per table — a single Xano hiccup degrades that
 * group to empty instead of 500ing the route.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const preferredYearId =
      parseAdminYearId(req.nextUrl.searchParams.get("yearId")) ??
      parseAdminYearId(req.cookies.get(ADMIN_YEAR_COOKIE)?.value);

    const [
      familiesResult,
      parentsResult,
      studentsResult,
      applyProgressResult,
      regProgressResult,
      inquiriesResult,
      applicationsResult,
      packetsResult,
      yearsResult,
    ] = await Promise.allSettled([
      xano.families.getAll(),
      xano.parents.getAll(),
      xano.students.getAll(),
      xano.familyApplicationProgress.getAll(),
      xano.studentRegistrationProgress.getAll(),
      xano.inquiries.getAll(),
      xano.applications.getAll(),
      xano.studentRegistration.getAll(),
      xano.schoolYears.getAll(),
    ]);
    for (const [label, result] of [
      ["families", familiesResult],
      ["parents", parentsResult],
      ["students", studentsResult],
      ["apply progress", applyProgressResult],
      ["registration progress", regProgressResult],
      ["inquiries", inquiriesResult],
      ["applications", applicationsResult],
      ["registration packets", packetsResult],
      ["school years", yearsResult],
    ] as const) {
      if (result.status === "rejected") {
        console.error(
          `[/api/admin/search] failed to load ${label}:`,
          result.reason
        );
      }
    }
    const families =
      familiesResult.status === "fulfilled" ? familiesResult.value : [];
    const parents =
      parentsResult.status === "fulfilled" ? parentsResult.value : [];
    const students =
      studentsResult.status === "fulfilled" ? studentsResult.value : [];
    const applyRows =
      applyProgressResult.status === "fulfilled"
        ? applyProgressResult.value
        : [];
    const regRows =
      regProgressResult.status === "fulfilled" ? regProgressResult.value : [];
    const inquiries =
      inquiriesResult.status === "fulfilled" ? inquiriesResult.value : [];
    const applications =
      applicationsResult.status === "fulfilled" ? applicationsResult.value : [];
    const packets =
      packetsResult.status === "fulfilled" ? packetsResult.value : [];
    const years = yearsResult.status === "fulfilled" ? yearsResult.value : [];

    const familyNameById = new Map(
      families.map((f) => [
        f.id,
        f.family_name?.trim() || `Family #${f.id}`,
      ])
    );

    // Parent → family via the family rows' parent-id arrays (parents
    // don't carry a family FK; `getParentIds` normalizes the mixed
    // id/object shapes Xano returns).
    const familyIdByParentId = new Map<number, number>();
    for (const family of families) {
      for (const pid of xano.families.getParentIds(family)) {
        if (!familyIdByParentId.has(pid)) {
          familyIdByParentId.set(pid, family.id);
        }
      }
    }

    // Family → student names for the family rows' subtitles.
    const studentNamesByFamily = new Map<number, string[]>();
    for (const s of students) {
      const name = `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
      if (!name) continue;
      const fid = Number(s.registration_families_id);
      const arr = studentNamesByFamily.get(fid) ?? [];
      arr.push(name);
      studentNamesByFamily.set(fid, arr);
    }

    const index = buildStageIndex(
      {
        applyProgress: applyRows,
        regProgress: regRows,
        applications,
        students,
        packets,
        years,
      },
      { preferredYearId }
    );
    const familyTargets = new Map<number, StageTarget>();
    const targetForFamily = (fid: number | null): StageTarget | null => {
      if (!fid) return null;
      let t = familyTargets.get(fid);
      if (!t) {
        t = index.family(fid, preferredYearId);
        familyTargets.set(fid, t);
      }
      return t;
    };

    // Inquiries that became families are represented by their family
    // row (and its stage); matching on the parent email keeps them
    // out of the Inquiries group even when the `status` flag was
    // never flipped to "converted".
    const parentEmails = new Set(
      parents
        .map((p) => (p.email ?? "").trim().toLowerCase())
        .filter(Boolean)
    );

    const payload: AdminSearchIndex = {
      students: students
        .map((s) => {
          const fid = Number(s.registration_families_id) || null;
          return {
            id: s.id,
            name:
              `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() ||
              `Student #${s.id}`,
            family_id: fid,
            family_name: fid ? (familyNameById.get(fid) ?? "") : "",
            is_archived: s.isArchived === true,
            target:
              index.student(s.id, preferredYearId) ?? targetForFamily(fid),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      parents: parents
        .map((p) => {
          const fid = familyIdByParentId.get(p.id) ?? null;
          return {
            id: p.id,
            name:
              `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() ||
              `Parent #${p.id}`,
            email: p.email ?? "",
            phone: p.phone ?? "",
            family_id: fid,
            family_name: fid ? (familyNameById.get(fid) ?? "") : "",
            target: targetForFamily(fid),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      families: families
        .map((f) => ({
          id: f.id,
          name: f.family_name?.trim() || `Family #${f.id}`,
          student_names: (studentNamesByFamily.get(f.id) ?? []).join(", "),
          target: targetForFamily(f.id)!,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      inquiries: inquiries
        .filter((i) => {
          if ((i.status ?? "").trim().toLowerCase() === "converted") {
            return false;
          }
          const email = (i.primary_email ?? "").trim().toLowerCase();
          return !(email && parentEmails.has(email));
        })
        .map((i) => ({
          id: i.id,
          name:
            `${i.primary_first_name ?? ""} ${i.primary_last_name ?? ""}`.trim() ||
            `Inquiry #${i.id}`,
          student_name:
            `${i.student_first_name ?? ""} ${i.student_last_name ?? ""}`.trim(),
          email: i.primary_email ?? "",
          phone: String(i.primary_phone ?? ""),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };

    return NextResponse.json(payload);
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Where the person sits in the admissions funnel. Derived, never
 *  stored — see `lib/admin-stage` for the signals. */
export type SearchStage =
  | "inquiry"
  | "application"
  | "registration"
  | "enrollment";

export interface AdminSearchStudent {
  id: number;
  name: string;
  family_id: number | null;
  family_name: string;
  /** Unenrolled mid-year — the UI badges this over the stage. */
  is_archived: boolean;
  /** The student's current stage page (their enrolled page when
   *  enrolled or unenrolled, else the family's stage page); null only
   *  for a student with no family. */
  target: StageTarget | null;
}

export interface AdminSearchParent {
  id: number;
  name: string;
  email: string;
  phone: string;
  family_id: number | null;
  family_name: string;
  /** The family's current stage page; null when the parent has no
   *  family (the row is then not navigable). */
  target: StageTarget | null;
}

export interface AdminSearchFamily {
  id: number;
  name: string;
  student_names: string;
  /** The family's current stage page. */
  target: StageTarget;
}

/** A lead that hasn't applied yet — stage is always "inquiry". */
export interface AdminSearchInquiry {
  id: number;
  name: string;
  student_name: string;
  email: string;
  phone: string;
}

export interface AdminSearchIndex {
  students: AdminSearchStudent[];
  parents: AdminSearchParent[];
  families: AdminSearchFamily[];
  inquiries: AdminSearchInquiry[];
}
