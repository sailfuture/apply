import type { Metadata } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { isStudentAccountEmail } from "@/lib/xano";
import { MAIN_LINE, MAIN_LINE_DISPLAY } from "@/lib/school-phones";
import { StudentAccountSignOut } from "@/components/student-account-sign-out";

export const metadata: Metadata = {
  title: "Student accounts can't sign in — SailFuture Academy",
};

/**
 * Where a student's school Google account lands instead of the parent
 * portal. See `lib/student-accounts.ts` for the rule and the other
 * enforcement points. Anyone who isn't such an account is sent back
 * through the `/` resolver, and an admin who types the URL goes to
 * /admin.
 */
export default async function StudentAccountPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  if (await getCurrentAdmin()) redirect("/admin");

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  if (!(await isStudentAccountEmail(email))) redirect("/");

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">
        This portal is for parents and guardians
      </h1>

      <div className="mt-6 space-y-4 text-sm leading-relaxed text-foreground/90">
        <p>
          You&rsquo;re signed in as{" "}
          <span className="font-medium text-foreground">{email}</span>. That
          is a student&rsquo;s SailFuture school account, and student
          accounts can&rsquo;t be used here. The application, registration,
          and tuition pages in this portal belong to a student&rsquo;s parent
          or guardian.
        </p>
        <p>
          <span className="font-medium text-foreground">
            If you&rsquo;re a student:
          </span>{" "}
          ask your parent or guardian to sign in with their own email.
          Everything about your enrollment is already in their account.
        </p>
        <p>
          <span className="font-medium text-foreground">
            If you&rsquo;re a parent or guardian:
          </span>{" "}
          sign out and sign back in with your own email address, the one you
          used when you applied.
        </p>
        <p className="text-muted-foreground">
          Questions? Call the school at{" "}
          <a href={`tel:${MAIN_LINE}`} className="underline underline-offset-2">
            {MAIN_LINE_DISPLAY}
          </a>{" "}
          or email{" "}
          <a
            href="mailto:dean@sailfuture.org"
            className="underline underline-offset-2"
          >
            dean@sailfuture.org
          </a>
          .
        </p>
      </div>

      <div className="mt-8">
        <StudentAccountSignOut />
      </div>
    </div>
  );
}
