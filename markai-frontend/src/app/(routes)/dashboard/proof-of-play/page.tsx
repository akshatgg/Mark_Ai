"use client";
import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CalendarIcon,
  Loader2,
  Play,
  Monitor,
  FileText,
  TrendingUp,
  BarChart3,
  Calendar as CalendarClock,
  CheckCircle2,
  Film,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import toast from "react-hot-toast";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { getExportStatsCount, getDetailedStats, DetailedStatRecord } from "@/services/xiboService";
import { getAllScreens, getScreensByOwnerId, getScreensByIds, Screen } from "@/services/screenService";
import { getBookings } from "@/services/bookingService";

interface ProofOfPlayData {
  fromDt: string;
  toDt: string;
  totalRecords: number;
  uniqueDisplays: number;
  uniqueLayouts: number;
  totalDuration: number;
  totalPlays: number;
  avgDurationPerPlay?: number;
  displayBreakdown?: Array<{
    displayId: number;
    displayName: string;
    plays: number;
    duration: number;
  }>;
}

const ProofOfPlayPage = () => {
  const { fullUserData, user } = useAuth();
  const [screens, setScreens] = useState<Screen[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDisplayId, setSelectedDisplayId] = useState<string>("");
  const [layoutIdsInput, setLayoutIdsInput] = useState<string>("");
  const [fromDate, setFromDate] = useState<Date>();
  const [toDate, setToDate] = useState<Date>();
  const [fromTime, setFromTime] = useState<string>("00:00:00");
  const [toTime, setToTime] = useState<string>("23:59:59");
  const [isFetching, setIsFetching] = useState(false);
  const [proofOfPlayData, setProofOfPlayData] = useState<ProofOfPlayData | null>(null);
  const [allFetchedStats, setAllFetchedStats] = useState<DetailedStatRecord[]>([]); // All fetched records
  const [currentPage, setCurrentPage] = useState(1);
  const recordsPerPage = 15;
  const batchSize = 30; // Fetch 30 records at a time (2 pages worth)

  const isAdmin = fullUserData?.is_admin === true;
  const isScreenOwner = fullUserData?.is_screen_owner === true;
  const isAdvertiser = fullUserData?.is_advertiser === true || (!isAdmin && !isScreenOwner);

  // Compute current page's records from all fetched data
  const currentPageStats = React.useMemo(() => {
    const startIndex = (currentPage - 1) * recordsPerPage;
    const endIndex = startIndex + recordsPerPage;
    return allFetchedStats.slice(startIndex, endIndex);
  }, [allFetchedStats, currentPage, recordsPerPage]);

  // Fetch screens directly from database (much faster than fetching from Xibo)
  useEffect(() => {
    const fetchScreens = async () => {
      try {
        setLoading(true);

        if (isAdmin) {
          // Admin can see all screens - fetch only screens with Xibo IDs from database
          const screensResponse = await getAllScreens(200, 0, undefined, true);
          setScreens(screensResponse.screens || []);
        } else if (isScreenOwner && user?._id) {
          // Screen owner can only see their own screens
          const screensResponse = await getScreensByOwnerId(user._id, 200, 0);
          const screensWithXibo = screensResponse.screens?.filter(screen => screen.xibo_display_id) || [];
          setScreens(screensWithXibo);
        } else if (isAdvertiser && user?._id) {
          // Advertiser can see screens from bookings that have been approved/scheduled/live/completed
          // Fetch all advertiser's bookings (no status filter to get everything)
          const bookingsResponse = await getBookings(200, 0);

          console.log("Advertiser bookings:", bookingsResponse);

          const bookedScreenIds = new Set<string>();

          // Extract unique screen IDs from bookings that are approved or beyond
          // Valid statuses: "approved", "scheduled", "live", "completed", "owner_approved"
          const validStatuses = ["approved", "scheduled", "live", "completed", "owner_approved"];

          bookingsResponse.bookings?.forEach(booking => {
            // Only include bookings that have been approved by owner at minimum
            if (validStatuses.includes(booking.status) || booking.screen_owner_approval === "approved") {
              if (booking.screen_id) {
                bookedScreenIds.add(booking.screen_id);
              }
              // Also check multi-screen bookings
              if (booking.screen_slots) {
                booking.screen_slots.forEach(slot => {
                  if (slot.screen_id) {
                    bookedScreenIds.add(slot.screen_id);
                  }
                });
              }
            }
          });

          console.log("Booked screen IDs:", Array.from(bookedScreenIds));

          if (bookedScreenIds.size === 0) {
            console.log("No approved bookings found");
            setScreens([]);
          } else {
            // Fetch all screens in a single batch request (optimized)
            const fetchedScreens = await getScreensByIds(Array.from(bookedScreenIds));
            console.log("Fetched screens:", fetchedScreens);

            // Filter screens without Xibo IDs
            const bookedScreens = fetchedScreens.filter(screen => screen.xibo_display_id);

            console.log("Final booked screens with Xibo IDs:", bookedScreens);
            setScreens(bookedScreens);
          }
        }
      } catch (error) {
        console.error("Error fetching screens:", error);
        toast.error("Failed to fetch screens");
      } finally {
        setLoading(false);
      }
    };

    if (isAdmin || isScreenOwner || isAdvertiser) {
      fetchScreens();
    }
  }, [isAdmin, isScreenOwner, isAdvertiser, user?._id]);

  const fetchDetailedStatsPage = async (page: number) => {
    if (!fromDate || !toDate) return;

    try {
      setIsFetching(true);

      // Check if we already have enough data for this page
      const startIndex = (page - 1) * recordsPerPage;
      const endIndex = startIndex + recordsPerPage;
      const needMoreData = allFetchedStats.length < endIndex;

      if (needMoreData) {
        // Need to fetch more records
        // Format dates with custom times
        const fromDt = format(fromDate, "yyyy-MM-dd") + " " + fromTime;
        const toDt = format(toDate, "yyyy-MM-dd") + " " + toTime;

        const params: {
          fromDt: string;
          toDt: string;
          displayId?: number;
        } = {
          fromDt,
          toDt,
        };

        if (selectedDisplayId && selectedDisplayId !== "all") {
          params.displayId = parseInt(selectedDisplayId);
        }

        // Parse layout IDs from input (comma-separated)
        let layoutIds: number[] | undefined;
        if (layoutIdsInput.trim()) {
          layoutIds = layoutIdsInput
            .split(",")
            .map(id => parseInt(id.trim()))
            .filter(id => !isNaN(id) && id > 0);
        }

        // Fetch next batch starting from where we left off
        const detailedParams = {
          ...params,
          layoutIds: layoutIds && layoutIds.length > 0 ? layoutIds : undefined,
          start: allFetchedStats.length,
          length: batchSize
        };

        // Fetch detailed stats
        const detailedData = await getDetailedStats(detailedParams);

        // Append new records to existing ones
        const updatedStats = [...allFetchedStats, ...detailedData.stats];
        setAllFetchedStats(updatedStats);
      }

      // Update current page
      setCurrentPage(page);
    } catch (error) {
      console.error("Error fetching detailed stats:", error);
      toast.error("Failed to fetch detailed stats");
    } finally {
      setIsFetching(false);
    }
  };

  const handleFetchProofOfPlay = async () => {
    if (!fromDate || !toDate) {
      toast.error("Please select both start and end dates");
      return;
    }

    if (fromDate > toDate) {
      toast.error("Start date must be before end date");
      return;
    }

    // Warn user about large date ranges (more than 30 days)
    const daysDiff = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > 30) {
      toast("Large date range selected. This may take longer to load.", {
        icon: "⏱️",
        duration: 4000,
      });
    }

    try {
      setIsFetching(true);
      setProofOfPlayData(null);
      setAllFetchedStats([]);
      setCurrentPage(1);

      // Format dates with custom times
      const fromDt = format(fromDate, "yyyy-MM-dd") + " " + fromTime;
      const toDt = format(toDate, "yyyy-MM-dd") + " " + toTime;

      const params: {
        fromDt: string;
        toDt: string;
        displayId?: number;
      } = {
        fromDt,
        toDt,
      };

      if (selectedDisplayId && selectedDisplayId !== "all") {
        params.displayId = parseInt(selectedDisplayId);
      }

      // Parse layout IDs from input (comma-separated)
      let layoutIds: number[] | undefined;
      if (layoutIdsInput.trim()) {
        layoutIds = layoutIdsInput
          .split(",")
          .map(id => parseInt(id.trim()))
          .filter(id => !isNaN(id) && id > 0);
      }

      // Build detailed stats params - fetch initial batch (30 records)
      const detailedParams = {
        ...params,
        layoutIds: layoutIds && layoutIds.length > 0 ? layoutIds : undefined,
        start: 0,
        length: batchSize
      };

      // Fetch both summary and detailed stats
      const [summaryData, detailedData] = await Promise.all([
        getExportStatsCount(params),
        getDetailedStats(detailedParams)
      ]);

      // Calculate average duration per play
      if (summaryData.totalPlays && summaryData.totalDuration) {
        summaryData.avgDurationPerPlay = summaryData.totalDuration / summaryData.totalPlays;
      }

      setProofOfPlayData(summaryData as ProofOfPlayData);
      setAllFetchedStats(detailedData.stats); // Store initial batch

      const filterMessage = layoutIds && layoutIds.length > 0
        ? `Statistics loaded (filtered by ${layoutIds.length} layout(s))`
        : `Statistics loaded successfully`;
      toast.success(filterMessage);
    } catch (error) {
      console.error("Error fetching proof of play:", error);
      toast.error(error instanceof Error ? error.message : "Failed to fetch proof of play data");
    } finally {
      setIsFetching(false);
    }
  };

  if (!isAdmin && !isScreenOwner && !isAdvertiser) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-gray-400">You don't have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="px-4 sm:px-0">
        <h1 className="text-2xl font-bold mb-1.5 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Proof of Play</h1>
        <p className="text-xs sm:text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
          View playback statistics for {isAdmin ? "all screens" : isAdvertiser ? "your booked screens" : "your screens"} within a specific date range
        </p>
      </div>

      {/* Configuration Card */}
      <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
        <CardHeader className="p-4 pb-3 sm:p-5 sm:pb-3">
          <CardTitle className="flex items-center gap-2 text-base transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
            <Monitor className="w-4 h-4 text-purple-400" />
            Configure Report
          </CardTitle>
          <CardDescription className="mt-1 text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
            Select a screen and date range to view proof of play statistics
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3.5 p-4 sm:p-5">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full sm:w-32" />
            </div>
          ) : (
            <>
              {/* Screen Selector and Layout Filter */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Screen Selector */}
                <div className="space-y-1.5">
                  <Label htmlFor="display" className="text-xs font-medium transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                    Select Screen
                  </Label>
                  <Select
                    value={selectedDisplayId}
                    onValueChange={setSelectedDisplayId}
                  >
                    <SelectTrigger
                      id="display"
                      className="h-9 text-sm transition-colors duration-300 backdrop-blur-md bg-opacity-70"
                      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                    >
                      <SelectValue placeholder="Choose a screen..." />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px] shadow-xl backdrop-blur-md" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                      <SelectItem
                        value="all"
                        className="text-sm cursor-pointer transition-colors duration-300"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        <div className="flex flex-col py-0.5">
                          <span className="font-medium text-sm">
                            {isAdmin ? "All Screens" : isAdvertiser ? "All My Booked Screens" : "All My Screens"}
                          </span>
                          <span className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                            Combined statistics
                          </span>
                        </div>
                      </SelectItem>
                      {screens.length === 0 ? (
                        <SelectItem
                          value="none"
                          disabled
                          className="text-sm cursor-not-allowed transition-colors duration-300"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          <div className="flex flex-col py-0.5">
                            <span className="font-medium text-sm">No screens available</span>
                            <span className="text-xs transition-colors duration-300" style={{ color: 'var(--text-muted)' }}>
                              Sync with Xibo CMS first
                            </span>
                          </div>
                        </SelectItem>
                      ) : (
                        screens.map((screen) => (
                          <SelectItem
                            key={screen._id}
                            value={screen.xibo_display_id!.toString()}
                            className="text-sm cursor-pointer transition-colors duration-300 hover:bg-opacity-50"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            <div className="flex flex-col py-0.5">
                              <span className="font-medium text-sm">{screen.screen_name || screen.venue_name}</span>
                              <span className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                                ID: {screen.xibo_display_id}
                              </span>
                            </div>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {/* Layout Filter - Manual Input */}
                <div className="space-y-1.5">
                  <Label htmlFor="layout-ids" className="text-xs font-medium transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                    Filter by Layout IDs (Optional)
                  </Label>
                  <Input
                    id="layout-ids"
                    type="text"
                    placeholder="e.g., 821, 490, 1141"
                    value={layoutIdsInput}
                    onChange={(e) => setLayoutIdsInput(e.target.value)}
                    className="h-9 text-sm transition-colors duration-300 backdrop-blur-md bg-opacity-70"
                    style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>

              {/* Date and Time Range - Compact */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {/* From Date and Time */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                    Start Date & Time
                  </Label>
                  <div className="grid grid-cols-[1fr,auto] gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal h-9 text-sm transition-colors duration-300 hover:opacity-80 backdrop-blur-md bg-opacity-70",
                            !fromDate && "opacity-60"
                          )}
                          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                        >
                          <CalendarIcon className="mr-2 h-3.5 w-3.5 flex-shrink-0" />
                          <span className="truncate">{fromDate ? format(fromDate, "MMM dd, yyyy") : "Pick date"}</span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-auto p-0 shadow-xl backdrop-blur-md"
                        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}
                        align="start"
                      >
                        <Calendar
                          mode="single"
                          selected={fromDate}
                          onSelect={setFromDate}
                          className="rounded-md transition-colors duration-300 p-3"
                        />
                      </PopoverContent>
                    </Popover>
                    <Input
                      type="time"
                      value={fromTime}
                      onChange={(e) => setFromTime(e.target.value + ":00")}
                      step="60"
                      className="h-9 w-[110px] text-sm transition-colors duration-300 backdrop-blur-md bg-opacity-70"
                      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                    />
                  </div>
                </div>

                {/* To Date and Time */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                    End Date & Time
                  </Label>
                  <div className="grid grid-cols-[1fr,auto] gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal h-9 text-sm transition-colors duration-300 hover:opacity-80 backdrop-blur-md bg-opacity-70",
                            !toDate && "opacity-60"
                          )}
                          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                        >
                          <CalendarIcon className="mr-2 h-3.5 w-3.5 flex-shrink-0" />
                          <span className="truncate">{toDate ? format(toDate, "MMM dd, yyyy") : "Pick date"}</span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-auto p-0 shadow-xl backdrop-blur-md"
                        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}
                        align="start"
                      >
                        <Calendar
                          mode="single"
                          selected={toDate}
                          onSelect={setToDate}
                          className="rounded-md transition-colors duration-300 p-3"
                        />
                      </PopoverContent>
                    </Popover>
                    <Input
                      type="time"
                      value={toTime}
                      onChange={(e) => setToTime(e.target.value + ":00")}
                      step="60"
                      className="h-9 w-[110px] text-sm transition-colors duration-300 backdrop-blur-md bg-opacity-70"
                      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                    />
                  </div>
                </div>
              </div>

              {/* Fetch Button */}
              <Button
                onClick={handleFetchProofOfPlay}
                disabled={!fromDate || !toDate || isFetching}
                className="w-full h-9 text-sm bg-linear-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700 transition-colors duration-300"
              >
                {isFetching ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                    <span className="hidden sm:inline">Fetching Statistics...</span>
                    <span className="sm:hidden">Fetching...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 mr-2" />
                    Get Proof of Play
                  </>
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Detailed Stats Table */}
      {currentPageStats.length > 0 && (
        <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <CardHeader className="p-4 pb-3 sm:p-5 sm:pb-3">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <CardTitle className="flex flex-col sm:flex-row sm:items-center gap-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                  <div className="flex items-center gap-2">
                    <Film className="w-4 h-4 text-blue-400" />
                    <span className="text-base">Detailed Play Records</span>
                  </div>
                  {layoutIdsInput.trim() && (
                    <span className="text-xs font-normal px-2 py-0.5 rounded inline-block" style={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa' }}>
                      Layout filter active
                    </span>
                  )}
                </CardTitle>
                <CardDescription className="mt-1 text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                  Complete play-by-play breakdown
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 sm:p-5">
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <div className="inline-block min-w-full align-middle">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b transition-colors duration-300" style={{ borderColor: 'var(--border-primary)' }}>
                      <th className="text-left p-2 sm:p-3 whitespace-nowrap transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Type</th>
                      <th className="text-left p-2 sm:p-3 whitespace-nowrap transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Display</th>
                      <th className="text-left p-2 sm:p-3 whitespace-nowrap transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Layout</th>
                      <th className="text-left p-2 sm:p-3 whitespace-nowrap transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Media</th>
                      <th className="text-center p-2 sm:p-3 whitespace-nowrap transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Plays</th>
                      <th className="text-center p-2 sm:p-3 whitespace-nowrap transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Duration</th>
                      <th className="text-left p-2 sm:p-3 whitespace-nowrap transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Start Time</th>
                      <th className="text-left p-2 sm:p-3 whitespace-nowrap transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>End Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentPageStats.map((stat, index) => (
                      <tr
                        key={stat.id || index}
                        className="border-b transition-colors duration-300 hover:bg-opacity-50"
                        style={{ borderColor: 'var(--border-primary)', backgroundColor: index % 2 === 0 ? 'rgba(255, 255, 255, 0.02)' : 'transparent' }}
                      >
                        <td className="p-2 sm:p-3">
                          <span
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium whitespace-nowrap"
                            style={{
                              backgroundColor: stat.type === "layout" ? 'rgba(139, 92, 246, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                              color: stat.type === "layout" ? '#a78bfa' : '#60a5fa'
                            }}
                          >
                            {stat.type === "layout" ? <FileText className="w-3 h-3" /> : <Film className="w-3 h-3" />}
                            <span className="hidden sm:inline">{stat.type}</span>
                          </span>
                        </td>
                        <td className="p-2 sm:p-3 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                          <div className="flex flex-col min-w-[120px]">
                            <span className="font-medium truncate max-w-[150px]">{stat.display}</span>
                            <span className="text-xs transition-colors duration-300" style={{ color: 'var(--text-muted)' }}>ID: {stat.displayId}</span>
                          </div>
                        </td>
                        <td className="p-2 sm:p-3 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                          <div className="flex flex-col min-w-[120px]">
                            <span className="font-medium truncate max-w-[150px]">{stat.layout || "N/A"}</span>
                            {stat.layoutId > 0 && (
                              <span className="text-xs transition-colors duration-300" style={{ color: 'var(--text-muted)' }}>ID: {stat.layoutId}</span>
                            )}
                          </div>
                        </td>
                        <td className="p-2 sm:p-3 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                          {stat.media ? (
                            <div className="flex flex-col min-w-[120px]">
                              <span className="font-medium truncate max-w-[150px]">{stat.media}</span>
                              {stat.mediaId > 0 && (
                                <span className="text-xs transition-colors duration-300" style={{ color: 'var(--text-muted)' }}>ID: {stat.mediaId}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs transition-colors duration-300" style={{ color: 'var(--text-muted)' }}>-</span>
                          )}
                        </td>
                        <td className="p-2 sm:p-3 text-center">
                          <span className="inline-flex items-center justify-center px-2 py-1 rounded text-xs font-semibold whitespace-nowrap" style={{ backgroundColor: 'rgba(34, 197, 94, 0.2)', color: '#4ade80' }}>
                            {stat.numberPlays}
                          </span>
                        </td>
                        <td className="p-2 sm:p-3 text-center transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                          <span className="font-medium whitespace-nowrap">{stat.duration}s</span>
                        </td>
                        <td className="p-2 sm:p-3 text-xs transition-colors duration-300 whitespace-nowrap" style={{ color: 'var(--text-tertiary)' }}>
                          <span className="hidden lg:inline">{new Date(stat.start).toLocaleString()}</span>
                          <span className="lg:hidden">{new Date(stat.start).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        </td>
                        <td className="p-2 sm:p-3 text-xs transition-colors duration-300 whitespace-nowrap" style={{ color: 'var(--text-tertiary)' }}>
                          <span className="hidden lg:inline">{new Date(stat.end).toLocaleString()}</span>
                          <span className="lg:hidden">{new Date(stat.end).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination Controls - Simple Prev/Next */}
            {currentPageStats.length > 0 && (
              <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4 border-t pt-4 px-4 sm:px-0 transition-colors duration-300" style={{ borderColor: 'var(--border-primary)' }}>
                <div className="text-xs sm:text-sm transition-colors duration-300 text-center sm:text-left" style={{ color: 'var(--text-tertiary)' }}>
                  Page <span className="font-semibold">{currentPage}</span> - Showing <span className="font-semibold">{currentPageStats.length}</span> of <span className="font-semibold">{allFetchedStats.length}</span> fetched records
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchDetailedStatsPage(currentPage - 1)}
                    disabled={currentPage === 1 || isFetching}
                    className="transition-colors duration-300 h-8 px-3"
                    style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Previous
                  </Button>

                  <span className="text-sm px-3 py-1 rounded border transition-colors duration-300" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
                    {currentPage}
                  </span>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchDetailedStatsPage(currentPage + 1)}
                    disabled={currentPageStats.length < recordsPerPage || isFetching}
                    className="transition-colors duration-300 h-8 px-3"
                    style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                  >
                    Next
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!proofOfPlayData && !isFetching && (
        <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <CardContent className="py-8 sm:py-12 px-4">
            <div className="text-center">
              <Play className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 transition-colors duration-300" style={{ color: 'var(--text-muted)' }} />
              <h3 className="text-base sm:text-lg font-semibold mb-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>No Data Yet</h3>
              <p className="text-xs sm:text-sm mb-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                Select a screen and date range above to view proof of play statistics
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ProofOfPlayPage;
