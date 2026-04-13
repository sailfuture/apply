"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Kanban,
  MessageSquare,
  FileText,
  ClipboardList,
  LogOut,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { YearSelector } from "@/components/admin/year-selector";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

const navItems = [
  { title: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { title: "Pipeline", href: "/admin/pipeline", icon: Kanban },
  { title: "Inquiries", href: "/admin/inquiries", icon: MessageSquare },
  { title: "Applications", href: "/admin/applications", icon: FileText },
  { title: "Registrations", href: "/admin/registrations", icon: ClipboardList },
];

export function AdminSidebar({
  admin,
  ...props
}: React.ComponentProps<typeof Sidebar> & { admin: AdminUser | null }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  function buildHref(base: string) {
    if (yearId) return `${base}?yearId=${yearId}`;
    return base;
  }

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href={buildHref("/admin")}>
                <div className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-full">
                  <Image
                    src="/logo.svg"
                    alt="SailFuture Academy"
                    width={32}
                    height={32}
                    className="size-8 object-cover"
                  />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Admin Portal</span>
                  <span className="truncate text-xs">SailFuture Academy</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="px-3 py-2">
          <YearSelector />
        </div>
      </SidebarHeader>

      <Separator />

      <SidebarContent>
        <SidebarMenu>
          {navItems.map((item) => {
            const isActive =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={isActive}>
                  <Link href={buildHref(item.href)}>
                    <item.icon className="size-4" />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <div className="flex items-center gap-3">
                <Avatar className="size-7">
                  <AvatarFallback className="text-xs">
                    {admin?.name
                      ?.split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase() ?? "A"}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium text-xs">
                    {admin?.name ?? "Admin"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {admin?.email ?? ""}
                  </span>
                </div>
                <Link href="/api/admin/logout" className="ml-auto">
                  <LogOut className="size-4 text-muted-foreground" />
                </Link>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
