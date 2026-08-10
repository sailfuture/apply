import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
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
 * Every result carries a pipeline `stage` so the dropdown answers
 * "where is this person in the funnel" at a glance:
 *
 *   inquiry → application → registration → enrollment
 *
 * Family stage is the family's MOST-ADVANCED position across all
 * years (same signals as /api/admin/pipeline: apply-progress
 * `isAccepted` moves application → registration, the
 * `isRegistrationConfirmed` latch or a currently-enrolled student
 * moves registration → enrollment). Most-advanced beats
 * latest-year here because a re-enrollment application for next
 * year shouldn't relabel an enrolled family "Application".
 * Students and parents inherit their family's stage; standalone
 * inquiry rows are the "inquiry" stage (converted inquiries are
 * excluded — they exist as families).
 *
 * Joins are isolated per table — a single Xano hiccup degrades that
 * group to empty instead of 500ing the route.
 */
export async function GET() {
  try {
    await requireAdmin();

    const [
      familiesResult,
      parentsResult,
      studentsResult,
      applyProgressResult,
      regProgressResult,
      inquiriesResult,
    ] = await Promise.allSettled([
      xano.families.getAll(),
      xano.parents.getAll(),
      xano.students.getAll(),
      xano.familyApplicationProgress.getAll(),
      xano.studentRegistrationProgress.getAll(),
      xano.inquiries.getAll(),
    ]);
    for (const [label, result] of [
      ["families", familiesResult],
      ["parents", parentsResult],
      ["students", studentsResult],
      ["apply progress", applyProgressResult],
      ["registration progress", regProgressResult],
      ["inquiries", inquiriesResult],
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

    // Stage signals, most-advanced across years.
    const acceptedFamilies = new Set<number>();
    for (const r of applyRows) {
      if (r.isAccepted) acceptedFamilies.add(Number(r.registration_families_id));
    }
    const confirmedFamilies = new Set<number>();
    for (const r of regRows) {
      if (r.isRegistrationConfirmed === true) {
        confirmedFamilies.add(Number(r.registration_families_id));
      }
    }
    for (const s of students) {
      if (s.isEnrolled === true && s.isArchived !== true) {
        confirmedFamilies.add(Number(s.registration_families_id));
      }
    }
    // Every family row exists because someone signed up for the apply
    // flow, so "application" is the floor even before a progress row
    // appears.
    const stageForFamily = (fid: number | null): SearchStage => {
      if (!fid) return "application";
      if (confirmedFamilies.has(fid)) return "enrollment";
      if (acceptedFamilies.has(fid)) return "registration";
      return "application";
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

    const index: AdminSearchIndex = {
      students: students
        .map((s) => {
          const fid = Number(s.registration_families_id);
          return {
            id: s.id,
            name:
              `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim() ||
              `Student #${s.id}`,
            family_id: fid || null,
            family_name: familyNameById.get(fid) ?? "",
            is_enrolled: s.isEnrolled === true && s.isArchived !== true,
            is_archived: s.isArchived === true,
            stage:
              s.isEnrolled === true && s.isArchived !== true
                ? ("enrollment" as const)
                : stageForFamily(fid || null),
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
            stage: stageForFamily(fid),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      families: families
        .map((f) => ({
          id: f.id,
          name: f.family_name?.trim() || `Family #${f.id}`,
          student_names: (studentNamesByFamily.get(f.id) ?? []).join(", "),
          stage: stageForFamily(f.id),
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

    return NextResponse.json(index);
  } catch (err) {
    return handleAdminError(err);
  }
}

/** Where the person sits in the admissions funnel. Derived, never
 *  stored — see the route doc for the signals. */
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
  /** Currently enrolled (isEnrolled true and not archived) — drives
   *  the deep link to the enrolled detail. */
  is_enrolled: boolean;
  /** Unenrolled mid-year — the UI badges this over the stage. */
  is_archived: boolean;
  stage: SearchStage;
}

export interface AdminSearchParent {
  id: number;
  name: string;
  email: string;
  phone: string;
  family_id: number | null;
  family_name: string;
  stage: SearchStage;
}

export interface AdminSearchFamily {
  id: number;
  name: string;
  student_names: string;
  stage: SearchStage;
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
