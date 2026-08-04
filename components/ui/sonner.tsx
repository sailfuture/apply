"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/** Use bottom-LEFT on xl+ screens, top-center on smaller screens so toasts
 *  don't land on top of the fixed bottom nav.
 *
 *  Left, not right: every sheet in the admin app opens from the right edge
 *  (lead triage, family profile, activity, messages), so bottom-right toasts
 *  landed on top of the sheet's own composer and action buttons — exactly
 *  where you're looking when the toast fires. */
function useResponsivePosition(): ToasterProps["position"] {
  const [position, setPosition] = useState<ToasterProps["position"]>("top-center")
  useEffect(() => {
    if (typeof window === "undefined") return
    const mql = window.matchMedia("(min-width: 1280px)")
    const sync = () => setPosition(mql.matches ? "bottom-left" : "top-center")
    sync()
    mql.addEventListener("change", sync)
    return () => mql.removeEventListener("change", sync)
  }, [])
  return position
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const responsivePosition = useResponsivePosition()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position={props.position ?? responsivePosition}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
