"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"

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
  Calendar03Icon,
} from "@hugeicons/core-free-icons"
import Image from "next/image"

const staticNavSecondary = [
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
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [isAccepted, setIsAccepted] = useState(false)
  const [targetYearId, setTargetYearId] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  const fetchSidebarData = useCallback(async () => {
    try {
      const [familyRes, yearsRes] = await Promise.all([
        fetch("/api/families"),
        fetch("/api/school-years"),
      ])

      if (familyRes.ok) {
        const fam = await familyRes.json()
        if (fam?.id) setIsAccepted(fam.isAccepted ?? false)
      }

      if (yearsRes.ok) {
        const years: { id: number; isNextYear: boolean; isActive: boolean }[] =
          await yearsRes.json()
        const upcoming = years.find((y) => y.isNextYear)
        const active = years.find((y) => y.isActive)
        const target = upcoming ?? active
        if (target) setTargetYearId(target.id)
      }
    } catch {
      // graceful fallback
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    fetchSidebarData()
  }, [fetchSidebarData])

  const applicationItems = React.useMemo(() => {
    if (!targetYearId) return []

    const base = `/apply/year/${targetYearId}`
    return [
      { title: "Family", url: `${base}/family` },
      { title: "Students", url: `${base}/students` },
      { title: "Scholarships", url: `${base}/scholarship` },
    ]
  }, [targetYearId])

  const registrationItems = React.useMemo(() => {
    if (!targetYearId) return []

    const base = `/apply/year/${targetYearId}`
    return [
      { title: "Overview", url: base },
      { title: "Family", url: `${base}/family` },
      { title: "Students", url: `${base}/students` },
      { title: "Scholarships", url: `${base}/scholarship` },
    ]
  }, [targetYearId])

  const navMain = React.useMemo(() => {
    const items = [
      {
        title: "Dashboard",
        url: "/",
        icon: <HugeiconsIcon icon={Home01Icon} strokeWidth={2} />,
        isActive: true,
      },
    ]

    if (loaded) {
      if (!isAccepted) {
        items.push({
          title: "Application",
          url: targetYearId ? `/apply/year/${targetYearId}` : "/apply",
          icon: <HugeiconsIcon icon={File01Icon} strokeWidth={2} />,
          isActive: true,
          items: applicationItems,
        })
      }

      if (isAccepted) {
        items.push({
          title: "Family",
          url: "/family",
          icon: <HugeiconsIcon icon={UserMultipleIcon} strokeWidth={2} />,
          items: [{ title: "Members & Students", url: "/family" }],
        })
        items.push({
          title: "Registration",
          url: targetYearId ? `/apply/year/${targetYearId}` : "/apply",
          icon: <HugeiconsIcon icon={File01Icon} strokeWidth={2} />,
          items: registrationItems,
        })
        items.push({
          title: "School Years",
          url: "/apply",
          icon: <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2} />,
          items: [{ title: "All Years", url: "/apply" }],
        })
        items.push({
          title: "Settings",
          url: "/account",
          icon: <HugeiconsIcon icon={Settings05Icon} strokeWidth={2} />,
          items: [
            { title: "Account", url: "/account" },
            { title: "Notifications", url: "#" },
          ],
        })
      }
    }

    return items
  }, [loaded, isAccepted, targetYearId, applicationItems, registrationItems])

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
        <NavMain items={navMain} />
        <NavSecondary items={staticNavSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
