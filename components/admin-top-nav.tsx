"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { YearSelector } from "@/components/admin/year-selector";
import { cn } from "@/lib/utils";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface NavItem {
  title: string;
  href: string;
  /** Path matcher used to decide active state. Defaults to `startsWith(href)`,
   *  but the dashboard ("/admin") needs an exact match so it doesn't light up
   *  on every sub-route. */
  matchExact?: boolean;
}

// Pipeline intentionally hidden from the nav — file still exists at
// /admin/pipeline but we're not surfacing it while we focus on the
// daily-job applications + inquiries + records flow.
const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", href: "/admin", matchExact: true },
  { title: "Inquiries", href: "/admin/inquiries" },
  { title: "Applications", href: "/admin/applications" },
  { title: "Registrations", href: "/admin/registrations" },
  { title: "Students", href: "/admin/students" },
  { title: "Families", href: "/admin/families" },
  { title: "School Years", href: "/admin/school-years" },
];

/**
 * Sticky top-nav for the admin tool. Replaces the previous left sidebar
 * layout. Style mirrors the parent dashboard's `GlobalHeader` so the two
 * surfaces feel like the same product:
 *   - Sticky white bar with bottom border, h-14
 *   - Logo (clickable → /admin) on the far left
 *   - Inline nav links — active link highlighted with a muted pill
 *   - Year picker + Clerk user avatar on the right
 *
 * Click handler on the logo points to `/admin` directly so we don't repeat
 * the dashboard's own redirect dance — admin tool is its own home.
 */
export function AdminTopNav({ admin }: { admin: AdminUser | null }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  const buildHref = React.useCallback(
    (base: string) => (yearId ? `${base}?yearId=${yearId}` : base),
    [yearId]
  );

  return (
    <header className="sticky top-0 z-50 border-b bg-white">
      {/* Inner container is constrained to the same max-width as the page
          content (`max-w-7xl` on the layout's `<main>`), so the bar's
          contents line up vertically with everything below it instead of
          stretching edge-to-edge. */}
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 lg:px-6">
        {/* Logo → /admin */}
        <Link
          href={buildHref("/admin")}
          className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-gray-200 shadow-sm transition-opacity hover:opacity-80"
          aria-label="Admin home"
        >
          <Image
            src="/logo.svg"
            alt="SailFuture Academy"
            width={36}
            height={36}
            className="size-9 object-cover"
          />
        </Link>

        {/* Nav links — text only, no icons. Scrollable on narrow viewports
            so nothing ever gets clipped without a way to reach it. */}
        <nav className="flex flex-1 items-center gap-0.5 overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const active = item.matchExact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={buildHref(item.href)}
                className={cn(
                  "inline-flex items-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                {item.title}
              </Link>
            );
          })}
        </nav>

        {/* Right: year picker + Clerk avatar. Year picker is compact here so
            it doesn't dominate the bar. */}
        <div className="flex shrink-0 items-center gap-3">
          <div className="w-44">
            <YearSelector />
          </div>
          <UserButton
            afterSignOutUrl="/sign-in"
            appearance={{
              elements: {
                avatarBox: "size-8",
              },
            }}
          />
          {/* Hidden screen-reader hint about who's signed in — keeps the
              admin name accessible without crowding the bar visually. */}
          {admin ? (
            <span className="sr-only">
              Signed in as {admin.name} ({admin.email})
            </span>
          ) : null}
        </div>
      </div>
    </header>
  );
}
