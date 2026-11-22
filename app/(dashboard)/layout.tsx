"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { LoadingScreen } from "@/components/loading-screen";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { isLoaded } = useAuth();
  // The entire `/dashboard/**` tree and the application + registration
  // flows render on a clean shell — no app sidebar, no application-step
  // nav. The dashboard pages have their own self-contained layout (header
  // + cards) and shouldn't inherit the application chrome. The root `/`
  // resolver renders the same clean shell but lives in its own `(root)`
  // group outside this layout (see the note in `app/(root)/page.tsx`).
  // Re-applications share the `/apply/year/:id` URL space with new applicants
  // (the `type` field on the progress row drives flow-specific behavior),
  // so there's no separate `/reapply` matcher here anymore.
  //
  // `/apply` itself (the "which school year?" chooser) is part of the
  // same flow: it sits between /welcome and /apply/year/X, both on the
  // clean shell. It used to render in the sidebar shell, so a new
  // parent saw the layout swap twice in a row — and that sidebar listed
  // steps for next year (with warning icons and a "Submit Application"
  // button) before they had picked a year.
  const isApplicationFlow =
    pathname.startsWith("/dashboard") ||
    pathname === "/apply" ||
    pathname === "/apply/" ||
    /^\/apply\/year\/\d+/.test(pathname) ||
    /^\/registration\/year\/\d+/.test(pathname);

  // Application-flow pages own their loading state with page-level
  // skeletons. Render them through immediately — gating here on Clerk
  // hydration would stack a layout "Loading..." on top of the page
  // skeleton on every sign-in.
  if (isApplicationFlow) {
    return <>{children}</>;
  }

  // Sidebar-shell routes still wait on Clerk so AppSidebar can read
  // user state safely.
  if (!isLoaded) {
    return (
      <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4">
        <LoadingScreen />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
