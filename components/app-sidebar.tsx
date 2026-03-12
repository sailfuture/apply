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
  const [targetYearId, setTargetYearId] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  const [familyComplete, setFamilyComplete] = useState(false)
  const [studentsComplete, setStudentsComplete] = useState(false)
  const [scholarshipComplete, setScholarshipComplete] = useState(false)
  const [liabilityComplete, setLiabilityComplete] = useState(false)
  const [enrollmentComplete, setEnrollmentComplete] = useState(false)

  const fetchSidebarData = useCallback(async () => {
    try {
      const [yearsRes, familyRes, studentsRes, appsRes] = await Promise.all([
        fetch("/api/school-years"),
        fetch("/api/families"),
        fetch("/api/students"),
        fetch("/api/applications"),
      ])

      let yId: number | null = null
      if (yearsRes.ok) {
        const years: { id: number; isNextYear: boolean; isActive: boolean }[] =
          await yearsRes.json()
        const upcoming = years.find((y) => y.isNextYear)
        const active = years.find((y) => y.isActive)
        const target = upcoming ?? active
        if (target) {
          yId = target.id
          setTargetYearId(target.id)
        }
      }

      let fId: number | null = null
      if (familyRes.ok) {
        const fam = await familyRes.json()
        fId = fam?.id ?? null
        const parents = fam?.parents ?? []
        setFamilyComplete(
          parents.length > 0 &&
          parents.some((p: { phone: string; address_line_1: string; email: string }) =>
            p.phone && p.address_line_1 && p.email
          )
        )
      }

      if (studentsRes.ok && appsRes.ok && yId) {
        const allApps = await appsRes.json()
        const yearApps = allApps.filter(
          (a: { registration_school_years_id: number }) =>
            a.registration_school_years_id === yId
        )
        setStudentsComplete(yearApps.length > 0)

        if (yearApps.length > 0) {
          const app = yearApps[0] as {
            liability_waiver_status: string | null
            enrollment_agreement_status: string | null
          }
          setLiabilityComplete(app.liability_waiver_status === "completed")
          setEnrollmentComplete(app.enrollment_agreement_status === "completed")
        }
      }

      if (fId && yId) {
        try {
          const scholarshipRes = await fetch(`/api/scholarship?familyId=${fId}&yearId=${yId}`)
          if (scholarshipRes.ok) {
            const data = await scholarshipRes.json()
            setScholarshipComplete(!!(data && data.id))
          }
        } catch {
          // ignore
        }
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
