import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { NextResponse } from "next/server";
import { xano } from "@/lib/xano";

/**
 * Admin list of registration inquiries, annotated with a computed
 * `hasParentAccount` flag: true when the inquiry's email matches a
 * registered parent account (case-insensitive). The UI renders it as
 * an "applied?" hint badge — a suggestion only, not the source of
 * truth, because inquiry emails are unreliable (typos, placeholder
 * addresses, parents who apply under a different email). Admin
 * confirms by explicitly marking the inquiry converted.
 */
export async function GET() {
  try {
    await requireAdmin();
    const [inquiries, parentEmails] = await Promise.all([
      xano.inquiries.getAll(),
      // Suggestion-only data — if the parents fetch fails, ship the
      // list without badges rather than failing the whole page.
      xano.parents
        .getAll()
        .then(
          (parents) =>
            new Set(
              parents
                .map((p) => (p.email ?? "").trim().toLowerCase())
                .filter(Boolean)
            )
        )
        .catch(() => new Set<string>()),
    ]);
    const annotated = inquiries.map((i) => ({
      ...i,
      hasParentAccount: Boolean(
        i.primary_email &&
          parentEmails.has(i.primary_email.trim().toLowerCase())
      ),
    }));
    return NextResponse.json(annotated);
  } catch (err) {
    return handleAdminError(err);
  }
}
