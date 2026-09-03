import { auth, currentUser } from "@clerk/nextjs/server";

/**
 * Parent-side request identity: the Clerk user id plus the Xano
 * `registration_families.id` the account belongs to.
 *
 * The family id lives in Clerk `publicMetadata.registration_families_id`
 * (stamped server-side by `/api/families` GET/POST and the `/` resolver).
 * Every parent API route used to read it via `currentUser()`, which is a
 * network round trip to Clerk's Backend API on EVERY request — the single
 * biggest fixed cost per API call on the dashboard.
 *
 * `getFamilyAuth()` reads it from the session token claims instead
 * (`auth()` verifies the JWT locally — no network). That requires the
 * Clerk instance's session token to be customized with:
 *
 *     {
 *       "familyId": "{{user.public_metadata.registration_families_id}}",
 *       "email": "{{user.primary_email_address}}"
 *     }
 *
 * (Clerk Dashboard → Configure → Sessions → Customize session token.)
 *
 * Until that's configured — or for the ~60s window after a family id is
 * first stamped, before clerk-js mints a fresh token — the claim is
 * absent and we fall back to `currentUser()`, so behaviour is identical
 * to the old code path. Nothing breaks if the template is missing; it's
 * just slower.
 */
export interface FamilyAuth {
  userId: string;
  /** The parent's family id, or `undefined` when the account has no
   *  family yet (fresh sign-up before `/welcome` completes). */
  familyId: number | undefined;
}

/** Coerce a metadata / claim value into a positive integer family id. */
export function toFamilyId(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n > 0
    ? n
    : undefined;
}

/** Family id from a verified session-token payload, if the claim is
 *  present and well-formed. Tolerates the claim arriving as a string
 *  (Clerk templates stringify shortcodes embedded in longer strings). */
export function familyIdFromClaims(claims: unknown): number | undefined {
  if (!claims || typeof claims !== "object") return undefined;
  return toFamilyId((claims as Record<string, unknown>).familyId);
}

/** Primary email from a verified session-token payload, if present. */
export function emailFromClaims(claims: unknown): string | undefined {
  if (!claims || typeof claims !== "object") return undefined;
  const email = (claims as Record<string, unknown>).email;
  return typeof email === "string" && email.includes("@")
    ? email.trim().toLowerCase()
    : undefined;
}

/**
 * Resolve the signed-in parent's identity. Returns `null` when the
 * request carries no valid Clerk session (callers respond 401).
 *
 * Fast path: family id from the session-token claim (no network).
 * Fallback: `currentUser()` → `publicMetadata.registration_families_id`.
 */
export async function getFamilyAuth(): Promise<FamilyAuth | null> {
  const { userId, sessionClaims } = await auth();
  if (!userId) return null;

  const fromClaims = familyIdFromClaims(sessionClaims);
  if (fromClaims !== undefined) {
    return { userId, familyId: fromClaims };
  }

  const user = await currentUser();
  if (!user) return null;
  return {
    userId,
    familyId: toFamilyId(user.publicMetadata.registration_families_id),
  };
}
