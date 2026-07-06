"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Monitor, Users, TrendingUp, FileText, CheckCircle, XCircle, RefreshCw, Loader2, Play } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { getDashboardStats, getBookingsByStatus } from "@/services/statsService";
import { syncScreensFromScreenOX } from "@/services/screenService";
import toast from "react-hot-toast";

const DashboardHome = () => {
  const { user, fullUserData } = useAuth();

  // Check user type from boolean flags in fullUserData
  const isAdmin = fullUserData?.is_admin === true;
  const isScreenOwner = fullUserData?.is_screen_owner === true;
  const isAdvertiser = fullUserData?.is_advertiser === true || (!isAdmin && !isScreenOwner);

  // NEW: State for real-time stats
  const [statsData, setStatsData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [campaignStats, setCampaignStats] = useState<any>(null);
  const [campaignStatsLoading, setCampaignStatsLoading] = useState(true);

  // Handle ScreenOX sync
  const handleSyncScreenOX = async () => {
    try {
      setIsSyncing(true);
      // Sync screens from displayGroupId 28 (CCD Bangalore screens)
      const response = await syncScreensFromScreenOX([28]);
      toast.success(
        `Sync completed! Created: ${response.results.created}, Updated: ${response.results.updated}, Total: ${response.results.total}`
      );
    } catch (error) {
      console.error("Sync failed:", error);
      toast.error(error instanceof Error ? error.message : "Failed to sync screens from ScreenOX");
    } finally {
      setIsSyncing(false);
    }
  };

  // NEW: Fetch stats and campaign status on mount
  useEffect(() => {
    // Only fetch data if user is authenticated
    if (!user) {
      setLoading(false);
      setCampaignStatsLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);
        setCampaignStatsLoading(true);

        // Fetch stats and campaign status in parallel
        const [statsResponse, campaignStatusResponse] = await Promise.all([
          getDashboardStats(),
          getBookingsByStatus()
        ]);

        console.log("📊 Stats Response:", statsResponse);
        console.log("📈 Campaign Status Response:", campaignStatusResponse);

        setStatsData(statsResponse.stats);
        setCampaignStats(campaignStatusResponse.status_counts);
      } catch (error) {
        console.error("❌ Error fetching dashboard data:", error);
        toast.error("Failed to load dashboard data. Showing fallback values.");
      } finally {
        setLoading(false);
        setCampaignStatsLoading(false);
      }
    };

    fetchData();
  }, [user]);

  const getStats = () => {
    // Use statsData if available, otherwise fallback to hardcoded values
    if (isAdmin) {
      return [
        {
          title: "Total Bookings",
          value: statsData?.total_bookings?.toString() || "1,234",
          change: statsData?.total_bookings_change || "+12.5%",
          icon: Calendar,
          description: "All time bookings",
        },
        {
          title: "Active Screens",
          value: statsData?.active_screens?.toString() || "456",
          change: statsData?.active_screens_change || "+8.2%",
          icon: Monitor,
          description: "Currently active",
        },
        {
          title: "Screen Owners",
          value: statsData?.screen_owners?.toString() || "89",
          change: statsData?.screen_owners_change || "+5.1%",
          icon: Users,
          description: "Registered owners",
        },
        {
          title: "Total Users",
          value: statsData?.total_users?.toString() || "2,345",
          change: statsData?.total_users_change || "+15.3%",
          icon: Users,
          description: "All users",
        },
      ];
    } else if (isScreenOwner) {
      return [
        {
          title: "My Bookings",
          value: statsData?.my_bookings?.toString() || "45",
          change: statsData?.my_bookings_change || "+8.2%",
          icon: Calendar,
          description: "Total bookings",
        },
        {
          title: "Active Screens",
          value: statsData?.active_screens?.toString() || "12",
          change: statsData?.active_screens_change || "+2",
          icon: Monitor,
          description: "Your screens",
        },
        {
          title: "Revenue",
          value: statsData?.revenue || "₹1,23,456",
          change: statsData?.revenue_change || "+18.5%",
          icon: TrendingUp,
          description: "This month",
        },
        {
          title: "Pending Creatives",
          value: statsData?.pending_creatives?.toString() || "7",
          change: statsData?.pending_creatives_change || "-3",
          icon: FileText,
          description: "Awaiting review",
        },
      ];
    } else {
      // Advertiser
      return [
        {
          title: "My Bookings",
          value: statsData?.my_bookings?.toString() || "23",
          change: statsData?.my_bookings_change || "+5",
          icon: Calendar,
          description: "Active campaigns",
        },
        {
          title: "Total Spent",
          value: statsData?.total_spent || "₹45,678",
          change: statsData?.total_spent_change || "+12.3%",
          icon: TrendingUp,
          description: "This month",
        },
        {
          title: "Active Screens",
          value: statsData?.active_screens?.toString() || "156",
          change: statsData?.active_screens_change || "+23",
          icon: Monitor,
          description: "Currently showing",
        },
      ];
    }
  };

  const stats = getStats();

  // Helper function to get status badge info
  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; color: string; icon: any }> = {
      'paid': { label: 'Pending Approval', color: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400', icon: FileText },
      'owner_approved': { label: 'Owner Approved', color: 'bg-blue-500/10 border-blue-500/20 text-blue-400', icon: CheckCircle },
      'approved': { label: 'Approved', color: 'bg-green-500/10 border-green-500/20 text-green-400', icon: CheckCircle },
      'scheduled': { label: 'Scheduled', color: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400', icon: Calendar },
      'live': { label: 'Live', color: 'bg-purple-500/10 border-purple-500/20 text-purple-400', icon: TrendingUp },
      'completed': { label: 'Completed', color: 'bg-gray-500/10 border-gray-500/20 text-gray-400', icon: CheckCircle },
      'rejected': { label: 'Rejected', color: 'bg-red-500/10 border-red-500/20 text-red-400', icon: XCircle },
      'cancelled': { label: 'Cancelled', color: 'bg-gray-500/10 border-gray-500/20 text-gray-400', icon: XCircle },
    };
    return statusMap[status] || { label: status, color: 'bg-gray-500/10 border-gray-500/20 text-gray-400', icon: FileText };
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)', transition: 'color 0.3s ease' }}>
          Welcome back, {user?.name.split(" ")[0]}!
        </h1>
        <p style={{ color: 'var(--text-tertiary)', transition: 'color 0.3s ease' }}>
          Here's an overview of your {isAdmin ? "platform" : isScreenOwner ? "business" : "campaigns"}
        </p>
      </div>

      {/* Show loading skeletons while fetching */}
      {loading ? (
        <div className={`grid gap-4 md:grid-cols-2 ${isAdvertiser ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
          {[...Array(isAdvertiser ? 3 : 4)].map((_, i) => (
            <Card key={i} style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', transition: 'all 0.3s ease' }}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4 rounded" />
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
        <div className={`grid gap-4 md:grid-cols-2 ${isAdvertiser ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.title} style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', transition: 'all 0.3s ease' }}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>
                    {stat.title}
                  </CardTitle>
                  <Icon className="h-4 w-4" style={{ color: 'var(--text-tertiary)' }} />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{stat.value}</div>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{stat.description}</p>
                  <div className="flex items-center gap-1 mt-2">
                    <span className={`text-xs ${stat.change.startsWith('+') ? 'text-green-400' : 'text-red-400'}`}>
                      {stat.change}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>from last month</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', transition: 'all 0.3s ease' }}>
          <CardHeader>
            <CardTitle style={{ color: 'var(--text-primary)' }}>Campaign Status Overview</CardTitle>
            <CardDescription style={{ color: 'var(--text-tertiary)' }}>
              Breakdown of your campaigns by status
            </CardDescription>
          </CardHeader>
          <CardContent>
            {campaignStatsLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }}>
                    <div className="flex items-center gap-3">
                      <Skeleton className="w-5 h-5 rounded" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                    <Skeleton className="h-6 w-8" />
                  </div>
                ))}
              </div>
            ) : campaignStats && Object.keys(campaignStats).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(campaignStats).map(([status, count]) => {
                  const badge = getStatusBadge(status);
                  const StatusIcon = badge.icon;
                  const numCount = typeof count === 'number' ? count : 0;
                  return (
                    <div key={status} className={`flex items-center justify-between p-3 rounded-lg border ${badge.color}`} style={{ transition: 'all 0.3s ease' }}>
                      <div className="flex items-center gap-3">
                        <StatusIcon className="w-5 h-5" />
                        <span className="text-sm font-medium">{badge.label}</span>
                      </div>
                      <span className="text-xl font-bold">{numCount}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No campaigns yet</p>
                <Link href="/browse-screens">
                  <Button className="mt-4 bg-purple-600 hover:bg-purple-700" style={{ transition: 'background-color 0.3s ease' }}>
                    Create Your First Campaign
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        <Card style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', transition: 'all 0.3s ease' }}>
          <CardHeader>
            <CardTitle style={{ color: 'var(--text-primary)' }}>Quick Actions</CardTitle>
            <CardDescription style={{ color: 'var(--text-tertiary)' }}>
              Common tasks and shortcuts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {isAdvertiser && (
                <a
                  href="/browse-screens"
                  className="block p-3 rounded-lg hover:bg-white/10"
                  style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-primary)', transition: 'all 0.3s ease' }}
                >
                  Browse Available Screens
                </a>
              )}
              {isScreenOwner && (
                <>
                  <a
                    href="/dashboard/screens"
                    className="block p-3 rounded-lg hover:bg-white/10"
                    style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-primary)', transition: 'all 0.3s ease' }}
                  >
                    Add New Screen
                  </a>
                  <a
                    href="/dashboard/creatives"
                    className="block p-3 rounded-lg hover:bg-white/10"
                    style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-primary)', transition: 'all 0.3s ease' }}
                  >
                    Review Creatives
                  </a>
                </>
              )}
              <a
                href="/dashboard/bookings"
                className="block p-3 rounded-lg hover:bg-white/10"
                style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-primary)', transition: 'all 0.3s ease' }}
              >
                View All Bookings
              </a>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Admin Tools Block */}
      {isAdmin && (
        <>
          <Card style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', transition: 'all 0.3s ease' }}>
            <CardHeader>
              <CardTitle style={{ color: 'var(--text-primary)' }}>Admin Tools</CardTitle>
              <CardDescription style={{ color: 'var(--text-tertiary)' }}>
                System management and synchronization
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Sync ScreenOX Button */}
                <div className="p-4 rounded-lg bg-purple-500/10 border border-purple-500/20" style={{ transition: 'all 0.3s ease' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <RefreshCw className="w-5 h-5 text-purple-400" />
                    <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>ScreenOX Sync</span>
                  </div>
                  <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                    Fetch and sync screens from ScreenOX CMS (Display Group 28 - CCD Bangalore)
                  </p>
                  <Button
                    onClick={handleSyncScreenOX}
                    disabled={isSyncing}
                    className="w-full bg-purple-600 hover:bg-purple-700"
                    style={{ color: 'var(--text-primary)', transition: 'all 0.3s ease' }}
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
                </div>

                {/* Manage Users Link */}
                <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20" style={{ transition: 'all 0.3s ease' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-5 h-5 text-blue-400" />
                    <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>User Management</span>
                  </div>
                  <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                    Manage users, screen owners, and permissions
                  </p>
                  <Link href="/dashboard/users">
                    <Button className="w-full bg-blue-600 hover:bg-blue-700" style={{ color: 'var(--text-primary)', transition: 'all 0.3s ease' }}>
                      <Users className="w-4 h-4 mr-2" />
                      Manage Users
                    </Button>
                  </Link>
                </div>

                {/* View All Screens Link */}
                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20" style={{ transition: 'all 0.3s ease' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Monitor className="w-5 h-5 text-green-400" />
                    <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Screen Management</span>
                  </div>
                  <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                    View and manage all screens in the platform
                  </p>
                  <Link href="/dashboard/screens">
                    <Button className="w-full bg-green-600 hover:bg-green-700" style={{ color: 'var(--text-primary)', transition: 'all 0.3s ease' }}>
                      <Monitor className="w-4 h-4 mr-2" />
                      Manage Screens
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Creatives Review Block for Screen Owners */}
      {isScreenOwner && (
        <Card style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', transition: 'all 0.3s ease' }}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle style={{ color: 'var(--text-primary)' }}>Creative Reviews</CardTitle>
                <CardDescription style={{ color: 'var(--text-tertiary)' }}>
                  Manage creative submissions from advertisers
                </CardDescription>
              </div>
              <Link
                href="/dashboard/creatives"
                className="text-sm text-purple-400 hover:text-purple-300"
                style={{ transition: 'color 0.3s ease' }}
              >
                View All →
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="grid grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="p-4 rounded-lg border" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', borderColor: 'var(--border-primary)' }}>
                    <Skeleton className="h-4 w-16 mb-2" />
                    <Skeleton className="h-8 w-12 mb-1" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20" style={{ transition: 'all 0.3s ease' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="w-5 h-5 text-yellow-400" />
                    <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Pending</span>
                  </div>
                  <div className="text-2xl font-bold text-yellow-400">
                    {statsData?.pending_creatives || 0}
                  </div>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Awaiting review</p>
                </div>
                <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20" style={{ transition: 'all 0.3s ease' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="w-5 h-5 text-green-400" />
                    <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Approved</span>
                  </div>
                  <div className="text-2xl font-bold text-green-400">
                    {statsData?.approved_creatives || 0}
                  </div>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Total approved</p>
                </div>
                <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20" style={{ transition: 'all 0.3s ease' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle className="w-5 h-5 text-red-400" />
                    <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Declined</span>
                  </div>
                  <div className="text-2xl font-bold text-red-400">
                    {statsData?.rejected_creatives || 0}
                  </div>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Total declined</p>
                </div>
              </div>
            )}
            <Link
              href="/dashboard/creatives"
              className="mt-4 block w-full text-center py-3 rounded-lg border hover:bg-white/10"
              style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-primary)', borderColor: 'var(--border-primary)', transition: 'all 0.3s ease' }}
            >
              Review Creatives
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default DashboardHome;
