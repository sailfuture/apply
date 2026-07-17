"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { YearSelector } from "@/components/admin/year-selector";
import { cn } from "@/lib/utils";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface NavLeaf {
  title: string;
  href: string;
  /** Path matcher used to decide active state. Defaults to `startsWith(href)`,
   *  but the dashboard ("/admin") needs an exact match so it doesn't light up
   *  on every sub-route. */
  matchExact?: boolean;
}

/** Either a plain link or a labeled dropdown of links. */
type NavItem = NavLeaf | { title: string; children: NavLeaf[] };

// Pipeline intentionally hidden from the nav — file still exists at
// /admin/pipeline but we're not surfacing it while we focus on the
// daily-job applications + inquiries + records flow.
const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", href: "/admin", matchExact: true },
  // Recruitment — the pre-application funnel: prospective-family
  // inquiries, the standalone summer-camp program, and campus-visit
  // liability waivers signed on the marketing site.
  {
    title: "Recruitment",
    children: [
      { title: "Inquiries", href: "/admin/inquiries" },
      { title: "Summer Camp", href: "/admin/summer-camp" },
      { title: "Campus Visits", href: "/admin/campus-visits" },
    ],
  },
  // Applications now folds in re-applications (with a `flow_type` pill
  // on each row), so the standalone Re-Applications nav item is gone.
  { title: "Applications", href: "/admin/applications" },
  { title: "Registrations", href: "/admin/registrations" },
  { title: "Enrolled", href: "/admin/enrolled" },
  // Two-way SMS inbox + filtered group messaging.
  { title: "Messages", href: "/admin/messages" },
  // Billing — shows every family with a Stripe subscription on file
  // for the selected year, with quick filters for past-due families.
  // Each row drills into the family registration detail page's
  // Billing card for actions (pause / cancel / refund / update amount).
  { title: "Billing", href: "/admin/billing" },
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
    // `fixed` (not `sticky`) — when Radix opens a Select / Dialog,
    // `react-remove-scroll` engages and freezes the body's scroll
    // position. Sticky elements stop sticking the moment their
    // scrolling ancestor loses its scroll context, so a previously-
    // sticky header drops away from the top of the viewport mid-page
    // the moment a Select opens. Fixed positioning is anchored to the
    // viewport directly so it stays put. Layout adds `pt-14` to
    // `<main>` so content doesn't tuck under the fixed header.
    //
    // NOTE: no `--removed-body-scroll-bar-size` compensation here.
    // globals.css forces `html { overflow-y: scroll; scrollbar-gutter:
    // stable }`, so the scrollbar never actually disappears during the
    // scroll lock — but react-remove-scroll still measures a gap and
    // sets the var, so consuming it double-compensated and shifted the
    // whole bar left by the scrollbar width every time a dropdown
    // opened.
    <header className="fixed inset-x-0 top-0 z-50 border-b bg-white">
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
            // Shared pill styling — active link: bold + filled pill so
            // the user's current page is unmistakable. Inactive links
            // stay medium-weight so the bar reads as a calm row rather
            // than competing for attention.
            const pill = (active: boolean) =>
              cn(
                "inline-flex items-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                active
                  ? "bg-muted text-foreground font-bold"
                  : "font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              );

            if ("children" in item) {
              // Dropdown group — lights up when ANY child route is
              // the current page.
              const groupActive = item.children.some((c) =>
                c.matchExact ? pathname === c.href : pathname.startsWith(c.href)
              );
              return (
                <DropdownMenu key={item.title}>
                  <DropdownMenuTrigger
                    className={cn(pill(groupActive), "gap-1 outline-none")}
                  >
                    {item.title}
                    <ChevronDown className="size-3.5 opacity-60" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {item.children.map((child) => {
                      const childActive = child.matchExact
                        ? pathname === child.href
                        : pathname.startsWith(child.href);
                      return (
                        <DropdownMenuItem key={child.href} asChild>
                          <Link
                            href={buildHref(child.href)}
                            className={cn(
                              "w-full cursor-pointer",
                              childActive && "font-semibold"
                            )}
                          >
                            {child.title}
                          </Link>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            }

            const active = item.matchExact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={buildHref(item.href)}
                className={pill(active)}
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
