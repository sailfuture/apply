import type { XanoStudentLaptop } from "@/lib/xano";

/** Editable laptop-assignment fields (see `XanoStudentLaptop`). */
export type LaptopPatch = Partial<
  Pick<
    XanoStudentLaptop,
    | "registration_students_id"
    | "make_model"
    | "serial_number"
    | "asset_tag"
    | "assigned_date"
    | "notes"
  >
>;

/** Validation shared by the admin laptop POST (core fields required)
 *  and PATCH (partial) routes. */
export function parseLaptopBody(
  body: unknown,
  { requireCore }: { requireCore: boolean }
): LaptopPatch | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Invalid JSON body" };
  }
  const b = body as Record<string, unknown>;
  const out: LaptopPatch = {};

  if ("registration_students_id" in b || requireCore) {
    const id = Number(b.registration_students_id);
    if (!Number.isFinite(id) || id <= 0) {
      return { error: "registration_students_id is required" };
    }
    out.registration_students_id = id;
  }
  if ("make_model" in b || requireCore) {
    const v = typeof b.make_model === "string" ? b.make_model.trim() : "";
    if (!v) return { error: "make_model is required" };
    out.make_model = v;
  }
  if ("serial_number" in b || requireCore) {
    const v =
      typeof b.serial_number === "string" ? b.serial_number.trim() : "";
    if (!v) return { error: "serial_number is required" };
    out.serial_number = v;
  }
  if ("asset_tag" in b) {
    out.asset_tag =
      typeof b.asset_tag === "string" ? b.asset_tag.trim() : "";
  }
  if ("assigned_date" in b) {
    out.assigned_date =
      typeof b.assigned_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(b.assigned_date)
        ? b.assigned_date
        : "";
  }
  if ("notes" in b) {
    out.notes = typeof b.notes === "string" ? b.notes.trim() : "";
  }
  return out;
}
