"use client"

import * as React from "react"
import { useAuth } from "@/contexts/AuthContext"
import Image from "next/image"
import Link from "next/link"
import {
  LayoutDashboard,
  Calendar,
  Monitor,
  Users,
  Building2,
  FileText,
  Play,
} from "lucide-react"

import { NavMain } from "@/components/sidebar/nav-main"
import { NavSecondary } from "@/components/sidebar/nav-secondary"
import { NavUser } from "@/components/sidebar/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { user, fullUserData } = useAuth()

  // Check user type from boolean flags
  const isAdmin = fullUserData?.is_admin === true
  const isScreenOwner = fullUserData?.is_screen_owner === true
  const isAdvertiser = fullUserData?.is_advertiser === true || (!isAdmin && !isScreenOwner)

  // Define menu items based on user type
  const getNavMainItems = () => {
    const baseItems = [
      {
        title: "Home",
        url: "/dashboard",
        icon: LayoutDashboard,
      },
    ]

    if (isAdmin) {
      return [
        ...baseItems,
        {
          title: "View All Bookings",
          icon: Calendar,
          url: "/dashboard/bookings",
        },
        {
          title: "View All Screen Owners",
          icon: Building2,
          url: "/dashboard/screen-owners",
        },
        {
          title: "Manage Screens",
          icon: Monitor,
          url: "/dashboard/screens",
        },
        {
          title: "View All Users",
          icon: Users,
          url: "/dashboard/users",
        },
        {
          title: "Proof of Play",
          icon: Play,
          url: "/dashboard/proof-of-play",
        },
      ]
    } else if (isScreenOwner) {
      return [
        ...baseItems,
        {
          title: "View Bookings",
          icon: Calendar,
          url: "/dashboard/bookings",
        },
        {
          title: "Screen Management",
          icon: Monitor,
          url: "/dashboard/screens",
        },
        {
          title: "Review Creatives",
          icon: FileText,
          url: "/dashboard/creatives",
        },
      ]
    } else {
      // Advertiser
      return [
        ...baseItems,
        {
          title: "My Bookings",
          icon: Calendar,
          url: "/dashboard/bookings",
        },
        {
          title: "Proof of Play",
          icon: Play,
          url: "/dashboard/proof-of-play",
        },
      ]
    }
  }

  const navMainItems = user ? getNavMainItems() : []

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="lg"
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <Link href="/" className="flex items-center gap-2">
                <Image
                  src="/mark_ai_logo2-removebg-preview.png"
                  alt="Mark AI Logo"
                  width={32}
                  height={32}
                  className="size-8 object-contain"
                />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="text-base font-semibold truncate">Mark AI</span>
                  <span className="text-muted-foreground truncate text-xs">Dashboard</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMainItems} />
        <NavSecondary className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        {user && <NavUser />}
      </SidebarFooter>
    </Sidebar>
  )
}
