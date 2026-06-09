"use client";
import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Calendar,
  Clock,
  MapPin,
  CheckCircle,
  XCircle,
  Loader2,
  Monitor,
  IndianRupee,
  Image as ImageIcon,
  ExternalLink,
  AlertCircle,
  User,
  Shield,
  Edit3,
  Trash2,
  Play,
  ChevronDown,
  ChevronUp,
  Download,
  Upload,
} from "lucide-react";
import toast from "react-hot-toast";
import { generateInvoice } from "@/utils/invoiceGenerator";
import {
  getBookings,
  getPendingOwnerApproval,
  ownerApproveBooking,
  ownerRejectBooking,
  adminApproveBooking,
  adminRejectBooking,
  cancelSchedule,
  editSchedule,
  getScheduleStatus,
  getBookingStatusInfo,
  groupBookingsByGroupId,
  updateCreative,
  canEditCreative,
  type Booking,
  type GroupedBooking,
  type ScheduleStatus,
  type UpdateCreativeRequest,
} from "@/services/bookingService";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const BookingsPage = () => {
  const { user, fullUserData } = useAuth();

  // User role checks
  const isAdmin = fullUserData?.is_admin === true;
  const isScreenOwner = fullUserData?.is_screen_owner === true;

  // State
  const [bookings, setBookings] = useState<GroupedBooking[]>([]);
  const [pendingOwnerBookings, setPendingOwnerBookings] = useState<GroupedBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPending, setLoadingPending] = useState(false);
  const [activeTab, setActiveTab] = useState("all");

  // Pagination state
  const [currentPage, setCurrentPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const ITEMS_PER_PAGE = 25;

  // Approval dialog state
  const [approvalDialog, setApprovalDialog] = useState<{
    open: boolean;
    booking: Booking | null;
    action: "owner-approve" | "owner-reject" | "admin-approve" | "admin-reject" | null;
  }>({
    open: false,
    booking: null,
    action: null,
  });
  const [rejectionReason, setRejectionReason] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Edit schedule dialog state
  const [editDialog, setEditDialog] = useState<{
    open: boolean;
    booking: Booking | null;
  }>({
    open: false,
    booking: null,
  });
  const [editDates, setEditDates] = useState({ start: "", end: "" });

  // Cancel confirmation dialog
  const [cancelDialog, setCancelDialog] = useState<{
    open: boolean;
    booking: Booking | null;
  }>({
    open: false,
    booking: null,
  });

  // GST details dialog
  const [gstDialog, setGstDialog] = useState<{
    open: boolean;
    booking: Booking | null;
  }>({
    open: false,
    booking: null,
  });

  // Edit creative dialog state
  const [editCreativeDialog, setEditCreativeDialog] = useState<{
    open: boolean;
    booking: Booking | null;
  }>({
    open: false,
    booking: null,
  });
  const [newMediaUrl, setNewMediaUrl] = useState("");
  const [newMediaType, setNewMediaType] = useState<string>("image");
  const [newMediaPublicId, setNewMediaPublicId] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Expanded bookings for time slots
  const [expandedBookings, setExpandedBookings] = useState<Set<string>>(new Set());

  // Toggle expanded state for a booking
  const toggleExpanded = (bookingId: string) => {
    setExpandedBookings((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(bookingId)) {
        newSet.delete(bookingId);
      } else {
        newSet.add(bookingId);
      }
      return newSet;
    });
  };

  // Interface for time slot display
  interface TimeSlotDisplay {
    date: string;
    dayName: string;
    start: string;
    end: string;
  }

  // Interface for grouped time slot display
  interface GroupedTimeSlot {
    timeRange: string; // e.g., "08:00 - 09:00"
    dateRanges: {
      startDay: string; // e.g., "MON 26 Jan"
      endDay: string; // e.g., "FRI 30 Jan"
      isSingleDay: boolean;
    }[];
  }

  // Group time slots by time range and consecutive dates
  const groupTimeSlotsByRange = (timeSlots: TimeSlotDisplay[]): GroupedTimeSlot[] => {
    if (timeSlots.length === 0) return [];

    // Sort slots by time first, then by date
    const sorted = [...timeSlots].sort((a, b) => {
      const timeCompare = a.start.localeCompare(b.start);
      if (timeCompare !== 0) return timeCompare;
      return a.date.localeCompare(b.date);
    });

    // Group by time range
    const timeGroups = new Map<string, TimeSlotDisplay[]>();
    sorted.forEach(slot => {
      const timeKey = `${slot.start} - ${slot.end}`;
      if (!timeGroups.has(timeKey)) {
        timeGroups.set(timeKey, []);
      }
      timeGroups.get(timeKey)!.push(slot);
    });

    // For each time group, find consecutive date ranges
    const result: GroupedTimeSlot[] = [];
    timeGroups.forEach((slots, timeRange) => {
      const dateRanges: GroupedTimeSlot['dateRanges'] = [];

      // Parse dates and sort
      const slotsWithDates = slots.map(slot => ({
        ...slot,
        fullDate: new Date(slot.date + ' ' + new Date().getFullYear()),
        displayDate: `${slot.dayName} ${slot.date}`
      })).sort((a, b) => {
        // Parse day number for comparison
        const aDay = parseInt(a.date.split(' ')[0]);
        const bDay = parseInt(b.date.split(' ')[0]);
        return aDay - bDay;
      });

      let currentRange: { start: number; end: number } | null = null;

      slotsWithDates.forEach((slot, index) => {
        const currentDay = parseInt(slot.date.split(' ')[0]);

        if (currentRange === null) {
          currentRange = { start: index, end: index };
        } else {
          const prevDay = parseInt(slotsWithDates[currentRange.end].date.split(' ')[0]);

          // Check if consecutive (allowing for month wrapping)
          if (currentDay === prevDay + 1 || (prevDay > 25 && currentDay === 1)) {
            currentRange.end = index;
          } else {
            // Save current range and start new one
            dateRanges.push({
              startDay: slotsWithDates[currentRange.start].displayDate,
              endDay: slotsWithDates[currentRange.end].displayDate,
              isSingleDay: currentRange.start === currentRange.end
            });
            currentRange = { start: index, end: index };
          }
        }

        // If last slot, save the range
        if (index === slotsWithDates.length - 1 && currentRange !== null) {
          dateRanges.push({
            startDay: slotsWithDates[currentRange.start].displayDate,
            endDay: slotsWithDates[currentRange.end].displayDate,
            isSingleDay: currentRange.start === currentRange.end
          });
        }
      });

      result.push({ timeRange, dateRanges });
    });

    return result;
  };

  // Parse time slots from booking
  const parseTimeSlots = (booking: Booking): TimeSlotDisplay[] => {
    if (!booking.time_slots || booking.time_slots.length === 0) {
      // Fallback: create single slot from start/end date
      if (booking.start_date && booking.end_date) {
        const startDate = new Date(booking.start_date);
        const endDate = new Date(booking.end_date);
        const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
        return [{
          date: startDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
          dayName: dayNames[startDate.getDay()],
          start: startDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
          end: endDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
        }];
      }
      return [];
    }

    return booking.time_slots.map((slot) => {
      const startDate = new Date(slot.start);
      const endDate = new Date(slot.end);
      const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

      return {
        date: startDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
        dayName: dayNames[startDate.getDay()],
        start: startDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
        end: endDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
      };
    });
  };

  // Interface for screen with its time slots (parsed from screens array)
  interface ScreenWithSlots {
    screenId: string;
    screenName: string;
    xiboDisplayId?: number;
    xiboDisplayGroupId?: number;
    timeSlots: TimeSlotDisplay[];
  }

  // Parse screens with their individual time slots from a booking
  const parseScreensWithSlots = (booking: Booking): ScreenWithSlots[] => {
    const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

    // Helper to convert time_slots array to TimeSlotDisplay format
    const convertToDisplaySlots = (slots: { start: string; end: string }[]): TimeSlotDisplay[] => {
      return slots.map((slot) => {
        const startDate = new Date(slot.start);
        const endDate = new Date(slot.end);
        return {
          date: startDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
          dayName: dayNames[startDate.getDay()],
          start: startDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
          end: endDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
        };
      });
    };

    // PRIORITY 1: Use screen_slots if available (NEW field - clearest mapping)
    if (booking.screen_slots && booking.screen_slots.length > 0) {
      return booking.screen_slots.map((screenSlot) => ({
        screenId: screenSlot.screen_id || booking.screen_id || "",
        screenName: screenSlot.screen_name || booking.screen_name || "Screen",
        xiboDisplayId: screenSlot.xibo_display_id || booking.xibo_display_id,
        xiboDisplayGroupId: screenSlot.xibo_display_group_id || booking.xibo_display_group_id,
        timeSlots: convertToDisplaySlots(screenSlot.time_slots || []),
      }));
    }

    // PRIORITY 2: Use time_slots from booking (already parsed by backend)
    const preParseTimeSlots = parseTimeSlots(booking);

    // PRIORITY 3: Use booking's screen_name and screen_id with parsed time_slots
    if (preParseTimeSlots.length > 0) {
      return [{
        screenId: booking.screen_id || "",
        screenName: booking.screen_name || "Screen",
        xiboDisplayId: booking.xibo_display_id,
        xiboDisplayGroupId: booking.xibo_display_group_id,
        timeSlots: preParseTimeSlots,
      }];
    }

    // PRIORITY 4: Try to parse from screens array (legacy)
    if (booking.screens && booking.screens.length > 0) {
      const screen = booking.screens[0];
      const selectedSlots = screen.selectedSlots || [];
      const timeSlots: TimeSlotDisplay[] = [];

      // Parse each slot ID: format is "2026-01-14T00:00:00.000Z-10" (date-hour)
      selectedSlots.forEach((slotId: string) => {
        try {
          const lastHyphenIndex = slotId.lastIndexOf('-');
          if (lastHyphenIndex === -1) return;

          const dateIsoPart = slotId.slice(0, lastHyphenIndex);
          const hourPart = parseInt(slotId.slice(lastHyphenIndex + 1), 10);

          const baseDate = new Date(dateIsoPart);
          const slotStart = new Date(baseDate);
          slotStart.setHours(hourPart, 0, 0, 0);

          const slotEnd = new Date(slotStart);
          if (hourPart === 23) {
            slotEnd.setHours(23, 59, 0, 0);
          } else {
            slotEnd.setHours(hourPart + 1, 0, 0, 0);
          }

          timeSlots.push({
            date: slotStart.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
            dayName: dayNames[slotStart.getDay()],
            start: slotStart.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
            end: slotEnd.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
          });
        } catch (e) {
          console.error("Error parsing slot:", slotId, e);
        }
      });

      return [{
        screenId: screen.screenId || screen._id || booking.screen_id || "",
        screenName: screen.screenName || screen.name || booking.screen_name || `Screen ${(screen.screenId || "").slice(-8)}`,
        xiboDisplayId: screen.xiboDisplayId || booking.xibo_display_id,
        xiboDisplayGroupId: screen.xiboDisplayGroupId || booking.xibo_display_group_id,
        timeSlots: timeSlots,
      }];
    }

    // FALLBACK: Empty screen with booking's basic info
    return [{
      screenId: booking.screen_id || "",
      screenName: booking.screen_name || "Screen",
      xiboDisplayId: booking.xibo_display_id,
      xiboDisplayGroupId: booking.xibo_display_group_id,
      timeSlots: [],
    }];
  };

  // Fetch all bookings with pagination
  const fetchBookings = async (page: number = 0) => {
    try {
      setLoading(true);

      const skip = page * ITEMS_PER_PAGE;
      // Fetch one extra item to check if there's a next page
      const response = await getBookings(ITEMS_PER_PAGE + 1, skip);

      // Check if there are more items
      const hasMore = response.bookings.length > ITEMS_PER_PAGE;

      // Only take the items we need (ITEMS_PER_PAGE)
      const bookingsToShow = response.bookings.slice(0, ITEMS_PER_PAGE);
      const groupedBookings = groupBookingsByGroupId(bookingsToShow);

      setBookings(groupedBookings);
      setHasNextPage(hasMore);
      setCurrentPage(page);
    } catch (error) {
      console.error("Error fetching bookings:", error);
      toast.error(error instanceof Error ? error.message : "Failed to fetch bookings");
    } finally {
      setLoading(false);
    }
  };

  // Fetch pending owner approvals
  const fetchPendingOwnerApprovals = async () => {
    if (!isScreenOwner && !isAdmin) return;

    try {
      setLoadingPending(true);
      const response = await getPendingOwnerApproval();
      const groupedPendingBookings = groupBookingsByGroupId(response.bookings || []);
      setPendingOwnerBookings(groupedPendingBookings);
    } catch (error) {
      console.error("Error fetching pending bookings:", error);
    } finally {
      setLoadingPending(false);
    }
  };

  // Pagination handlers
  const handleNextPage = () => {
    if (hasNextPage && !loading) {
      fetchBookings(currentPage + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 0 && !loading) {
      fetchBookings(currentPage - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    fetchBookings();
    if (isScreenOwner || isAdmin) {
      fetchPendingOwnerApprovals();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, isScreenOwner]);

  // Handle approval action
  const handleApprovalAction = async () => {
    if (!approvalDialog.booking || !approvalDialog.action) return;

    try {
      setIsProcessing(true);
      const bookingId = approvalDialog.booking._id;

      switch (approvalDialog.action) {
        case "owner-approve":
          await ownerApproveBooking(bookingId);
          toast.success("Booking approved! Ready for final approval & scheduling.");
          break;
        case "owner-reject":
          await ownerRejectBooking(bookingId, rejectionReason);
          toast.success("Booking rejected");
          break;
        case "admin-approve":
          const result = await adminApproveBooking(bookingId);
          if (result.schedule_created) {
            toast.success("Booking approved and scheduled in Screenox!");
          } else {
            toast.success("Booking approved!");
          }
          break;
        case "admin-reject":
          await adminRejectBooking(bookingId, rejectionReason);
          toast.success("Booking rejected");
          break;
      }

      // Reset and refresh
      setApprovalDialog({ open: false, booking: null, action: null });
      setRejectionReason("");
      fetchBookings();
      if (isScreenOwner || isAdmin) {
        fetchPendingOwnerApprovals();
      }
    } catch (error) {
      console.error("Error processing approval:", error);
      toast.error(error instanceof Error ? error.message : "Failed to process action");
    } finally {
      setIsProcessing(false);
    }
  };

  // Open approval dialog
  const openApprovalDialog = (
    booking: Booking,
    action: "owner-approve" | "owner-reject" | "admin-approve" | "admin-reject"
  ) => {
    setApprovalDialog({ open: true, booking, action });
    setRejectionReason("");
  };

  // Check if screen owner can approve this booking
  const canOwnerApprove = (booking: Booking): boolean => {
    if (!isScreenOwner && !isAdmin) return false;
    if (booking.payment_status !== "paid") return false;
    if (booking.screen_owner_approval !== "pending") return false;
    return true;
  };

  // Check if user can do final approval (admin or screen owner for their screens)
  const canAdminApprove = (booking: Booking): boolean => {
    // Both admin and screen owner can do final approval
    // (Backend will verify screen ownership for screen owners)
    if (!isAdmin && !isScreenOwner) return false;
    if (booking.payment_status !== "paid") return false;
    // Can only approve AFTER owner has approved
    if (booking.screen_owner_approval !== "approved") return false;
    // Can't approve if already approved/scheduled/rejected
    if (booking.status === "approved" || booking.status === "scheduled" || booking.status === "rejected") return false;
    return true;
  };

  // Check if schedule can be managed (cancelled/edited)
  const canManageSchedule = (booking: Booking): boolean => {
    if (!isAdmin && !isScreenOwner) return false;
    // Can only manage scheduled bookings that have xibo schedule
    if (booking.status !== "scheduled" && booking.status !== "approved") return false;
    if (!booking.xibo_schedule_id) return false;
    return true;
  };

  // Handle cancel schedule
  const handleCancelSchedule = async () => {
    if (!cancelDialog.booking) return;

    try {
      setIsProcessing(true);
      await cancelSchedule(cancelDialog.booking._id);
      toast.success("Schedule cancelled successfully!");
      setCancelDialog({ open: false, booking: null });
      fetchBookings();
    } catch (error) {
      console.error("Error cancelling schedule:", error);
      toast.error(error instanceof Error ? error.message : "Failed to cancel schedule");
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle edit schedule
  const handleEditSchedule = async () => {
    if (!editDialog.booking) return;

    if (!editDates.start || !editDates.end) {
      toast.error("Please select both start and end dates");
      return;
    }

    const startDate = new Date(editDates.start);
    const endDate = new Date(editDates.end);

    if (startDate >= endDate) {
      toast.error("End date must be after start date");
      return;
    }

    try {
      setIsProcessing(true);
      await editSchedule(
        editDialog.booking._id,
        startDate.toISOString(),
        endDate.toISOString()
      );
      toast.success("Schedule updated successfully!");
      setEditDialog({ open: false, booking: null });
      setEditDates({ start: "", end: "" });
      fetchBookings();
    } catch (error) {
      console.error("Error updating schedule:", error);
      toast.error(error instanceof Error ? error.message : "Failed to update schedule");
    } finally {
      setIsProcessing(false);
    }
  };

  // Open edit dialog with pre-filled dates
  const openEditDialog = (booking: Booking) => {
    // Format dates for input type="datetime-local"
    const formatForInput = (dateStr: string) => {
      try {
        const date = new Date(dateStr);
        return date.toISOString().slice(0, 16); // Format: YYYY-MM-DDTHH:mm
      } catch {
        return "";
      }
    };

    setEditDates({
      start: formatForInput(booking.start_date),
      end: formatForInput(booking.end_date),
    });
    setEditDialog({ open: true, booking });
  };

  // Open edit creative dialog
  const openEditCreativeDialog = (booking: Booking) => {
    setNewMediaUrl(booking.media_url || "");
    // Infer media type from URL
    const url = (booking.media_url || "").toLowerCase();
    if (url.includes(".mp4") || url.includes(".mov") || url.includes(".webm") || url.includes(".avi")) {
      setNewMediaType("video");
    } else {
      setNewMediaType("image");
    }
    setNewMediaPublicId(null);
    setUploadedFile(null);
    setUploadError(null);
    setEditCreativeDialog({ open: true, booking });
  };

  // Upload media file to backend
  const uploadMediaFile = async (file: File): Promise<{ url: string; publicId: string } | null> => {
    // Get token from cookies (same way as apiClient)
    const getToken = (): string | null => {
      if (typeof window === "undefined") return null;
      const cookies = document.cookie.split(";");
      const tokenCookie = cookies.find((cookie) => cookie.trim().startsWith("token="));
      return tokenCookie ? tokenCookie.split("=")[1] : null;
    };

    const token = getToken();
    if (!token) {
      toast.error("Please login to upload media");
      return null;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      // Use the same BASE_URL pattern as apiClient
      const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "https://mainbackend.mark-ai.tech/api";
      const cleanBaseUrl = baseUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");

      const response = await fetch(`${cleanBaseUrl}/api/media/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to upload media');
      }

      // Determine media type based on file
      if (file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mp4')) {
        setNewMediaType('video');
      } else {
        setNewMediaType('image');
      }

      return {
        url: result.media?.url || "",
        publicId: result.media?.public_id || ""
      };
    } catch (error: any) {
      console.error("Media upload error:", error);
      setUploadError(error.message || "Failed to upload media");
      toast.error(error.message || "Failed to upload media");
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  // Handle file selection for edit creative
  const handleCreativeFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Allow common image and video formats
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/quicktime'
    ];

    // Check by extension if MIME type is not recognized
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.mov'];
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();

    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
      toast.error("Please upload an image (JPG, PNG, GIF, WebP) or video (MP4, WebM) file");
      return;
    }

    // Check file size (max 100MB)
    if (file.size > 100 * 1024 * 1024) {
      toast.error("File size should be less than 100MB");
      return;
    }

    setUploadedFile(file);

    // Upload to server
    const uploadResult = await uploadMediaFile(file);
    if (uploadResult) {
      setNewMediaUrl(uploadResult.url);
      setNewMediaPublicId(uploadResult.publicId);
      toast.success("File uploaded successfully!");
    }
  };

  // Handle update creative
  const handleUpdateCreative = async () => {
    if (!editCreativeDialog.booking) return;

    if (!newMediaUrl.trim()) {
      toast.error("Please enter a media URL");
      return;
    }

    // Validate URL format
    try {
      new URL(newMediaUrl);
    } catch {
      toast.error("Please enter a valid URL");
      return;
    }

    try {
      setIsProcessing(true);

      const request: UpdateCreativeRequest = {
        media_url: newMediaUrl.trim(),
        media_type: newMediaType,
        cloudinary_public_id: newMediaPublicId || undefined,
      };

      const result = await updateCreative(editCreativeDialog.booking._id, request);

      // Log the updated booking for debugging
      console.log("Creative updated successfully:", result);
      console.log("New media URL:", result.booking?.media_url);

      toast.success(result.message || "Creative updated successfully! Booking now requires re-approval.");

      // Show info about cleanup if schedules were deleted
      if (result.cleanup_summary?.was_scheduled) {
        toast.success(`${result.cleanup_summary.schedules_deleted} schedule(s) removed from Screenox. Approval required.`, {
          duration: 5000,
        });
      }

      // Close dialog and reset state
      setEditCreativeDialog({ open: false, booking: null });
      setNewMediaUrl("");
      setNewMediaType("image");
      setNewMediaPublicId(null);
      setUploadedFile(null);
      setUploadError(null);

      // Refresh bookings to show updated media
      await fetchBookings();
    } catch (error) {
      console.error("Error updating creative:", error);
      toast.error(error instanceof Error ? error.message : "Failed to update creative");
    } finally {
      setIsProcessing(false);
    }
  };

  // Check if user can edit creative for this booking
  const userCanEditCreative = (booking: Booking): boolean => {
    if (!user) return false;
    return canEditCreative(booking, user._id || "", isAdmin);
  };

  // Format date
  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  // Format currency
  const formatCurrency = (amount: number, currency: string = "INR") => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency,
      minimumFractionDigits: 0,
    }).format(amount);
  };

  // Render booking card (now handles GroupedBooking)
  const renderBookingCard = (groupedBooking: GroupedBooking, showActions: boolean = true) => {
    // For single bookings, use the first (and only) booking
    const primaryBooking = groupedBooking.bookings[0];
    const statusInfo = getBookingStatusInfo(primaryBooking);

    // Determine if we can show actions for this grouped booking
    const showOwnerActions = showActions && groupedBooking.bookings.some(b => canOwnerApprove(b));
    const showAdminActions = showActions && groupedBooking.bookings.some(b => canAdminApprove(b));

    // For multi-screen bookings, create a unique key from the group ID
    const cardKey = groupedBooking.booking_group_id || primaryBooking._id;

    return (
      <Card key={cardKey} className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center transition-colors duration-300">
                <Monitor className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <CardTitle className="text-lg transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                  {groupedBooking.is_multi_screen
                    ? `Multi-Screen Booking (${groupedBooking.bookings.length} screens)`
                    : primaryBooking.screen_name}
                </CardTitle>
                <CardDescription className="mt-0.5 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                  ID: {groupedBooking.booking_group_id?.slice(-8) || primaryBooking._id.slice(-8)}
                </CardDescription>
              </div>
            </div>
            <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Booking details */}
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="flex items-center gap-2 transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
              <Calendar className="w-4 h-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
              <span className="text-sm">
                {formatDate(primaryBooking.start_date)} - {formatDate(primaryBooking.end_date)}
              </span>
            </div>
            {/* Hide total amount for screen owners, show for admin and advertiser */}
            {(isAdmin || !isScreenOwner) && (
              <div className="flex items-center gap-2 transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                <IndianRupee className="w-4 h-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                <span className="text-sm">{formatCurrency(groupedBooking.total_amount, primaryBooking.currency)}</span>
              </div>
            )}
            <div className="flex items-center gap-2 transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
              <Clock className="w-4 h-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
              <span className="text-sm">
                Payment: <span className={groupedBooking.payment_status === "paid" ? "text-green-400" : "text-yellow-400"}>
                  {groupedBooking.payment_status}
                </span>
              </span>
            </div>
            {primaryBooking.media_url && (
              <div className="flex items-center gap-2 transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                <ImageIcon className="w-4 h-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                <a
                  href={primaryBooking.media_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:underline flex items-center gap-1"
                >
                  View Media <ExternalLink className="w-3 h-3" />
                </a>
                {/* Edit Creative Button - shown to advertiser or admin */}
                {userCanEditCreative(primaryBooking) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openEditCreativeDialog(primaryBooking)}
                    className="ml-2 h-6 px-2 text-xs border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                  >
                    <Edit3 className="w-3 h-3 mr-1" />
                    Edit
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Invoice and GST Actions - Show for admin and advertiser, hide for screen owners */}
          {groupedBooking.payment_status === "paid" && (isAdmin || !isScreenOwner) && (
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Download Invoice Button */}
              <div className="rounded-lg p-3 border border-blue-500/30 flex-1 transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center transition-colors duration-300">
                      <Download className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Invoice Available</p>
                      <p className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Download your payment invoice</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      try {
                        generateInvoice(primaryBooking);
                        toast.success("Invoice downloaded successfully!");
                      } catch (error) {
                        console.error("Error generating invoice:", error);
                        toast.error("Failed to generate invoice");
                      }
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download PDF
                  </Button>
                </div>
              </div>

              {/* GST Details Button */}
              {primaryBooking.gst_enabled && (
                <div className="rounded-lg p-3 border border-green-500/30 flex-1 transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center transition-colors duration-300">
                        <span className="text-green-400 font-bold text-sm">GST</span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>GST Details Available</p>
                        <p className="text-xs transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Tax invoice information</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setGstDialog({ open: true, booking: primaryBooking })}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      View Details
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Screens and Time Slots Section - Show each screen separately with its own slots */}
          <div className="space-y-4">
            {groupedBooking.bookings.map((booking, bookingIndex) => {
              // Parse all screens with their individual slots from this booking
              const screensWithSlots = parseScreensWithSlots(booking);

              // Check if this booking has multiple screens in its screens array
              const hasMultipleScreens = screensWithSlots.length > 1;
              const totalScreensInGroup = groupedBooking.is_multi_screen
                ? groupedBooking.bookings.reduce((acc, b) => acc + parseScreensWithSlots(b).length, 0)
                : screensWithSlots.length;

              return screensWithSlots.map((screen, screenIndex) => {
                const isExpanded = expandedBookings.has(`${booking._id}-${screen.screenId}`);
                const hasMultipleSlots = screen.timeSlots.length > 1;
                const globalScreenIndex = groupedBooking.is_multi_screen || hasMultipleScreens
                  ? bookingIndex * screensWithSlots.length + screenIndex + 1
                  : 0;

                if (screen.timeSlots.length === 0) return null;

                return (
                  <div key={`${booking._id}-${screen.screenId}`} className="rounded-lg p-4 border border-purple-500/30 transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)' }}>
                    {/* Screen Name Header */}
                    <div className="flex items-center gap-2 mb-3 pb-3 transition-colors duration-300" style={{ borderBottom: '1px solid var(--border-primary)' }}>
                      <Monitor className="w-4 h-4 text-purple-400" />
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                          {screen.screenName || booking.screen_name || "Screen"}
                        </span>
                        <span className="text-xs transition-colors duration-300" style={{ color: 'var(--text-muted)' }}>
                          (ID: {screen.screenId?.slice(-8) || booking._id.slice(-8)})
                        </span>
                      </div>
                      {(groupedBooking.is_multi_screen || hasMultipleScreens) && (
                        <span className="ml-auto text-xs transition-colors duration-300" style={{ color: 'var(--text-muted)' }}>
                          Screen {globalScreenIndex} of {totalScreensInGroup}
                        </span>
                      )}
                    </div>

                    <div
                      className={`flex items-center justify-between ${hasMultipleSlots ? 'cursor-pointer' : ''}`}
                      onClick={() => hasMultipleSlots && toggleExpanded(`${booking._id}-${screen.screenId}`)}
                    >
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-purple-400" />
                        <span className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                          Booked Time Slots ({screen.timeSlots.length})
                        </span>
                      </div>
                      {hasMultipleSlots && (
                        <Button variant="ghost" size="sm" className="p-0 h-auto transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </Button>
                      )}
                    </div>

                    <div className="mt-3 space-y-2">
                      {(() => {
                        const groupedSlots = groupTimeSlotsByRange(screen.timeSlots);
                        const displaySlots = isExpanded || groupedSlots.length <= 2 ? groupedSlots : groupedSlots.slice(0, 2);

                        return (
                          <>
                            {displaySlots.map((groupedSlot, groupIndex) => (
                              <div
                                key={groupIndex}
                                className="bg-purple-500/10 border border-purple-500/20 rounded-lg px-3 py-2 space-y-1.5 transition-colors duration-300"
                              >
                                {/* Time Range Header */}
                                <div className="flex items-center gap-2">
                                  <Clock className="w-3 h-3 text-purple-400" />
                                  <span className="text-sm text-purple-300 font-semibold">
                                    {groupedSlot.timeRange}
                                  </span>
                                </div>

                                {/* Date Ranges */}
                                <div className="pl-5 space-y-1">
                                  {groupedSlot.dateRanges.map((range, rangeIndex) => (
                                    <div key={rangeIndex} className="flex items-center gap-2 text-sm transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                                      <Calendar className="w-3 h-3 text-purple-400" />
                                      {range.isSingleDay ? (
                                        <span>{range.startDay}</span>
                                      ) : (
                                        <span>
                                          {range.startDay} <span className="text-purple-400 mx-1">→</span> {range.endDay}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}

                            {!isExpanded && groupedSlots.length > 2 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpanded(`${booking._id}-${screen.screenId}`);
                                }}
                                className="text-sm text-purple-400 hover:text-purple-300 w-full text-center py-1"
                              >
                                + {groupedSlots.length - 2} more time slot{groupedSlots.length - 2 !== 1 ? 's' : ''}
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                );
              });
            })}
          </div>

          {/* Individual booking approval status for multi-screen */}
          {groupedBooking.is_multi_screen && groupedBooking.bookings.map((booking, bookingIndex) => (
            <div key={`approval-${booking._id}`} className="rounded-lg p-4 mt-2 transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', border: '1px solid' }}>
              <div className="flex items-center gap-2 mb-3 text-sm">
                <span className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Booking {bookingIndex + 1}:</span>
                <span className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{booking.screen_name}</span>
                {/* Show Layout ID after approval */}
                {booking.xibo_layout_id && (
                  <span className="text-purple-400 ml-auto text-xs">Layout ID: {booking.xibo_layout_id}</span>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm flex-wrap">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 transition-colors duration-300" style={{ color: 'var(--text-muted)' }} />
                  <span className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Owner:</span>
                  <span className={
                    booking.screen_owner_approval === "approved" ? "text-green-400" :
                      booking.screen_owner_approval === "rejected" ? "text-red-400" :
                        "text-yellow-400"
                  }>
                    {booking.screen_owner_approval || "pending"}
                  </span>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 transition-colors duration-300" style={{ color: 'var(--text-muted)' }} />
                    <span className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Status:</span>
                    <span className={
                      booking.status === "approved" || booking.status === "scheduled" ? "text-green-400" :
                        booking.status === "rejected" ? "text-red-400" :
                          "text-blue-400"
                    }>
                      {booking.status}
                    </span>
                  </div>
                )}
              </div>

              {/* Individual booking actions for multi-screen */}
              {showActions && (
                <>
                  {canOwnerApprove(booking) && (
                    <div className="flex items-center gap-3 mt-3">
                      <Button
                        size="sm"
                        onClick={() => openApprovalDialog(booking, "owner-approve")}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Approve (Owner)
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openApprovalDialog(booking, "owner-reject")}
                        className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                      >
                        <XCircle className="w-4 h-4 mr-2" />
                        Reject
                      </Button>
                    </div>
                  )}
                  {canAdminApprove(booking) && (
                    <div className="flex items-center gap-3 mt-3">
                      <Button
                        size="sm"
                        onClick={() => openApprovalDialog(booking, "admin-approve")}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Final Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openApprovalDialog(booking, "admin-reject")}
                        className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                      >
                        <XCircle className="w-4 h-4 mr-2" />
                        Reject
                      </Button>
                    </div>
                  )}
                </>
              )}

              {/* Schedule Management for individual booking */}
              {canManageSchedule(booking) && (
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/10">
                  <div className="flex items-center gap-2 text-sm text-gray-400 mr-auto">
                    <Play className="w-4 h-4 text-green-400" />
                    <span>Scheduled in Screenox</span>
                    {booking.xibo_schedule_id && (
                      <span className="text-gray-500">(Schedule ID: {booking.xibo_schedule_id})</span>
                    )}
                    {booking.xibo_layout_id && (
                      <span className="text-purple-400 ml-2">(Layout ID: {booking.xibo_layout_id})</span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openEditDialog(booking)}
                    className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                  >
                    <Edit3 className="w-4 h-4 mr-2" />
                    Edit Dates
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCancelDialog({ open: true, booking })}
                    className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Cancel Schedule
                  </Button>
                </div>
              )}
            </div>
          ))}

          {/* Approval status info - for single bookings */}
          {!groupedBooking.is_multi_screen && statusInfo.description && (
            <div className="flex items-start gap-2 p-3 rounded-lg transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)' }}>
              <AlertCircle className="w-4 h-4 mt-0.5 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
              <span className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>{statusInfo.description}</span>
            </div>
          )}

          {/* Owner/Admin approval indicators - for single bookings */}
          {!groupedBooking.is_multi_screen && (
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 transition-colors duration-300" style={{ color: 'var(--text-muted)' }} />
                <span className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Owner:</span>
                <span className={
                  primaryBooking.screen_owner_approval === "approved" ? "text-green-400" :
                    primaryBooking.screen_owner_approval === "rejected" ? "text-red-400" :
                      "text-yellow-400"
                }>
                  {primaryBooking.screen_owner_approval || "pending"}
                </span>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 transition-colors duration-300" style={{ color: 'var(--text-muted)' }} />
                  <span className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Status:</span>
                  <span className={
                    primaryBooking.status === "approved" || primaryBooking.status === "scheduled" ? "text-green-400" :
                      primaryBooking.status === "rejected" ? "text-red-400" :
                        "text-blue-400"
                  }>
                    {primaryBooking.status}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Action buttons - for single bookings */}
          {!groupedBooking.is_multi_screen && (showOwnerActions || showAdminActions) && (
            <div className="flex items-center gap-3 pt-3 border-t border-white/10">
              {/* Screen Owner Actions */}
              {showOwnerActions && (
                <>
                  <Button
                    size="sm"
                    onClick={() => openApprovalDialog(primaryBooking, "owner-approve")}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Approve (Owner)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openApprovalDialog(primaryBooking, "owner-reject")}
                    className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Reject
                  </Button>
                </>
              )}

              {/* Admin Actions */}
              {showAdminActions && !showOwnerActions && (
                <>
                  <Button
                    size="sm"
                    onClick={() => openApprovalDialog(primaryBooking, "admin-approve")}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Final Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openApprovalDialog(primaryBooking, "admin-reject")}
                    className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Reject
                  </Button>
                </>
              )}

              {/* Admin or Screen Owner can do final approve after owner approved */}
              {(isAdmin || isScreenOwner) && primaryBooking.screen_owner_approval === "approved" &&
                primaryBooking.status !== "approved" && primaryBooking.status !== "scheduled" && (
                  <Button
                    size="sm"
                    onClick={() => openApprovalDialog(primaryBooking, "admin-approve")}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Shield className="w-4 h-4 mr-2" />
                    Final Approve & Schedule
                  </Button>
                )}
            </div>
          )}

          {/* Schedule Management Actions - for single scheduled bookings */}
          {!groupedBooking.is_multi_screen && canManageSchedule(primaryBooking) && (
            <div className="flex items-center gap-3 pt-3 border-t border-white/10">
              <div className="flex items-center gap-2 text-sm text-gray-400 mr-auto">
                <Play className="w-4 h-4 text-green-400" />
                <span>Scheduled in Screenox</span>
                {primaryBooking.xibo_schedule_id && (
                  <span className="text-gray-500">(Schedule ID: {primaryBooking.xibo_schedule_id})</span>
                )}
                {primaryBooking.xibo_layout_id && (
                  <span className="text-purple-400 ml-2">(Layout ID: {primaryBooking.xibo_layout_id})</span>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openEditDialog(primaryBooking)}
                className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
              >
                <Edit3 className="w-4 h-4 mr-2" />
                Edit Dates
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCancelDialog({ open: true, booking: primaryBooking })}
                className="border-red-500/30 text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Cancel Schedule
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  // Render loading state
  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Bookings</h1>
          <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Loading bookings...</p>
        </div>
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
              <CardContent className="p-6">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
          {isAdmin ? "All Bookings" : isScreenOwner ? "Screen Bookings" : "My Bookings"}
        </h1>
        <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
          {isAdmin
            ? "View and manage all bookings across the platform"
            : isScreenOwner
              ? "View and approve bookings for your screens"
              : "View your campaign bookings"}
        </p>
      </div>

      {/* Tabs for admin/screen owner */}
      {(isAdmin || isScreenOwner) ? (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', border: '1px solid' }}>
            <TabsTrigger
              value="all"
              className="data-[state=active]:bg-white data-[state=active]:text-black transition-colors duration-300"
              style={{ color: activeTab === 'all' ? undefined : 'var(--text-secondary)' }}
            >
              All Bookings
            </TabsTrigger>
            <TabsTrigger
              value="pending"
              className="data-[state=active]:bg-white data-[state=active]:text-black transition-colors duration-300"
              style={{ color: activeTab === 'pending' ? undefined : 'var(--text-secondary)' }}
            >
              Pending Approval
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="space-y-4">
            {bookings.length === 0 ? (
              <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                <CardContent className="py-12 text-center">
                  <Monitor className="w-12 h-12 mx-auto mb-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                  <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>No bookings found</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {bookings.map((booking) => renderBookingCard(booking))}

                {/* Pagination Controls */}
                {(currentPage > 0 || hasNextPage) && (
                  <div className="flex justify-center items-center gap-4 pt-6">
                    <Button
                      onClick={handlePrevPage}
                      disabled={currentPage === 0 || loading}
                      variant="outline"
                      className="transition-colors duration-300"
                      style={{
                        borderColor: 'var(--border-primary)',
                        color: currentPage === 0 ? 'var(--text-muted)' : 'var(--text-primary)'
                      }}
                    >
                      Previous
                    </Button>
                    <span className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                      Page {currentPage + 1}
                    </span>
                    <Button
                      onClick={handleNextPage}
                      disabled={!hasNextPage || loading}
                      variant="outline"
                      className="transition-colors duration-300"
                      style={{
                        borderColor: 'var(--border-primary)',
                        color: !hasNextPage ? 'var(--text-muted)' : 'var(--text-primary)'
                      }}
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        'Next'
                      )}
                    </Button>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="pending" className="space-y-4">
            {loadingPending ? (
              <div className="space-y-4">
                {[...Array(2)].map((_, i) => (
                  <Card key={i} className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                    <CardContent className="p-6">
                      <Skeleton className="h-20 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : pendingOwnerBookings.length === 0 ? (
              <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                <CardContent className="py-12 text-center">
                  <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-4" />
                  <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>No bookings pending your approval</p>
                </CardContent>
              </Card>
            ) : (
              pendingOwnerBookings.map((booking) => renderBookingCard(booking))
            )}
          </TabsContent>
        </Tabs>
      ) : (
        // Regular advertiser view
        <div className="space-y-4">
          {bookings.length === 0 ? (
            <Card className="transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
              <CardContent className="py-12 text-center">
                <Monitor className="w-12 h-12 mx-auto mb-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>No bookings found</p>
                <p className="text-sm mt-2 transition-colors duration-300" style={{ color: 'var(--text-muted)' }}>Book a screen to get started!</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {bookings.map((booking) => renderBookingCard(booking, false))}

              {/* Pagination Controls */}
              {(currentPage > 0 || hasNextPage) && (
                <div className="flex justify-center items-center gap-4 pt-6">
                  <Button
                    onClick={handlePrevPage}
                    disabled={currentPage === 0 || loading}
                    variant="outline"
                    className="transition-colors duration-300"
                    style={{
                      borderColor: 'var(--border-primary)',
                      color: currentPage === 0 ? 'var(--text-muted)' : 'var(--text-primary)'
                    }}
                  >
                    Previous
                  </Button>
                  <span className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                    Page {currentPage + 1}
                  </span>
                  <Button
                    onClick={handleNextPage}
                    disabled={!hasNextPage || loading}
                    variant="outline"
                    className="transition-colors duration-300"
                    style={{
                      borderColor: 'var(--border-primary)',
                      color: !hasNextPage ? 'var(--text-muted)' : 'var(--text-primary)'
                    }}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      'Next'
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Approval Dialog */}
      <Dialog
        open={approvalDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            setApprovalDialog({ open: false, booking: null, action: null });
            setRejectionReason("");
          }
        }}
      >
        <DialogContent className="max-w-md transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
          <DialogHeader>
            <DialogTitle className="text-xl transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
              {approvalDialog.action?.includes("approve") ? "Approve Booking" : "Reject Booking"}
            </DialogTitle>
            <DialogDescription className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              {approvalDialog.action === "owner-approve" && "Approve this booking for your screen"}
              {approvalDialog.action === "owner-reject" && "Reject this booking for your screen"}
              {approvalDialog.action === "admin-approve" && "Final approval - this will create a schedule in Screenox"}
              {approvalDialog.action === "admin-reject" && "Reject this booking"}
            </DialogDescription>
          </DialogHeader>

          {approvalDialog.booking && (
            <div className="space-y-4 py-4">
              <div className="p-3 rounded-lg transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', border: '1px solid' }}>
                <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Screen</p>
                <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{approvalDialog.booking.screen_name}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Hide amount for screen owners in approval dialog */}
                {isAdmin && (
                  <div className="p-3 rounded-lg border transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                    <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Amount</p>
                    <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                      {formatCurrency(approvalDialog.booking.total_amount, approvalDialog.booking.currency)}
                    </p>
                  </div>
                )}
                <div className={`p-3 rounded-lg border transition-colors duration-300 ${!isAdmin ? 'col-span-2' : ''}`} style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                  <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Duration</p>
                  <p className="font-medium text-sm transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                    {formatDate(approvalDialog.booking.start_date)} - {formatDate(approvalDialog.booking.end_date)}
                  </p>
                </div>
              </div>

              {/* Rejection reason input */}
              {approvalDialog.action?.includes("reject") && (
                <div className="space-y-2">
                  <label className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Reason for rejection (optional)</label>
                  <Textarea
                    placeholder="Enter reason for rejection..."
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    className="resize-none transition-colors duration-300"
                    style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                    rows={3}
                  />
                </div>
              )}

              {/* Admin approval warning */}
              {approvalDialog.action === "admin-approve" && (
                <div className="flex items-start gap-2 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                  <AlertCircle className="w-4 h-4 text-blue-400 mt-0.5" />
                  <span className="text-sm text-blue-300">
                    This will create a layout and schedule in Screenox CMS for the booking dates.
                  </span>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setApprovalDialog({ open: false, booking: null, action: null });
                setRejectionReason("");
              }}
              className="transition-colors duration-300"
              style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleApprovalAction}
              disabled={isProcessing}
              className={
                approvalDialog.action?.includes("approve")
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : "bg-red-600 hover:bg-red-700 text-white"
              }
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : approvalDialog.action?.includes("approve") ? (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Approve
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 mr-2" />
                  Reject
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Schedule Dialog */}
      <Dialog
        open={editDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            setEditDialog({ open: false, booking: null });
            setEditDates({ start: "", end: "" });
          }
        }}
      >
        <DialogContent className="max-w-md transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
              <Edit3 className="w-5 h-5 text-blue-400" />
              Edit Schedule
            </DialogTitle>
            <DialogDescription className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              Update the schedule dates for this booking in Screenox.
            </DialogDescription>
          </DialogHeader>

          {editDialog.booking && (
            <div className="space-y-4 py-4">
              <div className="p-3 rounded-lg border transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Screen</p>
                <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{editDialog.booking.screen_name}</p>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="start-date" className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                    Start Date & Time
                  </Label>
                  <Input
                    id="start-date"
                    type="datetime-local"
                    value={editDates.start}
                    onChange={(e) => setEditDates((prev) => ({ ...prev, start: e.target.value }))}
                    className="transition-colors duration-300"
                    style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end-date" className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                    End Date & Time
                  </Label>
                  <Input
                    id="end-date"
                    type="datetime-local"
                    value={editDates.end}
                    onChange={(e) => setEditDates((prev) => ({ ...prev, end: e.target.value }))}
                    className="transition-colors duration-300"
                    style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>

              <div className="flex items-start gap-2 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5" />
                <span className="text-sm text-yellow-300">
                  This will delete the current schedule and create a new one with the updated dates.
                </span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditDialog({ open: false, booking: null });
                setEditDates({ start: "", end: "" });
              }}
              className="transition-colors duration-300"
              style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleEditSchedule}
              disabled={isProcessing || !editDates.start || !editDates.end}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <Edit3 className="w-4 h-4 mr-2" />
                  Update Schedule
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Schedule Confirmation Dialog */}
      <Dialog
        open={cancelDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            setCancelDialog({ open: false, booking: null });
          }
        }}
      >
        <DialogContent className="max-w-md transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
              <Trash2 className="w-5 h-5 text-red-400" />
              Cancel Schedule
            </DialogTitle>
            <DialogDescription className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              Are you sure you want to cancel this schedule? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {cancelDialog.booking && (
            <div className="space-y-4 py-4">
              <div className="p-3 rounded-lg border transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Screen</p>
                <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{cancelDialog.booking.screen_name}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Hide amount for screen owners in cancel dialog */}
                {isAdmin && (
                  <div className="p-3 rounded-lg border transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                    <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Amount</p>
                    <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                      {formatCurrency(cancelDialog.booking.total_amount, cancelDialog.booking.currency)}
                    </p>
                  </div>
                )}
                <div className={`p-3 rounded-lg border transition-colors duration-300 ${!isAdmin ? 'col-span-2' : ''}`} style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                  <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Duration</p>
                  <p className="font-medium text-sm transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
                    {formatDate(cancelDialog.booking.start_date)} - {formatDate(cancelDialog.booking.end_date)}
                  </p>
                </div>
              </div>

              {cancelDialog.booking.xibo_schedule_id && (
                <div className="p-3 rounded-lg border transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                  <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Screenox Schedule ID</p>
                  <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{cancelDialog.booking.xibo_schedule_id}</p>
                </div>
              )}

              <div className="flex items-start gap-2 p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5" />
                <span className="text-sm text-red-300">
                  This will remove the schedule from Screenox and mark the booking as cancelled. The ad will no longer be displayed.
                </span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelDialog({ open: false, booking: null })}
              className="transition-colors duration-300"
              style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
            >
              Keep Schedule
            </Button>
            <Button
              onClick={handleCancelSchedule}
              disabled={isProcessing}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Cancelling...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Cancel Schedule
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* GST Details Dialog */}
      <Dialog
        open={gstDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            setGstDialog({ open: false, booking: null });
          }
        }}
      >
        <DialogContent className="bg-[#0f0f0f] border-white/10 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-green-500/20 flex items-center justify-center">
                <span className="text-green-400 font-bold text-xs">GST</span>
              </div>
              GST Tax Invoice Details
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              Complete GST information submitted by the user for this booking
            </DialogDescription>
          </DialogHeader>

          {gstDialog.booking && (
            <div className="space-y-4 py-4">
              {/* Header Badge */}
              <div className="flex items-center justify-center">
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30 px-4 py-1">
                  Tax Invoice - GST Registered
                </Badge>
              </div>

              {/* GST Information Grid */}
              <div className="grid gap-4 md:grid-cols-2">
                {/* GSTIN */}
                {gstDialog.booking.gstin && (
                  <div className="bg-[#1a1a1a] rounded-lg p-4 border border-white/10">
                    <div className="flex items-center gap-2 mb-2">
                      <Shield className="w-4 h-4 text-green-400" />
                      <p className="text-xs text-gray-500 font-semibold uppercase">GSTIN</p>
                    </div>
                    <p className="text-base text-white font-mono font-semibold">{gstDialog.booking.gstin}</p>
                  </div>
                )}

                {/* Company Name */}
                {gstDialog.booking.gst_company_name && (
                  <div className="bg-[#1a1a1a] rounded-lg p-4 border border-white/10">
                    <div className="flex items-center gap-2 mb-2">
                      <User className="w-4 h-4 text-blue-400" />
                      <p className="text-xs text-gray-500 font-semibold uppercase">Company Name</p>
                    </div>
                    <p className="text-base text-white font-medium">{gstDialog.booking.gst_company_name}</p>
                  </div>
                )}

                {/* State */}
                {gstDialog.booking.gst_state && (
                  <div className="bg-[#1a1a1a] rounded-lg p-4 border border-white/10">
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin className="w-4 h-4 text-purple-400" />
                      <p className="text-xs text-gray-500 font-semibold uppercase">State</p>
                    </div>
                    <p className="text-base text-white">{gstDialog.booking.gst_state}</p>
                  </div>
                )}

                {/* City */}
                {gstDialog.booking.gst_city && (
                  <div className="bg-[#1a1a1a] rounded-lg p-4 border border-white/10">
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin className="w-4 h-4 text-purple-400" />
                      <p className="text-xs text-gray-500 font-semibold uppercase">City</p>
                    </div>
                    <p className="text-base text-white">{gstDialog.booking.gst_city}</p>
                  </div>
                )}

                {/* Pincode */}
                {gstDialog.booking.gst_pincode && (
                  <div className="bg-[#1a1a1a] rounded-lg p-4 border border-white/10">
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin className="w-4 h-4 text-purple-400" />
                      <p className="text-xs text-gray-500 font-semibold uppercase">Pincode</p>
                    </div>
                    <p className="text-base text-white font-mono">{gstDialog.booking.gst_pincode}</p>
                  </div>
                )}

                {/* Full Address */}
                {gstDialog.booking.gst_address && (
                  <div className="bg-[#1a1a1a] rounded-lg p-4 border border-white/10 md:col-span-2">
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin className="w-4 h-4 text-purple-400" />
                      <p className="text-xs text-gray-500 font-semibold uppercase">Billing Address</p>
                    </div>
                    <p className="text-base text-white leading-relaxed">
                      {gstDialog.booking.gst_address}
                      {gstDialog.booking.gst_city && `, ${gstDialog.booking.gst_city}`}
                      {gstDialog.booking.gst_state && `, ${gstDialog.booking.gst_state}`}
                      {gstDialog.booking.gst_pincode && ` - ${gstDialog.booking.gst_pincode}`}
                    </p>
                  </div>
                )}
              </div>

              {/* Amount Breakdown Section - Only visible to admin */}
              {isAdmin && (
                <div className="bg-linear-to-br from-green-500/10 to-blue-500/10 rounded-lg p-4 border border-green-500/20">
                  <div className="flex items-center gap-2 mb-4">
                    <IndianRupee className="w-5 h-5 text-green-400" />
                    <p className="text-sm text-gray-300 font-semibold uppercase">Amount Breakdown</p>
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-400">Base Amount</span>
                      <span className="text-lg text-white font-semibold">
                        {formatCurrency(gstDialog.booking.base_amount || 0, gstDialog.booking.currency)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-400">GST @ 18%</span>
                      <span className="text-lg text-green-400 font-semibold">
                        + {formatCurrency(gstDialog.booking.gst_amount || 0, gstDialog.booking.currency)}
                      </span>
                    </div>
                    <div className="border-t border-white/20 pt-3 mt-3">
                      <div className="flex justify-between items-center">
                        <span className="text-base text-white font-bold">Total Amount (Incl. GST)</span>
                        <span className="text-2xl text-white font-bold">
                          {formatCurrency(gstDialog.booking.total_amount, gstDialog.booking.currency)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Footer Note */}
              <div className="flex items-start gap-2 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <AlertCircle className="w-4 h-4 text-blue-400 mt-0.5" />
                <span className="text-xs text-blue-300">
                  This information is used for generating GST-compliant tax invoices. Please verify all details for accuracy.
                </span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGstDialog({ open: false, booking: null })}
              className="border-white/10 text-white hover:bg-white/10"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Creative Dialog */}
      <Dialog
        open={editCreativeDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            setEditCreativeDialog({ open: false, booking: null });
            setNewMediaUrl("");
            setNewMediaType("image");
            setUploadedFile(null);
            setUploadError(null);
          }
        }}
      >
        <DialogContent className="max-w-lg transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2 transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
              <ImageIcon className="w-5 h-5 text-purple-400" />
              Edit Creative
            </DialogTitle>
            <DialogDescription className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
              Update the media/creative for this booking. This will require re-approval from screen owner and admin.
            </DialogDescription>
          </DialogHeader>

          {editCreativeDialog.booking && (
            <div className="space-y-4 py-4">
              {/* Current booking info */}
              <div className="p-3 rounded-lg border transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                <p className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Screen</p>
                <p className="font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{editCreativeDialog.booking.screen_name}</p>
              </div>

              {/* Current media preview */}
              {editCreativeDialog.booking.media_url && !uploadedFile && (
                <div className="p-3 rounded-lg border transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
                  <p className="text-sm mb-2 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Current Creative</p>
                  <div className="flex items-center gap-3">
                    {editCreativeDialog.booking.media_type === "video" ? (
                      <div className="w-16 h-16 rounded bg-purple-500/20 flex items-center justify-center">
                        <Play className="w-8 h-8 text-purple-400" />
                      </div>
                    ) : (
                      <img
                        src={editCreativeDialog.booking.media_url}
                        alt="Current creative"
                        className="w-16 h-16 object-cover rounded"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    )}
                    <a
                      href={editCreativeDialog.booking.media_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-400 hover:underline flex items-center gap-1 truncate max-w-xs"
                    >
                      {editCreativeDialog.booking.media_url.substring(0, 50)}...
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </div>
                </div>
              )}

              {/* File Upload Section */}
              <div className="space-y-2">
                <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                  Upload New Creative
                </Label>
                <div>
                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime"
                    onChange={handleCreativeFileUpload}
                    className="hidden"
                    id="creative-file-upload"
                    disabled={isUploading}
                  />
                  <label
                    htmlFor="creative-file-upload"
                    className={`flex items-center gap-2 p-4 border-2 border-dashed rounded-lg cursor-pointer transition-colors duration-300 ${
                      uploadedFile && newMediaUrl
                        ? "border-green-500/50 bg-green-500/10"
                        : uploadError
                        ? "border-red-500/50 bg-red-500/10"
                        : "hover:border-purple-500/50 hover:bg-purple-500/5"
                    }`}
                    style={!uploadedFile && !uploadError ? { borderColor: 'var(--border-primary)' } : {}}
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
                        <span className="text-sm text-purple-400">Uploading...</span>
                      </>
                    ) : uploadedFile && newMediaUrl ? (
                      <>
                        <CheckCircle className="w-5 h-5 text-green-400" />
                        <span className="text-sm text-green-400 truncate">
                          {uploadedFile.name} (Uploaded)
                        </span>
                      </>
                    ) : uploadError ? (
                      <>
                        <XCircle className="w-5 h-5 text-red-400" />
                        <span className="text-sm text-red-400">{uploadError}</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-5 h-5 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                        <span className="text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                          Click to upload (JPG, PNG, GIF, MP4, WebM - max 100MB)
                        </span>
                      </>
                    )}
                  </label>
                </div>
              </div>

              {/* OR divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-white/10"></div>
                <span className="text-xs text-gray-500">OR</span>
                <div className="flex-1 h-px bg-white/10"></div>
              </div>

              {/* URL input */}
              <div className="space-y-2">
                <Label htmlFor="media-url" className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                  Paste Media URL
                </Label>
                <Input
                  id="media-url"
                  type="url"
                  placeholder="https://example.com/your-media.jpg"
                  value={newMediaUrl}
                  onChange={(e) => {
                    setNewMediaUrl(e.target.value);
                    if (e.target.value && uploadedFile) {
                      setUploadedFile(null); // Clear uploaded file if URL is manually entered
                    }
                  }}
                  className="transition-colors duration-300"
                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                />
              </div>

              {/* Media type selector */}
              <div className="space-y-2">
                <Label className="text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
                  Media Type
                </Label>
                <div className="flex gap-3">
                  <Button
                    type="button"
                    size="sm"
                    variant={newMediaType === "image" ? "default" : "outline"}
                    onClick={() => setNewMediaType("image")}
                    className={newMediaType === "image"
                      ? "bg-purple-600 hover:bg-purple-700 text-white"
                      : "border-white/10 text-white hover:bg-white/10"}
                  >
                    <ImageIcon className="w-4 h-4 mr-2" />
                    Image
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={newMediaType === "video" ? "default" : "outline"}
                    onClick={() => setNewMediaType("video")}
                    className={newMediaType === "video"
                      ? "bg-purple-600 hover:bg-purple-700 text-white"
                      : "border-white/10 text-white hover:bg-white/10"}
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Video
                  </Button>
                </div>
              </div>

              {/* Warning about re-approval */}
              <div className="flex items-start gap-2 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5" />
                <div className="text-sm text-yellow-300">
                  <p className="font-medium">Important:</p>
                  <ul className="list-disc list-inside mt-1 space-y-1 text-xs">
                    <li>Current schedules will be removed from Screenox</li>
                    <li>Screen owner will need to re-approve the new creative</li>
                    <li>Admin will need to do final approval</li>
                    <li>New layout and schedules will be created upon approval</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditCreativeDialog({ open: false, booking: null });
                setNewMediaUrl("");
                setNewMediaType("image");
                setUploadedFile(null);
                setUploadError(null);
              }}
              className="transition-colors duration-300"
              style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdateCreative}
              disabled={isProcessing || isUploading || !newMediaUrl.trim()}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <ImageIcon className="w-4 h-4 mr-2" />
                  Update Creative
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BookingsPage;
