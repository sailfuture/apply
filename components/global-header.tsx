"use client";

import { Suspense } from "react";
import Image from "next/image";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useFamily, useSchoolYears, useStudents } from "@/hooks/use-api";
import { familyNameWithStudents } from "@/lib/family-name";
import { MAIN_LINE, MAIN_LINE_DISPLAY } from "@/lib/school-phones";

const REGISTRATION_SEGMENTS = new Set(["tuition", "enrollment-signing", "registration", "volunteer-hours"]);

interface SchoolYear {
  id: number;
  year_name: string;
  isNextYear?: boolean;
  isActive?: boolean;
}

/**
 * The dashboard's year lives in `?yearId`, so this is the one place the
 * header reads search params. It sits under its own Suspense boundary:
 * on statically prerendered routes `useSearchParams` bails its subtree
 * out to client rendering, and keeping that subtree to this span means
 * the rest of the header still ships in the HTML. (A boundary around
 * the whole header flashed an empty bar on first paint; reading the
 * param at click time, the previous workaround, meant the dashboard
 * never showed its year at all, so the year appeared on the
 * registration pages and vanished on the dashboard during sign-in.)
 */
function DashboardYear({
  years,
  hasFamilyName,
}: {
  years: SchoolYear[] | undefined;
  hasFamilyName: boolean;
}) {
  const searchParams = useSearchParams();
  const yearId = Number(searchParams.get("yearId"));
  const year = yearId && years ? years.find((y) => y.id === yearId) : undefined;
  if (!year) return null;
  return (
    <>
      {hasFamilyName ? (
        <span className="mx-1.5" aria-hidden="true">&bull;</span>
      ) : null}
      {year.year_name}
    </>
  );
}

