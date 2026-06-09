"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { useTheme } from "@/contexts/ThemeContext"
import Link from "next/link"
import { Sun, Moon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

const routeNames: Record<string, string> = {
  dashboard: "Dashboard",
  bookings: "Bookings",
  analytics: "Analytics",
  creatives: "Creatives",
  "proof-of-play": "Proof of Play",
  screens: "Screens",
  "screen-owners": "Screen Owners",
  users: "Users",
  "screenox-sync": "ScreenOX Sync",
}

export function SiteHeader() {
  const pathname = usePathname()
  const { theme, toggleTheme } = useTheme()

  // Generate breadcrumbs from pathname
  const pathSegments = pathname?.split("/").filter(Boolean) || []
  const breadcrumbs = pathSegments.map((segment, index) => {
    const path = "/" + pathSegments.slice(0, index + 1).join("/")
    const name = routeNames[segment] || segment.charAt(0).toUpperCase() + segment.slice(1)
    return { name, path }
  })

  return (
    <header className="flex shrink-0 items-center gap-2 border-b py-4 transition-all duration-300" style={{ borderColor: 'var(--border-secondary)' }}>
      <div className="flex w-full items-center gap-2 px-4 lg:gap-3 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />

        {/* Dynamic Breadcrumbs */}
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbs.map((breadcrumb, index) => (
              <React.Fragment key={breadcrumb.path}>
                {index > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {index === breadcrumbs.length - 1 ? (
                    <BreadcrumbPage className="line-clamp-1">
                      {breadcrumb.name}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={breadcrumb.path}>{breadcrumb.name}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>

        {/* Theme Toggle */}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="size-8"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
          </Button>
        </div>
      </div>
    </header>
  )
}
