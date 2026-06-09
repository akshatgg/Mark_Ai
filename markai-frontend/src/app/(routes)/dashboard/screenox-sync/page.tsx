"use client";
import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarIcon, Download, Loader2, MonitorPlay, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { getDisplayGroups, XiboDisplayGroup } from "@/services/xiboService";
import { syncScreensFromScreenOX, SyncScreenOXResponse } from "@/services/screenService";

const ScreenOXSyncPage = () => {
  const { fullUserData } = useAuth();
  const [displayGroups, setDisplayGroups] = useState<XiboDisplayGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDisplayGroupId, setSelectedDisplayGroupId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncScreenOXResponse | null>(null);

  const isAdmin = fullUserData?.is_admin === true;

  // Fetch display groups on mount
  useEffect(() => {
    const fetchDisplayGroups = async () => {
      try {
        setLoading(true);
        const response = await getDisplayGroups();
        setDisplayGroups(response.displayGroups || []);
      } catch (error) {
        console.error("Error fetching display groups:", error);
        toast.error("Failed to fetch display groups");
      } finally {
        setLoading(false);
      }
    };

    if (isAdmin) {
      fetchDisplayGroups();
    }
  }, [isAdmin]);

  const handleSync = async () => {
    if (!selectedDisplayGroupId) {
      toast.error("Please select a display group");
      return;
    }

    try {
      setIsSyncing(true);
      setSyncResult(null);

      const displayGroupIds = [parseInt(selectedDisplayGroupId)];
      const result = await syncScreensFromScreenOX(displayGroupIds);

      setSyncResult(result);

      if (result.results.failed === 0) {
        toast.success(
          `Successfully synced ${result.results.created + result.results.updated} screens!`
        );
      } else {
        toast.error(
          `Sync completed with ${result.results.failed} failures. Check results below.`
        );
      }
    } catch (error) {
      console.error("Error syncing screens:", error);
      toast.error(error instanceof Error ? error.message : "Failed to sync screens");
    } finally {
      setIsSyncing(false);
    }
  };

  if (!isAdmin) {
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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">ScreenOX Sync</h1>
        <p className="text-gray-400">
          Sync screens from ScreenOX platform by selecting a display group
        </p>
      </div>

      {/* Sync Configuration Card */}
      <Card className="bg-[#0f0f0f] border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <MonitorPlay className="w-5 h-5 text-blue-400" />
            Sync Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-32" />
            </div>
          ) : (
            <>
              {/* Display Group Selector */}
              <div className="space-y-2">
                <Label htmlFor="display-group" className="text-white">
                  Select Display Group
                </Label>
                <Select
                  value={selectedDisplayGroupId}
                  onValueChange={setSelectedDisplayGroupId}
                >
                  <SelectTrigger
                    id="display-group"
                    className="bg-[#1a1a1a] border-white/10 text-white"
                  >
                    <SelectValue placeholder="Choose a display group..." />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a1a] border-white/10">
                    {displayGroups.map((group) => (
                      <SelectItem
                        key={group.displayGroupId}
                        value={group.displayGroupId.toString()}
                        className="text-white hover:bg-white/10"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{group.displayGroup}</span>
                          {group.description && (
                            <span className="text-xs text-gray-400">
                              {group.description}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400">
                  Display Group ID: {selectedDisplayGroupId || "Not selected"}
                </p>
              </div>

              {/* Date Selector */}
              <div className="space-y-2">
                <Label htmlFor="sync-date" className="text-white">
                  Reference Date (Optional)
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="sync-date"
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal bg-[#1a1a1a] border-white/10 text-white hover:bg-white/10",
                        !selectedDate && "text-gray-400"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {selectedDate ? (
                        format(selectedDate, "PPP")
                      ) : (
                        <span>Pick a date</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 bg-[#1a1a1a] border-white/10">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      initialFocus
                      className="text-white"
                    />
                  </PopoverContent>
                </Popover>
                <p className="text-xs text-gray-400">
                  Select a reference date for sync tracking (not used by API)
                </p>
              </div>

              {/* Sync Button */}
              <Button
                onClick={handleSync}
                disabled={!selectedDisplayGroupId || isSyncing}
                className="w-full bg-white text-black hover:bg-white/90"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Syncing from ScreenOX...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Sync Screens from ScreenOX
                  </>
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Sync Results Card */}
      {syncResult && (
        <Card className="bg-[#0f0f0f] border-white/10">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-400" />
              Sync Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <p className="text-sm text-gray-400 mb-1">Total Processed</p>
                <p className="text-2xl font-bold text-blue-400">
                  {syncResult.results.total}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                <p className="text-sm text-gray-400 mb-1">Created</p>
                <p className="text-2xl font-bold text-green-400">
                  {syncResult.results.created}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <p className="text-sm text-gray-400 mb-1">Updated</p>
                <p className="text-2xl font-bold text-yellow-400">
                  {syncResult.results.updated}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-sm text-gray-400 mb-1">Failed</p>
                <p className="text-2xl font-bold text-red-400">
                  {syncResult.results.failed}
                </p>
              </div>
            </div>

            {/* Success Message */}
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-400 mt-0.5" />
                <div>
                  <p className="text-white font-medium">{syncResult.message}</p>
                  <p className="text-sm text-gray-400 mt-1">
                    Successfully processed {syncResult.results.total} screens from ScreenOX
                  </p>
                </div>
              </div>
            </div>

            {/* Error Messages */}
            {syncResult.results.errors && syncResult.results.errors.length > 0 && (
              <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-white font-medium mb-2">Errors Encountered</p>
                    <ul className="space-y-1">
                      {syncResult.results.errors.map((error, index) => (
                        <li key={index} className="text-sm text-red-300">
                          • {error}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Display Group IDs */}
            {syncResult.results.display_group_ids && (
              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                <p className="text-sm text-gray-400 mb-2">Synced Display Group IDs:</p>
                <div className="flex flex-wrap gap-2">
                  {syncResult.results.display_group_ids.map((id) => (
                    <Badge
                      key={id}
                      className="bg-blue-500/20 text-blue-400 border-blue-500/30"
                    >
                      {id}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ScreenOXSyncPage;