export function GlobalHeader() {
  const router = useRouter();
  const pathname = usePathname();

  // No session exists on the auth pages, so the data hooks stay idle
  // there: each call would 401, wait on clerk-js, retry and 401 again,
  // and the key was then read as settled on the first page after
  // sign-in.
  const isAuthPage =
    pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up");
  const { data: familyData } = useFamily({ enabled: !isAuthPage });
  const { data: yearsData } = useSchoolYears({ enabled: !isAuthPage });
  const { data: studentsData } = useStudents({ enabled: !isAuthPage });

  // "Adams Family (Jorden, Matthew)": the stored name's roster suffix
  // is recomposed from the live student list so a student added,
  // archived or renamed shows up without waiting for the stored name
  // to catch up. Until the students arrive, the stored name stands.
  const storedFamilyName: string | null = familyData?.family_name ?? null;
  const students = studentsData as
    | { first_name?: string; isArchived?: boolean }[]
    | undefined;
  const familyName =
    storedFamilyName && students
      ? familyNameWithStudents(
          storedFamilyName,
          students.filter((s) => !s.isArchived).map((s) => s.first_name)
        ) || storedFamilyName
      : storedFamilyName;

  // The dashboard is the post-enrollment surface — no application or
  // registration chrome should appear there. Strip the "Student Application
  // / Student Registration" suffix and just show the school name.
  const isDashboard = pathname.startsWith("/dashboard");
  // The /welcome page is pre-application onboarding — no need for the
  // "Student Application" suffix yet, just show the school name. Re-enrolling
  // families share the `/apply/year/:id` URL space with new applicants now,
  // so we don't gate on a `/reapply/*` matcher anymore — both render as
  // "Student Application" since the flow is unified.
  const isWelcome = pathname.startsWith("/welcome");
  // `/` is the resolver that decides where the parent belongs, so the
  // header can't know yet; the school name alone keeps the title from
  // reading "Student Application" and then snapping to the real one.
  const isNeutral = isWelcome || isAuthPage || pathname === "/";

  // Detect URL-driven registration vs application chrome. With the
  // family-level `isAccepted` flag gone (it moved to the per-year
  // `family_application_progress` row), we just trust the URL: the
  // root `/` page already redirects accepted families to
  // `/registration/year/X`, so being on a registration URL is
  // equivalent to being accepted as far as the header chrome cares.
  const yearMatch = pathname.match(/\/(?:apply|registration)\/year\/(\d+)/);
  const yearId = yearMatch ? Number(yearMatch[1]) : null;
  const segment = yearMatch
    ? pathname.replace(yearMatch[0], "").replace(/^\//, "").split("/")[0]
    : "";
  const isAccepted = pathname.startsWith("/registration/");
  const isRegistrationFlow = isAccepted || REGISTRATION_SEGMENTS.has(segment);

  // Get school year name
  const years = yearsData as SchoolYear[] | undefined;
  const schoolYear = yearId && years ? years.find((y) => y.id === yearId) : null;
  const yearName = schoolYear?.year_name ?? null;

  const title = isDashboard
    ? "SailFuture Academy Parent Dashboard"
    : isRegistrationFlow
      ? "SailFuture Academy Student Registration"
      : isNeutral
        ? "SailFuture Academy"
        : "SailFuture Academy Student Application";

  // Logo click routes by lifecycle stage. Each branch returns a
  // destination that's already correct for the user — no chained
  // redirects. The `if` ladder short-circuits before falling through to
  // the apply/registration default so users never bounce through pages
  // they shouldn't see. This covers every flow EXCEPT the dashboard,
  // whose `?yearId` is read at click time in `handleLogoClick` below.
  const homeHref = (() => {
    // Stay on the year in the URL — a family can be applying for the
    // current year, not just the upcoming one.
    const targetId =
      yearId ??
      ((years ?? []).find((y) => y.isNextYear) ?? (years ?? []).find((y) => y.isActive))?.id;
    if (!targetId) return "/";
    return isAccepted
      ? `/registration/year/${targetId}`
      : `/apply/year/${targetId}`;
  })();

  // On the parent dashboard the logo stays on the dashboard for whichever
  // year is in view, preserving `?yearId` so the year picker doesn't
  // reset. Read from the live URL at click time so it always reflects
  // the current picker selection.
  const handleLogoClick = () => {
    if (isDashboard) {
      const yearParam =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("yearId")
          : null;
      router.push(yearParam ? `/dashboard?yearId=${yearParam}` : "/dashboard");
      return;
    }
    router.push(homeHref);
  };

  return (
    // `fixed` (not `sticky`) — when Radix opens a Select / Dialog,
    // `react-remove-scroll` engages and freezes the body's scroll
    // position (typically via `position: fixed` + a negative `top`
    // offset on the body to preserve the visual scroll). Sticky
    // elements stop sticking once their scrolling ancestor loses
    // its scroll context, so a previously-sticky header drops
    // away from the top of the viewport the moment a Select opens
    // mid-page — exactly the bug users reported.
    //
    // Fixed positioning sidesteps the scroll-lock entirely since
    // it's anchored to the viewport, not to body flow.
    //
    // NOTE: no `--removed-body-scroll-bar-size` compensation here.
    // globals.css forces `html { overflow-y: scroll; scrollbar-gutter:
    // stable }`, so the scrollbar never actually disappears during the
    // scroll lock — but react-remove-scroll still measures a gap and
    // sets the var, so consuming it double-compensated and shifted the
    // whole bar left by the scrollbar width every time a dropdown
    // opened.
    <header className="fixed inset-x-0 top-0 z-50 border-b bg-white">
      <div className="mx-auto flex h-14 items-center justify-between px-4 lg:px-6">
        {/* Left: Logo (clickable) + Title + Family name */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleLogoClick}
            className="flex size-9 items-center justify-center overflow-hidden rounded-full border-2 border-gray-200 dark:border-gray-700 shadow-sm transition-opacity hover:opacity-80"
          >
            <Image
              src="/logo.svg"
              alt="SailFuture Academy"
              width={36}
              height={36}
              className="size-9 object-cover"
            />
          </button>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight sm:text-base leading-tight">
              {title}
            </span>
            {/* The subtitle line keeps its height from the first paint
                (`min-h-4` = one line of text-xs), so the family name and
                year arriving a moment later never push the title up. */}
            <span className="min-h-4 text-xs text-muted-foreground leading-tight">
              {familyName}
              {familyName && yearName ? (
                <span className="mx-1.5" aria-hidden="true">&bull;</span>
              ) : null}
              {yearName}
              {isDashboard ? (
                <Suspense fallback={null}>
                  <DashboardYear years={years} hasFamilyName={!!familyName} />
                </Suspense>
              ) : null}
            </span>
          </div>
        </div>

        {/* Right: Contact info + Clerk user button */}
        <div className="flex items-center gap-4">
          <div className="hidden flex-col items-end text-xs md:flex">
            <span className="font-semibold text-foreground">Questions?</span>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <a
                href="mailto:admissions@sailfuture.org"
                className="hover:text-primary transition-colors"
              >
                admissions@sailfuture.org
              </a>
              <span aria-hidden="true">&bull;</span>
              <a
                href={`tel:${MAIN_LINE}`}
                className="hover:text-primary transition-colors"
              >
                {MAIN_LINE_DISPLAY}
              </a>
            </div>
          </div>
          <UserButton
            afterSignOutUrl="/sign-in"
            appearance={{
              elements: {
                avatarBox: "size-8",
              },
            }}
          />
        </div>
      </div>
    </header>
  );
}
