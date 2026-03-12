import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { xano, ensureParentRecord } from "@/lib/xano";

export default async function Page() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  let familyId = user.publicMetadata.registration_families_id as
    | number
    | undefined;

  if (!familyId) {
    const parent = await ensureParentRecord(userId, user);
    const family = await xano.families.findByParentId(parent.id);

    if (!family) redirect("/welcome");

    const clerk = await clerkClient();
    await clerk.users.updateUserMetadata(userId, {
      publicMetadata: { registration_families_id: family.id },
    });
    familyId = family.id;
  }

  let targetYearId: number | null = null;
  try {
    const years = await xano.schoolYears.getAll();
    const upcoming = years.find((y) => y.isNextYear);
    const active = years.find((y) => y.isActive);
    const target = upcoming ?? active;
    if (target) targetYearId = target.id;
  } catch {
    // fallback
  }

  if (targetYearId) {
    redirect(`/apply/year/${targetYearId}`);
  }

  redirect("/apply");
}
