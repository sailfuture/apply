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
  File01Icon,
  Settings05Icon,
  ChartRingIcon,
  SentIcon,
} from "@hugeicons/core-free-icons"
import Image from "next/image"

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
          title: "Members & Students",
          url: "/family",
        },
      ],
    },
    {
      title: "Application",
      url: "/apply",
      icon: <HugeiconsIcon icon={File01Icon} strokeWidth={2} />,
      items: [
        {
          title: "School Years",
          url: "/apply",
        },
        {
          title: "Status",
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
