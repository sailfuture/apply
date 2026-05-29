"use client";

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
 * `GlobalHeader` renders directly (no Suspense). It used to sit under a
 * boundary because it called `useSearchParams` — which forces a CSR
 * bailout on statically-prerendered routes unless wrapped — and the empty
 * fallback bar flashed on first paint before the real header hydrated.
 * The header now reads `?yearId` at click time instead of via the hook,
 * so it renders in the initial markup with no boundary and no flash.
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
      <GlobalHeader />
      <main className="pt-14 pb-16 min-h-screen">
        <TooltipProvider>{children}</TooltipProvider>
      </main>
      <GlobalFooter />
    </>
  );
}
