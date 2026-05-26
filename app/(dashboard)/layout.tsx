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
  // The entire `/dashboard/**` tree, the application + registration flows,
  // and the root home all render on a clean shell — no app sidebar, no
  // application-step nav. The dashboard pages have their own self-contained
  // layout (header + cards) and shouldn't inherit the application chrome.
  // Re-applications share the `/apply/year/:id` URL space with new applicants
  // (the `type` field on the progress row drives flow-specific behavior),
  // so there's no separate `/reapply` matcher here anymore.
  const isApplicationFlow =
    pathname === "/" ||
    pathname.startsWith("/dashboard") ||
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
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoadingScreen
          messages={[
            "Loading your dashboard...",
            "Getting things ready...",
            "Almost there...",
          ]}
        />
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
