import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { getFamilyAuth } from "@/lib/family-auth";
import { NextRequest, NextResponse } from "next/server";
import { xano, ensureParentRecord } from "@/lib/xano";
import { smsConsentParentFields } from "@/lib/sms/consent";

async function resolveParents(family: ReturnType<typeof xano.families.getById> extends Promise<infer T> ? T : never) {
  const embedded = xano.families.getEmbeddedParents(family);
  // Xano relation expansion sometimes returns a partial object (id + name) without
  // address fields. Trust the embedded version only when it includes address_line_1;
  // otherwise fall back to a per-id fetch so inputs can pre-fill correctly.
  const embeddedIsComplete =
    embedded.length > 0 &&
    embedded.every((p) => typeof p.address_line_1 === "string");
  if (embeddedIsComplete) return embedded;

  const ids = xano.families.getParentIds(family);
  // A family row can reference a parent id that no longer exists (e.g. a
  // duplicate row removed by the sign-up dedupe). Skip unresolvable ids
  // instead of failing the whole response — one stale reference used to
  // take down the entire GET for that family on every request.
  const settled = await Promise.allSettled(
    ids.map((id) => xano.parents.getById(id))
  );
  return settled
    .filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof xano.parents.getById>>> =>
        r.status === "fulfilled"
    )
    .map((r) => r.value);
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const familyId = user.publicMetadata.registration_families_id as
    | number
    | undefined;
  if (familyId) {
    return NextResponse.json(
      { error: "You already belong to a family" },
      { status: 409 }
    );
  }

  const body = await req.json();
  const {
    // New canonical inputs from the welcome page — primary parent name.
    // We derive `family_name` from these so a parent never has to think
    // about how to phrase "the Walsh Family" themselves.
    first_name: firstNameRaw,
    last_name: lastNameRaw,
    // Legacy input retained so the field still works if any older client
    // is in flight or an admin tool POSTs directly. If both forms are
    // present the explicit `family_name` wins.
    family_name: familyNameRaw,
    address_line_1,
    address_line_2,
    city,
    state,
    zip: zipcode,
    phone: phoneRaw,
    sms_consent: smsConsentRaw,
  } = body ?? {};

  const firstName =
    typeof firstNameRaw === "string" ? firstNameRaw.trim() : "";
  const lastName = typeof lastNameRaw === "string" ? lastNameRaw.trim() : "";
  const explicitFamilyName =
    typeof familyNameRaw === "string" ? familyNameRaw.trim() : "";

  // Validation: either the explicit family_name OR a primary parent last
  // name must be present so we have something to put on the family row.
  if (!explicitFamilyName && !lastName) {
    return NextResponse.json(
      { error: "Primary parent's last name is required" },
      { status: 400 }
    );
  }

  const family_name =
    explicitFamilyName || `${lastName} Family`;

  const parent = await ensureParentRecord(userId, user);

  const phone = typeof phoneRaw === "string" ? phoneRaw.trim() : "";

  // SMS consent from the welcome page's compliance checkbox. Only act
  // when the client actually sent the field (older clients / direct
  // POSTs omit it — leave whatever is on file untouched). The field
  // mapping (checked → provenance + clear opt-out; unchecked →
  // decline provenance + opt-out stamp) lives in lib/sms/consent.ts,
  // shared with the apply-flow parent card's consent toggle.
  const smsConsentFields =
    typeof smsConsentRaw === "boolean"
      ? smsConsentParentFields(smsConsentRaw)
      : {};

  // Persist the (possibly corrected) primary parent name back onto the
  // parent record alongside the address. Falling back to the existing
  // value when a field is empty so we never erase data the Clerk webhook
  // already populated.
  await xano.parents.update(parent.id, {
    first_name: firstName || parent.first_name,
    last_name: lastName || parent.last_name,
    address_line_1: address_line_1 || parent.address_line_1,
    address_line_2: address_line_2 ?? parent.address_line_2,
    city: city || parent.city,
    state: state || parent.state,
    zipcode: zipcode || parent.zipcode,
    phone: phone || parent.phone,
    ...smsConsentFields,
  });

  // Mirror the typed name into Clerk so the user's profile (avatar
  // initials, sign-out menu, etc.) reflects what they entered on the
  // welcome page. Clerk's webhook initially seeded `firstName` /
  // `lastName` from whatever they typed during sign-up, but the welcome
  // page is the first place they're explicitly naming themselves on the
  // application side, so this is where the canonical name lands.
  // Wrapped in try/catch so a Clerk hiccup doesn't fail the family
  // create — the Xano write already succeeded.
  if ((firstName || lastName) && userId) {
    try {
      const clerk = await clerkClient();
      const patch: { firstName?: string; lastName?: string } = {};
      if (firstName) patch.firstName = firstName;
      if (lastName) patch.lastName = lastName;
      await clerk.users.updateUser(userId, patch);
    } catch (err) {
      console.error(
        `Failed to sync welcome-page name to Clerk user ${userId}:`,
        err
      );
    }
  }

  // `isAccepted` / `isSubmitted` are no longer columns on the family
  // row — they live on the per-year `family_application_progress`
  // bridge instead, since acceptance is per-academic-year.
  const family = await xano.families.create({
    family_name,
    bus_transportation: false,
    registration_parents_id: [parent.id],
    registration_students_id: [],
    registration_fee_waiver_id: null,
  });

  const clerk = await clerkClient();
  await clerk.users.updateUserMetadata(userId, {
    publicMetadata: { registration_families_id: family.id },
  });

  return NextResponse.json(family, { status: 201 });
}

export async function GET() {
  const session = await getFamilyAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId, familyId } = session;

  if (familyId) {
    try {
      const family = await xano.families.getById(familyId);
      const parents = await resolveParents(family);
      // Flatten expanded relation arrays to just IDs to reduce payload size
      return NextResponse.json({
        ...family,
        registration_students_id: xano.families.getStudentIds(family),
        registration_parents_id: xano.families.getParentIds(family),
        parents,
      }, { status: 200 });
    } catch (err) {
      // The metadata says this user HAS a family — a failed lookup is a
      // transient Xano error, not "no family". Returning 200-null here
      // poisoned the client SWR cache (null caches as a *successful*
      // response, which never retries and never revalidates), leaving
      // parents on an indefinite loading screen until a hard reload.
      // 503 lets SWR's error-retry recover on its own.
      console.error(`Family lookup failed for family ${familyId}:`, err);
      return NextResponse.json(
        { error: "Family lookup failed, please retry" },
        { status: 503 }
      );
    }
  }

  const parent = await xano.parents.findByClerkId(userId);
  if (!parent) {
    return NextResponse.json(null, { status: 200 });
  }

  const family = await xano.families.findByParentId(parent.id);
  if (!family) {
    return NextResponse.json(null, { status: 200 });
  }

  const clerk = await clerkClient();
  await clerk.users.updateUserMetadata(userId, {
    publicMetadata: { registration_families_id: family.id },
  });

  const parents = await resolveParents(family);
  // Flatten expanded relation arrays to just IDs to reduce payload size
  return NextResponse.json({
    ...family,
    registration_students_id: xano.families.getStudentIds(family),
    registration_parents_id: xano.families.getParentIds(family),
    parents,
  }, { status: 200 });
}

export async function PATCH(req: NextRequest) {
  const session = await getFamilyAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { familyId } = session;
  if (!familyId) {
    return NextResponse.json({ error: "No family found" }, { status: 404 });
  }

  const body = await req.json();
  const updated = await xano.families.update(familyId, body);
  return NextResponse.json(updated, { status: 200 });
}
