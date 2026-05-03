"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

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
  const isApplicationFlow =
    pathname === "/" ||
    pathname.startsWith("/dashboard") ||
    /^\/apply\/year\/\d+/.test(pathname) ||
    /^\/registration\/year\/\d+/.test(pathname) ||
    /^\/reapply\/year\/\d+/.test(pathname);

  if (!isLoaded) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    );
  }

  if (isApplicationFlow) {
    return <>{children}</>;
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
