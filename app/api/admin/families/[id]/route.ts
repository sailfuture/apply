import { requireAdmin, handleAdminError } from "@/lib/admin-auth";
import { NextRequest, NextResponse, after } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import {
  xano,
  activeStripeSubscriptionId,
  tourLeadFk,
  LEAD_NOTE_SOURCES,
  type LeadNoteSource,
} from "@/lib/xano";
import { getStripeClient } from "@/lib/stripe";
import { setToddleArchiveState } from "@/lib/toddle-sync";
import {
  leadConvertedFamilyId,
  writeLeadConversion,
  UNLINKED,
} from "@/lib/lead-conversion";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const family = await xano.families.getById(Number(id));
    return NextResponse.json(family);
  } catch (err) {
    return handleAdminError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json();
    const updated = await xano.families.update(Number(id), body);
    return NextResponse.json(updated);
  } catch (err) {
    return handleAdminError(err);
  }
}

/**
 * Permanently delete a family and everything registration knows about
 * them. Triggered from the Danger Zone on the family overview page
 * (type-the-name confirmation lives client-side).
 *
 * Cascade, in order:
 *   1. Cancel every live Stripe subscription — BLOCKING. If Stripe
 *      can't cancel, nothing is deleted: the payment rows are the only
 *      local handle on the subscription, and destroying them first
 *      would turn a transient Stripe error into permanent invisible
 *      billing.
 *   2. Applications, registration packets, student rows (each student
 *      is archived in Toddle best-effort, off the response path).
 *   3. Family-level rows: application/registration progress,
 *      scholarship + children, emergency contacts, volunteer hours,
 *      payment snapshots.
 *   4. Parent rows + their Clerk accounts (skipped with a warning when
 *      the Clerk user is shared with a parent row outside this family).
 *   5. The family row itself.
 *
 * DELIBERATELY KEPT: admin notes, SMS history, the Stripe invoice
 * mirror, sent-email log, and store orders — comms + financial history
 * survive as an audit trail. After the family row is gone, a pinned
 * "family was deleted" note is written into that kept history, and the
 * same marker is posted onto every recruitment lead that had converted
 * into this family (the lead links are cleared so they return to the
 * pipeline instead of pointing at a dead row).
 *
 * Failures after the Stripe gate are collected as warnings rather than
 * aborting mid-cascade — a half-deleted family with a clear warning
 * list beats stopping in a state no surface can render.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin } = await requireAdmin();
    const { id: idParam } = await params;
    const familyId = Number(idParam);
    if (!Number.isFinite(familyId) || familyId <= 0) {
      return NextResponse.json({ error: "Invalid family id" }, { status: 400 });
    }

    let family;
    try {
      family = await xano.families.getById(familyId);
    } catch {
      return NextResponse.json({ error: "Family not found" }, { status: 404 });
    }
    const familyName = family.family_name?.trim() || `Family #${familyId}`;
    const warnings: string[] = [];
    const failed = (label: string) => (r: PromiseSettledResult<unknown>) => {
      if (r.status === "rejected") {
        console.error(`[families/${familyId} DELETE] ${label}:`, r.reason);
        warnings.push(
          `${label}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`
        );
      }
    };

    // ── 1. Stripe gate (blocking) ────────────────────────────────────
    // Throws on transport failure → 500 with nothing deleted.
    const paymentRows = await xano.familyPayments.getAllByFamily(familyId);
    const stripe = getStripeClient();
    for (const row of paymentRows) {
      const subId = activeStripeSubscriptionId(row.stripe_subscription_id);
      if (!subId) continue;
      try {
        await stripe.subscriptions.cancel(subId);
      } catch (err) {
        // A subscription that's already gone or already canceled is
        // the state we want — only a live-but-uncancelable one blocks.
        const code = (err as { code?: string }).code;
        const msg = err instanceof Error ? err.message : String(err);
        const alreadyDone =
          code === "resource_missing" || /canceled subscription/i.test(msg);
        if (alreadyDone) continue;
        console.error(
          `[families/${familyId} DELETE] refusing — Stripe cancel failed for ${subId}:`,
          err
        );
        return NextResponse.json(
          {
            error: `This family has a live billing subscription (${subId}) and canceling it failed. Nothing was deleted — try again, or cancel it in the Stripe Dashboard first.`,
          },
          { status: 502 }
        );
      }
    }

    // ── 2. Students, applications, packets ───────────────────────────
    const apps = await xano.applications
      .getByFamilyId(familyId)
      .catch(() => []);
    const students = await xano.students
      .getByFamilyId(familyId)
      .catch(() => []);

    (
      await Promise.allSettled(apps.map((a) => xano.applications.delete(a.id)))
    ).forEach(failed("delete application"));

    for (const student of students) {
      const packetIds = Array.isArray(student.registration_student_registration_id)
        ? student.registration_student_registration_id.filter(
            (p): p is number => typeof p === "number"
          )
        : [];
      (
        await Promise.allSettled(
          packetIds.map((pid) => xano.studentRegistration.delete(pid))
        )
      ).forEach(failed(`delete packet for student #${student.id}`));

      const sid = student.id;
      const toddleId = student.toddle_student_id;
      after(async () => {
        try {
          await setToddleArchiveState(sid, toddleId, true);
        } catch (err) {
          console.error(
            `[families/${familyId} DELETE] Toddle archive for student #${sid} failed:`,
            err
          );
        }
      });

      try {
        await xano.students.delete(sid);
      } catch (err) {
        failed(`delete student #${sid}`)({
          status: "rejected",
          reason: err,
        } as PromiseRejectedResult);
      }
    }

    // ── 3. Family-level rows ─────────────────────────────────────────
    const [appProgress, regProgress] = await Promise.all([
      xano.familyApplicationProgress.getAll(),
      xano.studentRegistrationProgress.getAll(),
    ]);
    (
      await Promise.allSettled(
        appProgress
          .filter((r) => Number(r.registration_families_id) === familyId)
          .map((r) => xano.familyApplicationProgress.delete(r.id))
      )
    ).forEach(failed("delete application-progress row"));
    (
      await Promise.allSettled(
        regProgress
          .filter((r) => Number(r.registration_families_id) === familyId)
          .map((r) => xano.studentRegistrationProgress.delete(r.id))
      )
    ).forEach(failed("delete registration-progress row"));

    // Scholarships — children first (Xano rejects the parent delete on
    // FK constraint otherwise).
    const scholarships = (await xano.scholarship.getAll().catch(() => [])).filter(
      (s) => Number(s.registration_families_id) === familyId
    );
    for (const s of scholarships) {
      try {
        const { homes, vehicles, contributing_members, benefits } =
          await xano.scholarship.getByIdWithChildren(s.id);
        (
          await Promise.allSettled([
            ...benefits.map((b) => xano.scholarshipBenefits.delete(b.id)),
            ...vehicles.map((v) => xano.scholarshipVehicles.delete(v.id)),
            ...homes.map((h) => xano.scholarshipHomes.delete(h.id)),
            ...contributing_members.map((m) =>
              xano.scholarshipContributingMembers.delete(m.id)
            ),
          ])
        ).forEach(failed(`delete scholarship #${s.id} child`));
        await xano.scholarship.delete(s.id);
      } catch (err) {
        failed(`delete scholarship #${s.id}`)({
          status: "rejected",
          reason: err,
        } as PromiseRejectedResult);
      }
    }

    const contacts = await xano.emergencyContacts
      .getByFamilyId(familyId)
      .catch(() => []);
    (
      await Promise.allSettled(
        contacts.map((c) => xano.emergencyContacts.delete(c.id))
      )
    ).forEach(failed("delete emergency contact"));

    const hours = await xano.volunteerHours.getByFamily(familyId);
    (
      await Promise.allSettled(hours.map((h) => xano.volunteerHours.delete(h.id)))
    ).forEach(failed("delete volunteer-hours entry"));

    (
      await Promise.allSettled(
        paymentRows.map((p) => xano.familyPayments.delete(p.id))
      )
    ).forEach(failed("delete payment row"));

    // ── 4. Parents + Clerk accounts ──────────────────────────────────
    const parentIds = xano.families.getParentIds(family);
    // Full parent table read so a Clerk account shared with a parent
    // row OUTSIDE this family (historical duplicates) is never deleted.
    const allParents = await xano.parents.getAll().catch(() => null);
    const familyParents = allParents
      ? allParents.filter((p) => parentIds.includes(p.id))
      : [];
    if (!allParents) {
      warnings.push(
        "Couldn't read the parents table — parent rows and Clerk accounts were left in place. Delete them manually."
      );
    }
    const clerk = await clerkClient();
    for (const parent of familyParents) {
      const clerkId = (parent.clerk_user_id ?? "").trim();
      if (clerkId) {
        const sharedElsewhere = allParents!.some(
          (p) =>
            p.id !== parent.id &&
            !parentIds.includes(p.id) &&
            (p.clerk_user_id ?? "").trim() === clerkId
        );
        if (sharedElsewhere) {
          warnings.push(
            `Clerk account ${clerkId} (${parent.email}) is shared with a parent in another family — account NOT deleted.`
          );
        } else {
          try {
            await clerk.users.deleteUser(clerkId);
          } catch (err) {
            // An account that's already gone is fine; anything else is
            // a loud warning — an orphaned login that signs in later
            // would seed a brand-new empty family.
            const status = (err as { status?: number }).status;
            if (status !== 404) {
              console.error(
                `[families/${familyId} DELETE] Clerk delete failed for ${clerkId}:`,
                err
              );
              warnings.push(
                `Couldn't delete the Clerk account for ${parent.email} — remove it in the Clerk dashboard, or they can sign in and land in an empty apply flow.`
              );
            }
          }
        }
      }
      try {
        await xano.parents.delete(parent.id);
      } catch (err) {
        failed(`delete parent #${parent.id}`)({
          status: "rejected",
          reason: err,
        } as PromiseRejectedResult);
      }
    }

    // ── 5. The family row ────────────────────────────────────────────
    try {
      await xano.families.delete(familyId);
    } catch (err) {
      console.error(
        `[families/${familyId} DELETE] family-row delete failed:`,
        err
      );
      return NextResponse.json(
        {
          error:
            "The family's records were removed but deleting the family row itself failed — retry the delete to finish.",
          warnings,
        },
        { status: 502 }
      );
    }

    // ── Post-delete markers (kept history) ───────────────────────────
    const marker = `Family "${familyName}" was permanently deleted from registration by ${admin.name}. Students, applications, registration packets, billing, and parent accounts were removed; notes and text-message history were kept.`;
    const noteBase = {
      registration_students_id: null,
      registration_school_years_id: null,
      registration_student_registration_progress_id: null,
      registration_family_application_progress_id: null,
      author_email: admin.email,
      author_name: admin.name,
      body: marker,
      category: "other",
      is_pinned: true,
    };
    // Into the family's own (now orphaned, deliberately kept) note
    // history, so the trail in Xano ends with the explanation.
    try {
      await xano.adminNotes.create({ registration_families_id: familyId, ...noteBase });
    } catch (err) {
      console.error(`[families/${familyId} DELETE] marker note failed:`, err);
      warnings.push("Couldn't write the deletion note on the family history.");
    }

    // Onto every lead that had converted into this family — visible in
    // each lead's activity log — then clear the conversion link so the
    // lead stops pointing at a dead row.
    const [inquiries, campRows, waivers, tascoRows] = await Promise.all([
      xano.inquiries.getAll().catch(() => []),
      xano.summerCamp.getAll().catch(() => []),
      xano.websiteWaivers.getAll().catch(() => []),
      xano.tascoSummerVisits.getAll().catch(() => []),
    ]);
    const leadRows: Record<
      LeadNoteSource,
      Array<{ id: number; registration_families_id?: unknown }>
    > = {
      inquiry: inquiries,
      camp: campRows,
      visit: waivers,
      tasco: tascoRows,
    };
    for (const source of LEAD_NOTE_SOURCES) {
      for (const row of leadRows[source]) {
        if (leadConvertedFamilyId(row) !== familyId) continue;
        try {
          await xano.adminNotes.create({
            registration_families_id: 0,
            ...noteBase,
            ...tourLeadFk({ source, id: row.id }),
          });
        } catch (err) {
          console.error(
            `[families/${familyId} DELETE] lead note failed for ${source} #${row.id}:`,
            err
          );
          warnings.push(`Couldn't write the deletion note on ${source} #${row.id}.`);
        }
        try {
          await writeLeadConversion(source, row.id, UNLINKED);
        } catch (err) {
          console.error(
            `[families/${familyId} DELETE] unlink failed for ${source} #${row.id}:`,
            err
          );
          warnings.push(`Couldn't clear the conversion link on ${source} #${row.id}.`);
        }
      }
    }

    return NextResponse.json({ ok: true, familyName, warnings });
  } catch (err) {
    return handleAdminError(err);
  }
}
