import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { xano } from "@/lib/xano";

/**
 * Quick-search index — one compact payload with every student,
 * parent, and family, fetched once by the dashboard search box and
 * filtered client-side as the admin types. Xano's list endpoints
 * ignore query params anyway (server-side search isn't an option),
 * and the whole school fits comfortably in one response, so an
 * index-then-filter design gives instant keystroke feedback.
 *
 * Joins are isolated per table — a single Xano hiccup degrades that
 * group to empty instead of 500ing the route.
 */
export async function GET() {
  try {
    await requireAdmin();

    const [familiesResult, parentsResult, studentsResult] =
      await Promise.allSettled([
        xano.families.getAll(),
        xano.parents.getAll(),
        xano.students.getAll(),
      ]);
    for (const [label, result] of [
      ["families", familiesResult],
      ["parents", parentsResult],
      ["students", studentsResult],
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
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      families: families
        .map((f) => ({
          id: f.id,
          name: f.family_name?.trim() || `Family #${f.id}`,
          student_names: (studentNamesByFamily.get(f.id) ?? []).join(", "),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };

    return NextResponse.json(index);
  } catch (err) {
    return handleAdminError(err);
  }
}

export interface AdminSearchStudent {
  id: number;
  name: string;
  family_id: number | null;
  family_name: string;
  /** Currently enrolled (isEnrolled true and not archived) — drives
   *  the Enrolled badge and the deep link to the enrolled detail. */
  is_enrolled: boolean;
  is_archived: boolean;
}

export interface AdminSearchParent {
  id: number;
  name: string;
  email: string;
  phone: string;
  family_id: number | null;
  family_name: string;
}

export interface AdminSearchFamily {
  id: number;
  name: string;
  student_names: string;
}

export interface AdminSearchIndex {
  students: AdminSearchStudent[];
  parents: AdminSearchParent[];
  families: AdminSearchFamily[];
}
