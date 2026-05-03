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
      <GlobalHeader />
      <main className="pt-14 pb-16 min-h-screen">
        <TooltipProvider>{children}</TooltipProvider>
      </main>
      <GlobalFooter />
    </>
  );
}
