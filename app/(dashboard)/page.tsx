import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { xano, ensureParentRecord } from "@/lib/xano";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

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

    if (!family) redirect("/family");

    const clerk = await clerkClient();
    await clerk.users.updateUserMetadata(userId, {
      publicMetadata: { registration_families_id: family.id },
    });
    familyId = family.id;
  }

  const hasPhone = user.phoneNumbers.length > 0;

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-4 data-vertical:self-auto"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Dashboard</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        {!hasPhone && (
          <Link
            href="/account/add-phone"
            className="flex items-center justify-between rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 dark:border-yellow-900/50 dark:bg-yellow-900/20"
          >
            <div>
              <p className="font-medium text-yellow-800 dark:text-yellow-200">
                Add your phone number
              </p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                Add a phone number to your account so we can reach you.
              </p>
            </div>
            <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              Add now &rarr;
            </span>
          </Link>
        )}
        <div className="grid auto-rows-min gap-4 md:grid-cols-3">
          <div className="bg-muted/50 aspect-video rounded-xl" />
          <div className="bg-muted/50 aspect-video rounded-xl" />
          <div className="bg-muted/50 aspect-video rounded-xl" />
        </div>
        <div className="bg-muted/50 min-h-screen flex-1 rounded-xl md:min-h-min" />
      </div>
    </>
  );
}
