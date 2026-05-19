"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GlobalHeader } from "@/components/global-header";
import { GlobalFooter } from "@/components/global-footer";

/**
 * Decides which chrome surrounds the page.
 *
 * Admin routes (`/admin/*`) get NO chrome from this component — the admin
 * route group has its own layout (sidebar + sidebar inset) that supplies a
 * full-page shell, so layering the parent-side `GlobalHeader` on top would
 * stack two logos and route the logo click through redirects intended for
 * a parent context. Everything else gets the standard parent shell:
 * fixed header, bottom-padded main, footer.
 *
 * `GlobalHeader` is wrapped in Suspense because it calls `useSearchParams`
 * (to preserve `?yearId` across logo clicks). In Next.js 16, any
 * `useSearchParams` consumer that's reachable from a statically-prerendered
 * route must sit inside a Suspense boundary, otherwise the whole subtree
 * triggers a CSR-bailout error during build. The lightweight skeleton
 * stand-in keeps the layout's reserved 14px header height intact while
 * the search-params hydrate on the client.
 */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith("/admin");

  if (isAdmin) {
    return (
      <main className="min-h-screen">
        <TooltipProvider>{children}</TooltipProvider>
      </main>
    );
  }

  return (
    <>
      {/* Header is `fixed` (not `sticky`) because Radix's
          `react-remove-scroll` (used by Select/Dialog) freezes the
          body's scroll position when a dropdown opens — sticky
          elements drop away from the viewport mid-page when that
          happens. Fixed positioning is anchored to the viewport
          directly so it stays put. Scrollbar-width compensation
          lives on the header itself via the
          `--removed-body-scroll-bar-size` CSS var; `<main>`
          reserves the 14px slot with `pt-14` so content doesn't
          tuck under the fixed header. */}
      <Suspense
        fallback={
          <header className="fixed inset-x-0 top-0 z-50 h-14 border-b bg-white" />
        }
      >
        <GlobalHeader />
      </Suspense>
      <main className="pt-14 pb-16 min-h-screen">
        <TooltipProvider>{children}</TooltipProvider>
      </main>
      <GlobalFooter />
    </>
  );
}
