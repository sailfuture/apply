"use client";

import Image from "next/image";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useFamily, useSchoolYears } from "@/hooks/use-api";

const REGISTRATION_SEGMENTS = new Set(["tuition", "enrollment-signing", "registration", "volunteer-hours"]);

export function GlobalHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: familyData } = useFamily();
  const { data: yearsData } = useSchoolYears();
  const familyName = familyData?.family_name ?? null;

  // The dashboard is the post-enrollment surface — no application or
  // registration chrome should appear there. Strip the "Student Application
  // / Student Registration" suffix and just show the school name.
  const isDashboard = pathname.startsWith("/dashboard");
  const isReapply = pathname.startsWith("/reapply");
  // The /welcome page is pre-application onboarding — no need for the
  // "Student Application" suffix yet, just show the school name.
  const isWelcome = pathname.startsWith("/welcome");

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
  const schoolYear = yearId && yearsData
    ? (yearsData as { id: number; year_name: string }[]).find((y) => y.id === yearId)
    : null;
  const yearName = schoolYear?.year_name ?? null;

  const title = isDashboard
    ? "SailFuture Academy Parent Dashboard"
    : isReapply
      ? "SailFuture Academy Re-Application"
      : isRegistrationFlow
        ? "SailFuture Academy Student Registration"
        : isWelcome
          ? "SailFuture Academy"
          : "SailFuture Academy Student Application";

  // Logo click routes by lifecycle stage. Each branch returns a
  // destination that's already correct for the user — no chained
  // redirects. The `if` ladder short-circuits before falling through to
  // the apply/registration default so users never bounce through pages
  // they shouldn't see.
  const homeHref = (() => {
    // On the parent dashboard, logo just stays on the dashboard for
    // whichever year is currently in view. Preserves `?yearId` so the
    // year picker doesn't reset when the user clicks home.
    if (isDashboard) {
      const yearParam = searchParams.get("yearId");
      return yearParam ? `/dashboard?yearId=${yearParam}` : "/dashboard";
    }
    // Re-application is for already-enrolled families — sending them
    // back to the dashboard is the right "home" gesture, even though
    // they're applying for next year.
    if (isReapply) return "/dashboard";

    const years =
      (yearsData as
        | { id: number; isNextYear?: boolean; isActive?: boolean }[]
        | undefined) ?? [];
    const target =
      years.find((y) => y.isNextYear) ?? years.find((y) => y.isActive) ?? null;
    if (!target) return "/";
    return isAccepted
      ? `/registration/year/${target.id}`
      : `/apply/year/${target.id}`;
  })();

  return (
    // `sticky` (not `fixed`) — Radix-based dropdowns/dialogs lock
    // body scroll by adding `padding-right` to the body to
    // compensate for the scrollbar disappearance. A `position: fixed`
    // header is anchored to the viewport and doesn't shift with the
    // body, so it visually slides offscreen the moment a Select
    // opens. Sticky lives in the document flow and respects the
    // body padding, so the header stays anchored when Radix locks
    // scroll. Matches the admin top nav's pattern.
    <header className="sticky top-0 z-50 border-b bg-white">
      <div className="mx-auto flex h-14 items-center justify-between px-4 lg:px-6">
        {/* Left: Logo (clickable) + Title + Family name */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(homeHref)}
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
            {(familyName || yearName) && (
              <span className="text-xs text-muted-foreground leading-tight">
                {familyName}{familyName && yearName && <span className="mx-1.5" aria-hidden="true">&bull;</span>}{yearName}
              </span>
            )}
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
                href="tel:+17279001436"
                className="hover:text-primary transition-colors"
              >
                (727) 900-1436
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
