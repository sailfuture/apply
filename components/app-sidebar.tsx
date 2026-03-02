"use client"

import * as React from "react"

import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Home01Icon,
  UserMultipleIcon,
  StudentIcon,
  File01Icon,
  Settings05Icon,
  ChartRingIcon,
  SentIcon,
  AnchorIcon,
} from "@hugeicons/core-free-icons"

const data = {
  navMain: [
    {
      title: "Dashboard",
      url: "/",
      icon: <HugeiconsIcon icon={Home01Icon} strokeWidth={2} />,
      isActive: true,
    },
    {
      title: "Family",
      url: "/family",
      icon: <HugeiconsIcon icon={UserMultipleIcon} strokeWidth={2} />,
      items: [
        {
          title: "Family Profile",
          url: "/family",
        },
        {
          title: "Parents & Guardians",
          url: "/family",
        },
      ],
    },
    {
      title: "Students",
      url: "/students",
      icon: <HugeiconsIcon icon={StudentIcon} strokeWidth={2} />,
      items: [
        {
          title: "Student Profiles",
          url: "/students",
        },
      ],
    },
    {
      title: "Application",
      url: "#",
      icon: <HugeiconsIcon icon={File01Icon} strokeWidth={2} />,
      items: [
        {
          title: "Status",
          url: "#",
        },
        {
          title: "Documents",
          url: "#",
        },
      ],
    },
    {
      title: "Settings",
      url: "/account",
      icon: <HugeiconsIcon icon={Settings05Icon} strokeWidth={2} />,
      items: [
        {
          title: "Account",
          url: "/account",
        },
        {
          title: "Notifications",
          url: "#",
        },
      ],
    },
  ],
  navSecondary: [
    {
      title: "Support",
      url: "#",
      icon: <HugeiconsIcon icon={ChartRingIcon} strokeWidth={2} />,
    },
    {
      title: "Feedback",
      url: "#",
      icon: <HugeiconsIcon icon={SentIcon} strokeWidth={2} />,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="/">
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <HugeiconsIcon
                    icon={AnchorIcon}
                    strokeWidth={2}
                    className="size-4"
                  />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">SFA Registration</span>
                  <span className="truncate text-xs">SailFuture Academy</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
