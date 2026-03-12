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
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type ApplicationStatus = "incomplete" | "submitted" | "accepted";

function getApplicationStatus(
  isAccepted: boolean,
  hasApplications: boolean,
  statusName: string | null
): ApplicationStatus {
  if (isAccepted) return "accepted";
  if (hasApplications && statusName?.toLowerCase() === "submitted")
    return "submitted";
  return "incomplete";
}

function StatusBanner({ status }: { status: ApplicationStatus }) {
  if (status === "accepted") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-800 dark:bg-green-950/30">
        <svg
          className="size-5 shrink-0 text-green-600 dark:text-green-400"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
            clipRule="evenodd"
          />
        </svg>
        <div>
          <p className="text-sm font-medium text-green-800 dark:text-green-300">
            Application Accepted
          </p>
          <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
            Congratulations! Your family has been accepted to SailFuture Academy.
          </p>
        </div>
      </div>
    );
  }

  if (status === "submitted") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
        <svg
          className="size-5 shrink-0 text-amber-600 dark:text-amber-400"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z"
            clipRule="evenodd"
          />
        </svg>
        <div>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            Application Submitted &mdash; Pending Review
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
            Your application has been submitted and is being reviewed by our team. We&apos;ll be in touch soon.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-950/30">
      <svg
        className="size-5 shrink-0 text-blue-600 dark:text-blue-400"
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
          clipRule="evenodd"
        />
      </svg>
      <div>
        <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
          Application Incomplete
        </p>
        <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
          Your application is not yet complete. Use the sidebar to fill out each section, then submit when ready.
        </p>
      </div>
    </div>
  );
}

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

  let familyName = "";
  let isAccepted = false;
  try {
    const family = await xano.families.getById(familyId);
    familyName = family.family_name;
    isAccepted = family.isAccepted ?? false;
  } catch {
    // fallback
  }

  let upcomingYear: { id: number; year_name: string } | null = null;
  let activeYear: { id: number; year_name: string } | null = null;
  try {
    const years = await xano.schoolYears.getAll();
    upcomingYear = years.find((y) => y.isNextYear) ?? null;
    activeYear = years.find((y) => y.isActive) ?? null;
  } catch {
    // fallback
  }

  const targetYear = upcomingYear ?? activeYear;

  let statusName: string | null = null;
  let hasApplications = false;
  try {
    const apps = await xano.applications.getByFamilyId(familyId);
    hasApplications = apps.length > 0;
    if (hasApplications && apps[0].registration_application_status_id) {
      const appStatus = await xano.applicationStatuses.getById(
        apps[0].registration_application_status_id
      );
      statusName = appStatus.status_name;
    }
  } catch {
    // fallback
  }

  const appStatus = getApplicationStatus(isAccepted, hasApplications, statusName);
  const firstName = user.firstName ?? familyName;

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
      <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <StatusBanner status={appStatus} />

        <div>
          <h1 className="text-2xl font-semibold">
            Welcome{firstName ? `, ${firstName}` : ""}!
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Thank you for your interest in SailFuture Academy. Complete each
            section of your application using the sidebar navigation.
          </p>
        </div>

        {targetYear && appStatus !== "accepted" && (
          <Card>
            <CardHeader>
              <CardTitle>
                {upcomingYear
                  ? `Apply for ${upcomingYear.year_name}`
                  : `Continue ${activeYear?.year_name} Application`}
              </CardTitle>
              <CardDescription>
                {appStatus === "submitted"
                  ? "Your application has been submitted. You can still review it below."
                  : upcomingYear
                    ? "Applications are open for the upcoming school year. Start or continue your application."
                    : "Review or update your application for the current school year."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/apply/year/${targetYear.id}`}>
                <Button>
                  {appStatus === "submitted"
                    ? "Review Application"
                    : "Continue Application"}{" "}
                  &rarr;
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {!targetYear && (
          <Card>
            <CardHeader>
              <CardTitle>No Open Application Period</CardTitle>
              <CardDescription>
                There are no school years currently accepting applications.
                Check back later or contact the school for more information.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </>
  );
}
