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
  ChartRingIcon,
  SentIcon,
  UserIcon,
  ShieldIcon,
  Agreement02Icon,
} from "@hugeicons/core-free-icons"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { useFamily, useSchoolYears, useApplications, useScholarship } from "@/hooks/use-api"

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
  const router = useRouter()

  const { data: familyData } = useFamily()
  const { data: yearsData } = useSchoolYears()
  const { data: appsData } = useApplications()

  const targetYear = React.useMemo(() => {
    if (!yearsData) return null
    const years = yearsData as { id: number; isNextYear: boolean; isActive: boolean }[]
    return years.find((y) => y.isNextYear) ?? years.find((y) => y.isActive) ?? null
  }, [yearsData])

  const targetYearId = targetYear?.id ?? null
  const familyId = familyData?.id ?? null

  const { data: scholarshipData } = useScholarship(familyId, targetYearId)

  const loaded = !!(yearsData && familyData)

  const familyComplete = React.useMemo(() => {
    const parents = familyData?.parents ?? []
    return parents.length > 0 && parents.some((p: { phone: string; address_line_1: string; email: string }) =>
      p.phone && p.address_line_1 && p.email
    )
  }, [familyData])

  const yearApps = React.useMemo(() => {
    if (!appsData || !targetYearId) return []
    return (appsData as { registration_school_years_id: number }[]).filter(
      (a) => a.registration_school_years_id === targetYearId
    )
  }, [appsData, targetYearId])

  const studentsComplete = yearApps.length > 0
  const scholarshipComplete = !!(scholarshipData && scholarshipData.id)

  const firstApp = yearApps[0] as {
    liability_waiver_status?: string | null
    enrollment_agreement_status?: string | null
  } | undefined

  const liabilityComplete = firstApp?.liability_waiver_status === "completed"
  const enrollmentComplete = firstApp?.enrollment_agreement_status === "completed"

  const navMain = React.useMemo(() => {
    if (!loaded || !targetYearId) return []

    const base = `/apply/year/${targetYearId}`
    return [
      {
        title: "Overview",
        url: base,
        icon: <HugeiconsIcon icon={Home01Icon} strokeWidth={2} />,
      },
      {
        title: "Family",
        url: `${base}/family`,
        icon: <HugeiconsIcon icon={UserMultipleIcon} strokeWidth={2} />,
        status: familyComplete ? ("complete" as const) : ("incomplete" as const),
      },
      {
        title: "Students",
        url: `${base}/students`,
        icon: <HugeiconsIcon icon={UserIcon} strokeWidth={2} />,
        status: studentsComplete ? ("complete" as const) : ("incomplete" as const),
      },
      {
        title: "Financial Aid",
        url: `${base}/scholarship`,
        icon: <HugeiconsIcon icon={File01Icon} strokeWidth={2} />,
        status: scholarshipComplete ? ("complete" as const) : ("incomplete" as const),
      },
      {
        title: "Liability Waiver",
        url: base,
        icon: <HugeiconsIcon icon={ShieldIcon} strokeWidth={2} />,
        status: liabilityComplete ? ("complete" as const) : ("incomplete" as const),
        action: "liability_waiver" as const,
      },
      {
        title: "Enrollment Agreement",
        url: base,
        icon: <HugeiconsIcon icon={Agreement02Icon} strokeWidth={2} />,
        status: enrollmentComplete ? ("complete" as const) : ("incomplete" as const),
        action: "enrollment_agreement" as const,
      },
    ]
  }, [loaded, targetYearId, familyComplete, studentsComplete, scholarshipComplete, liabilityComplete, enrollmentComplete])

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href={targetYearId ? `/apply/year/${targetYearId}` : "/"}>
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
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        {loaded && targetYearId && (
          <div className="px-3 mt-2">
            <Button
              className="w-full"
              onClick={() => router.push(`/apply/year/${targetYearId}/submit`)}
            >
              Submit Application
            </Button>
          </div>
        )}
        <NavSecondary items={staticNavSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
