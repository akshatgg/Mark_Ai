"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Calendar,
  Monitor,
  Users,
  TrendingUp,
  FileText,
  CheckCircle,
  XCircle,
  RefreshCw,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { getDashboardStats, getBookingsByStatus } from "@/services/statsService";
import { syncScreensFromScreenOX } from "@/services/screenService";
import toast from "react-hot-toast";

const DashboardHome = () => {
  const { user, fullUserData } = useAuth();

  const isAdmin = fullUserData?.is_admin === true;
  const isScreenOwner = fullUserData?.is_screen_owner === true;
  const isAdvertiser =
    fullUserData?.is_advertiser === true || (!isAdmin && !isScreenOwner);

  const [statsData, setStatsData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [campaignStats, setCampaignStats] = useState<any>(null);
  const [campaignStatsLoading, setCampaignStatsLoading] = useState(true);

  const handleSyncScreenOX = async () => {
    try {
      setIsSyncing(true);
      const response = await syncScreensFromScreenOX([28]);
      toast.success(
        `Sync completed! Created: ${response.results.created}, Updated: ${response.results.updated}, Total: ${response.results.total}`
      );
    } catch (error) {
      console.error("Sync failed:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to sync screens from ScreenOX"
      );
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (!user) {
      setLoading(false);
      setCampaignStatsLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);
        setCampaignStatsLoading(true);

        const [statsResponse, campaignStatusResponse] = await Promise.all([
          getDashboardStats(),
          getBookingsByStatus(),
        ]);

        setStatsData(statsResponse.stats);
        setCampaignStats(campaignStatusResponse.status_counts);
      } catch (error) {
        console.error("Error fetching dashboard data:", error);
        toast.error("Failed to load dashboard data. Showing fallback values.");
      } finally {
        setLoading(false);
        setCampaignStatsLoading(false);
      }
    };

    fetchData();
  }, [user]);

  const getStats = () => {
    if (isAdmin) {
      return [
        { title: "Total Bookings", value: statsData?.total_bookings?.toString() || "1,234", change: statsData?.total_bookings_change || "+12.5%", icon: Calendar, description: "All time bookings", accent: "blue" },
        { title: "Active Screens", value: statsData?.active_screens?.toString() || "456", change: statsData?.active_screens_change || "+8.2%", icon: Monitor, description: "Currently active", accent: "cyan" },
        { title: "Screen Owners", value: statsData?.screen_owners?.toString() || "89", change: statsData?.screen_owners_change || "+5.1%", icon: Users, description: "Registered owners", accent: "green" },
        { title: "Total Users", value: statsData?.total_users?.toString() || "2,345", change: statsData?.total_users_change || "+15.3%", icon: Users, description: "All users", accent: "lime" },
      ];
    } else if (isScreenOwner) {
      return [
        { title: "My Bookings", value: statsData?.my_bookings?.toString() || "45", change: statsData?.my_bookings_change || "+8.2%", icon: Calendar, description: "Total bookings", accent: "blue" },
        { title: "Active Screens", value: statsData?.active_screens?.toString() || "12", change: statsData?.active_screens_change || "+2", icon: Monitor, description: "Your screens", accent: "cyan" },
        { title: "Revenue", value: statsData?.revenue || "₹1,23,456", change: statsData?.revenue_change || "+18.5%", icon: TrendingUp, description: "This month", accent: "green" },
        { title: "Pending Creatives", value: statsData?.pending_creatives?.toString() || "7", change: statsData?.pending_creatives_change || "-3", icon: FileText, description: "Awaiting review", accent: "lime" },
      ];
    } else {
      return [
        { title: "My Bookings", value: statsData?.my_bookings?.toString() || "23", change: statsData?.my_bookings_change || "+5", icon: Calendar, description: "Active campaigns", accent: "blue" },
        { title: "Total Spent", value: statsData?.total_spent || "₹45,678", change: statsData?.total_spent_change || "+12.3%", icon: TrendingUp, description: "This month", accent: "green" },
        { title: "Active Screens", value: statsData?.active_screens?.toString() || "156", change: statsData?.active_screens_change || "+23", icon: Monitor, description: "Currently showing", accent: "cyan" },
      ];
    }
  };

  const stats = getStats();

  const accentToBg: Record<string, string> = {
    blue: "var(--brand-blue)",
    cyan: "var(--brand-cyan)",
    green: "var(--brand-green)",
    lime: "var(--brand-lime)",
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; icon: any; tone: string }> = {
      paid: { label: "Pending Approval", icon: FileText, tone: "pending" },
      owner_approved: { label: "Owner Approved", icon: CheckCircle, tone: "scheduled" },
      approved: { label: "Approved", icon: CheckCircle, tone: "approved" },
      scheduled: { label: "Scheduled", icon: Calendar, tone: "scheduled" },
      live: { label: "Live", icon: TrendingUp, tone: "live" },
      completed: { label: "Completed", icon: CheckCircle, tone: "completed" },
      rejected: { label: "Rejected", icon: XCircle, tone: "rejected" },
      cancelled: { label: "Cancelled", icon: XCircle, tone: "completed" },
    };
    return (
      statusMap[status] || { label: status, icon: FileText, tone: "completed" }
    );
  };

  return (
    <div className="relative space-y-8">
      {/* Decorative gradient blobs to match landing-page theme */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -left-24 h-[320px] w-[320px] rounded-full blur-3xl opacity-[0.18] brand-blob-blue"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/3 -right-24 h-[360px] w-[360px] rounded-full blur-3xl opacity-[0.14] brand-blob-cyan"
      />

      {/* Stat cards */}
      {loading ? (
        <div
          className={`relative z-10 grid gap-4 md:grid-cols-2 ${
            isAdvertiser ? "lg:grid-cols-3" : "lg:grid-cols-4"
          }`}
        >
          {[...Array(isAdvertiser ? 3 : 4)].map((_, i) => (
            <Card key={i} className="card-surface">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-9 rounded-xl" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-20 mb-2" />
                <Skeleton className="h-3 w-32 mb-2" />
                <Skeleton className="h-3 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div
          className={`relative z-10 grid gap-4 md:grid-cols-2 ${
            isAdvertiser ? "lg:grid-cols-3" : "lg:grid-cols-4"
          }`}
        >
          {stats.map((stat) => {
            const Icon = stat.icon;
            const isUp = stat.change.startsWith("+");
            return (
              <Card
                key={stat.title}
                className="card-surface group relative overflow-hidden transition-all duration-300 hover:-translate-y-0.5 hover:shadow-brand-soft"
              >
                {/* gradient strip accent */}
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-[3px]"
                  style={{
                    background: accentToBg[stat.accent] || "var(--brand-blue)",
                  }}
                />
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider text-subtle">
                      {stat.title}
                    </CardTitle>
                  </div>
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-xl shadow-brand-soft"
                    style={{
                      background: accentToBg[stat.accent] || "var(--brand-blue)",
                    }}
                  >
                    <Icon className="h-5 w-5 text-white" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-base">{stat.value}</div>
                  <p className="text-xs mt-1 text-faint">{stat.description}</p>
                  <div className="flex items-center gap-1 mt-3">
                    <span
                      className="text-xs font-semibold inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                      style={{
                        color: isUp ? "var(--color-success)" : "var(--color-danger)",
                        backgroundColor: isUp
                          ? "var(--color-success-soft)"
                          : "var(--color-danger-soft)",
                      }}
                    >
                      {stat.change}
                    </span>
                    <span className="text-xs text-faint">vs last month</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="relative z-10 grid gap-4 md:grid-cols-2">
        <Card className="card-surface">
          <CardHeader>
            <CardTitle className="text-base">Campaign Status</CardTitle>
            <CardDescription className="text-subtle">
              Breakdown of your campaigns by status
            </CardDescription>
          </CardHeader>
          <CardContent>
            {campaignStatsLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 rounded-xl border border-base"
                  >
                    <div className="flex items-center gap-3">
                      <Skeleton className="w-5 h-5 rounded" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                    <Skeleton className="h-6 w-8" />
                  </div>
                ))}
              </div>
            ) : campaignStats && Object.keys(campaignStats).length > 0 ? (
              <div className="space-y-2.5">
                {Object.entries(campaignStats).map(([status, count]) => {
                  const badge = getStatusBadge(status);
                  const StatusIcon = badge.icon;
                  const numCount = typeof count === "number" ? count : 0;
                  return (
                    <div
                      key={status}
                      className="flex items-center justify-between p-3 rounded-xl border"
                      style={{
                        backgroundColor: `var(--status-${badge.tone}-bg)`,
                        borderColor: `var(--status-${badge.tone}-border)`,
                        color: `var(--status-${badge.tone}-text)`,
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <StatusIcon className="w-5 h-5" />
                        <span className="text-sm font-semibold">{badge.label}</span>
                      </div>
                      <span className="text-xl font-bold">{numCount}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-10">
                <p className="text-sm text-subtle mb-4">No campaigns yet</p>
                <Link href="/browse-screens">
                  <Button className="bg-brand-gradient text-white rounded-full px-5 py-2.5 shadow-brand transition-all duration-300 hover:-translate-y-0.5">
                    Create Your First Campaign
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="card-surface">
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
            <CardDescription className="text-subtle">
              Common tasks and shortcuts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5">
              {isAdvertiser && (
                <QuickActionLink href="/browse-screens" label="Browse Available Screens" />
              )}
              {isScreenOwner && (
                <>
                  <QuickActionLink href="/dashboard/screens" label="Add New Screen" />
                  <QuickActionLink href="/dashboard/creatives" label="Review Creatives" />
                </>
              )}
              <QuickActionLink href="/dashboard/bookings" label="View All Bookings" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Admin Tools */}
      {isAdmin && (
        <Card className="relative z-10 card-surface">
          <CardHeader>
            <CardTitle className="text-base">Admin Tools</CardTitle>
            <CardDescription className="text-subtle">
              System management and synchronization
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <AdminTile
                icon={RefreshCw}
                label="ScreenOX Sync"
                description="Fetch and sync screens from ScreenOX CMS (Display Group 28 — CCD Bangalore)"
                accent="blue"
              >
                <Button
                  onClick={handleSyncScreenOX}
                  disabled={isSyncing}
                  className="w-full bg-brand-gradient text-white rounded-full shadow-brand transition-all duration-300 hover:-translate-y-0.5 disabled:opacity-60"
                >
                  {isSyncing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Sync Screens
                    </>
                  )}
                </Button>
              </AdminTile>

              <AdminTile
                icon={Users}
                label="User Management"
                description="Manage users, screen owners, and permissions"
                accent="cyan"
              >
                <Link href="/dashboard/users" className="block">
                  <Button className="w-full bg-brand-gradient text-white rounded-full shadow-brand transition-all duration-300 hover:-translate-y-0.5">
                    <Users className="w-4 h-4 mr-2" />
                    Manage Users
                  </Button>
                </Link>
              </AdminTile>

              <AdminTile
                icon={Monitor}
                label="Screen Management"
                description="View and manage all screens in the platform"
                accent="green"
              >
                <Link href="/dashboard/screens" className="block">
                  <Button className="w-full bg-brand-gradient text-white rounded-full shadow-brand transition-all duration-300 hover:-translate-y-0.5">
                    <Monitor className="w-4 h-4 mr-2" />
                    Manage Screens
                  </Button>
                </Link>
              </AdminTile>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Creative Reviews — Screen Owners */}
      {isScreenOwner && (
        <Card className="relative z-10 card-surface">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Creative Reviews</CardTitle>
                <CardDescription className="text-subtle">
                  Manage creative submissions from advertisers
                </CardDescription>
              </div>
              <Link
                href="/dashboard/creatives"
                className="text-sm font-semibold text-brand-blue transition hover:opacity-80"
              >
                View All →
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="grid grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="p-4 rounded-xl border border-base bg-elev"
                  >
                    <Skeleton className="h-4 w-16 mb-2" />
                    <Skeleton className="h-8 w-12 mb-1" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                <CreativeTile
                  tone="pending"
                  icon={FileText}
                  label="Pending"
                  value={statsData?.pending_creatives || 0}
                  description="Awaiting review"
                />
                <CreativeTile
                  tone="approved"
                  icon={CheckCircle}
                  label="Approved"
                  value={statsData?.approved_creatives || 0}
                  description="Total approved"
                />
                <CreativeTile
                  tone="rejected"
                  icon={XCircle}
                  label="Declined"
                  value={statsData?.rejected_creatives || 0}
                  description="Total declined"
                />
              </div>
            )}
            <Link
              href="/dashboard/creatives"
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-base bg-elev py-3 text-sm font-semibold text-base transition hover:bg-surface"
            >
              Review Creatives
              <ArrowRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

const QuickActionLink = ({ href, label }: { href: string; label: string }) => (
  <Link
    href={href}
    className="group flex items-center justify-between rounded-xl border border-base bg-elev p-3 text-sm font-medium text-base transition-all duration-300 hover:-translate-y-0.5 hover:border-strong"
  >
    <span>{label}</span>
    <ArrowRight className="h-4 w-4 text-subtle transition-transform group-hover:translate-x-0.5" />
  </Link>
);

const AdminTile = ({
  icon: Icon,
  label,
  description,
  accent,
  children,
}: {
  icon: any;
  label: string;
  description: string;
  accent: "blue" | "cyan" | "green";
  children: React.ReactNode;
}) => {
  const colorVar =
    accent === "cyan"
      ? "var(--brand-cyan)"
      : accent === "green"
      ? "var(--brand-green)"
      : "var(--brand-blue)";
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-base p-4 transition-all duration-300 hover:-translate-y-0.5"
      style={{ backgroundColor: "var(--color-surface-elev)" }}
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{ background: colorVar }}
      />
      <div className="flex items-center gap-2 mb-2">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
          style={{ background: colorVar }}
        >
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-sm font-semibold text-base">{label}</span>
      </div>
      <p className="text-xs mb-4 text-subtle">{description}</p>
      {children}
    </div>
  );
};

const CreativeTile = ({
  tone,
  icon: Icon,
  label,
  value,
  description,
}: {
  tone: "pending" | "approved" | "rejected";
  icon: any;
  label: string;
  value: number;
  description: string;
}) => (
  <div
    className="p-4 rounded-xl border"
    style={{
      backgroundColor: `var(--status-${tone}-bg)`,
      borderColor: `var(--status-${tone}-border)`,
    }}
  >
    <div
      className="flex items-center gap-2 mb-2"
      style={{ color: `var(--status-${tone}-text)` }}
    >
      <Icon className="w-5 h-5" />
      <span className="text-sm font-semibold">{label}</span>
    </div>
    <div
      className="text-2xl font-bold"
      style={{ color: `var(--status-${tone}-text)` }}
    >
      {value}
    </div>
    <p className="text-xs mt-1 text-subtle">{description}</p>
  </div>
);

export default DashboardHome;
