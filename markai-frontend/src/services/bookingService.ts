import { BASE_URL, apiFetch } from "@/utils/apiClient";

export interface Booking {
  _id: string;
  advertiser_id: string;
  screen_id: string;
  screen_name: string;
  start_date: string;
  end_date: string;
  media_url?: string;
  media_type?: string;
  cloudinary_public_id?: string;
  total_amount: number;
  currency: string;
  payment_status: string;
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
  xibo_display_id?: number;
  xibo_display_group_id?: number;
  xibo_schedule_id?: number;
  xibo_schedule_ids?: number[];  // Multiple schedule IDs for individual slots
  xibo_campaign_id?: number;
  xibo_layout_id?: number;
  xibo_media_id?: number;
  time_slots?: { start: string; end: string; screenId?: string }[];  // Individual time slots with optional screenId
  // NEW: Screen slots mapping - each screen with its own slots
  screen_slots?: {
    screen_id: string;
    screen_name: string;
    xibo_display_id?: number;
    xibo_display_group_id?: number;
    time_slots: { start: string; end: string }[];
  }[];
  // Multi-screen booking
  booking_type?: string;  // "single" or "multi_screen"
  screens?: any[];  // Array of screen data for multi-screen bookings
  booking_group_id?: string;  // Links multi-screen bookings together
  is_primary_booking?: boolean;  // True for first booking in group
  // Screen Owner Approval
  screen_owner_id?: string;
  screen_owner_approval: string; // "pending", "approved", "rejected"
  screen_owner_approved_by?: string;
  screen_owner_approved_at?: string;
  screen_owner_rejection_reason?: string;
  // Admin Approval
  status: string;
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  // GST Details
  gst_enabled?: boolean;
  gstin?: string;
  gst_company_name?: string;
  gst_address?: string;
  gst_city?: string;
  gst_state?: string;
  gst_pincode?: string;
  base_amount?: number;
  gst_amount?: number;
}

export interface BookingsResponse {
  bookings: Booking[];
  total: number;
  limit: number;
  skip: number;
}

// Grouped booking interface for multi-screen bookings
export interface GroupedBooking {
  booking_group_id: string | null;
  bookings: Booking[];  // All bookings in this group
  is_multi_screen: boolean;
  total_amount: number;
  payment_status: string;
  status: string;
  created_at: string;
  // Aggregated approval status
  screen_owner_approval: string;  // "pending", "approved", "rejected", "mixed"
}

// Group bookings by booking_group_id
export const groupBookingsByGroupId = (bookings: Booking[]): GroupedBooking[] => {
  const grouped = new Map<string, Booking[]>();
  const singles: Booking[] = [];

  // Separate bookings into groups and singles
  bookings.forEach((booking) => {
    if (booking.booking_group_id && booking.booking_type === 'multi_screen') {
      const existing = grouped.get(booking.booking_group_id) || [];
      existing.push(booking);
      grouped.set(booking.booking_group_id, existing);
    } else {
      singles.push(booking);
    }
  });

  const result: GroupedBooking[] = [];

  // Add grouped bookings
  grouped.forEach((groupBookings, groupId) => {
    // Sort by created_at to get primary booking first
    groupBookings.sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    const primaryBooking = groupBookings[0];

    // Calculate total amount
    const totalAmount = groupBookings.reduce((sum, b) => sum + b.total_amount, 0);

    // Determine aggregated approval status
    const approvalStatuses = groupBookings.map(b => b.screen_owner_approval);
    let aggregatedApproval = "pending";
    if (approvalStatuses.every(s => s === "approved")) {
      aggregatedApproval = "approved";
    } else if (approvalStatuses.some(s => s === "rejected")) {
      aggregatedApproval = "rejected";
    } else if (approvalStatuses.some(s => s === "approved") && approvalStatuses.some(s => s === "pending")) {
      aggregatedApproval = "mixed";
    }

    result.push({
      booking_group_id: groupId,
      bookings: groupBookings,
      is_multi_screen: true,
      total_amount: totalAmount,
      payment_status: primaryBooking.payment_status,
      status: primaryBooking.status,
      created_at: primaryBooking.created_at,
      screen_owner_approval: aggregatedApproval,
    });
  });

  // Add single bookings as individual groups
  singles.forEach((booking) => {
    result.push({
      booking_group_id: null,
      bookings: [booking],
      is_multi_screen: false,
      total_amount: booking.total_amount,
      payment_status: booking.payment_status,
      status: booking.status,
      created_at: booking.created_at,
      screen_owner_approval: booking.screen_owner_approval,
    });
  });

  // Sort by created_at descending (newest first)
  result.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return result;
};

// Get all bookings (filtered by role on backend)
export const getBookings = async (
  limit: number = 50,
  skip: number = 0,
  status?: string
): Promise<BookingsResponse> => {
  const statusParam = status ? `&status=${status}` : "";
  return apiFetch<BookingsResponse>(
    `${BASE_URL}/api/bookings?limit=${limit}&skip=${skip}${statusParam}`,
    {
      method: "GET",
    }
  );
};

// Get single booking by ID
export const getBookingById = async (bookingId: string): Promise<{ booking: Booking }> => {
  return apiFetch<{ booking: Booking }>(`${BASE_URL}/api/bookings/${bookingId}`, {
    method: "GET",
  });
};

// Get bookings pending owner approval
export const getPendingOwnerApproval = async (): Promise<{ bookings: Booking[]; total: number }> => {
  return apiFetch<{ bookings: Booking[]; total: number }>(`${BASE_URL}/api/bookings/pending-owner-approval`, {
    method: "GET",
  });
};

// Screen Owner: Approve booking
export const ownerApproveBooking = async (
  bookingId: string
): Promise<{ message: string; booking: Booking }> => {
  return apiFetch<{ message: string; booking: Booking }>(`${BASE_URL}/api/bookings/${bookingId}/owner-approve`, {
    method: "POST",
  });
};

// Screen Owner: Reject booking
export const ownerRejectBooking = async (
  bookingId: string,
  reason?: string
): Promise<{ message: string; booking: Booking }> => {
  return apiFetch<{ message: string; booking: Booking }>(`${BASE_URL}/api/bookings/${bookingId}/owner-reject`, {
    method: "POST",
    body: JSON.stringify({ reason: reason || "" }),
  });
};

// Admin: Final approve booking (creates Screenox schedule)
export const adminApproveBooking = async (
  bookingId: string
): Promise<{ message: string; booking: Booking; layout_created?: boolean; schedule_created?: boolean }> => {
  return apiFetch<{ message: string; booking: Booking; layout_created?: boolean; schedule_created?: boolean }>(
    `${BASE_URL}/api/bookings/${bookingId}/approve`,
    {
      method: "POST",
    }
  );
};

// Admin: Reject booking
export const adminRejectBooking = async (
  bookingId: string,
  reason?: string
): Promise<{ message: string }> => {
  return apiFetch<{ message: string }>(`${BASE_URL}/api/bookings/${bookingId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason: reason || "" }),
  });
};

// ============ SCHEDULE MANAGEMENT ============

// Cancel schedule for a booking
export const cancelSchedule = async (
  bookingId: string
): Promise<{ message: string; booking: Booking }> => {
  return apiFetch<{ message: string; booking: Booking }>(
    `${BASE_URL}/api/bookings/${bookingId}/cancel-schedule`,
    {
      method: "POST",
    }
  );
};

// Edit schedule dates
export const editSchedule = async (
  bookingId: string,
  startDate: string,
  endDate: string
): Promise<{ message: string; booking: Booking; new_schedule?: any }> => {
  return apiFetch<{ message: string; booking: Booking; new_schedule?: any }>(
    `${BASE_URL}/api/bookings/${bookingId}/edit-schedule`,
    {
      method: "PUT",
      body: JSON.stringify({
        start_date: startDate,
        end_date: endDate,
      }),
    }
  );
};

// Get schedule status
export interface ScheduleStatus {
  booking_id: string;
  status: "not_scheduled" | "upcoming" | "playing" | "completed" | "cancelled" | "scheduled";
  schedule_info: any;
  layout_info: {
    layout_id: number;
    name: string;
    status: number;
    published_status: string;
    duration: number;
  } | null;
  start_date: string | null;
  end_date: string | null;
  xibo_schedule_id: number | null;
  xibo_layout_id: number | null;
  xibo_campaign_id: number | null;
}

export const getScheduleStatus = async (bookingId: string): Promise<ScheduleStatus> => {
  return apiFetch<ScheduleStatus>(`${BASE_URL}/api/bookings/${bookingId}/schedule-status`, {
    method: "GET",
  });
};

// Get proof of play statistics
export interface ProofOfPlay {
  booking_id: string;
  layout_id: number;
  period: {
    from: string;
    to: string;
  };
  summary: {
    total_plays: number;
    total_duration_seconds: number;
  };
  details: any[];
}

export const getProofOfPlay = async (bookingId: string): Promise<ProofOfPlay> => {
  return apiFetch<ProofOfPlay>(`${BASE_URL}/api/bookings/${bookingId}/proof-of-play`, {
    method: "GET",
  });
};

// ============ SCREENOX OPTIONS ============

// Day Part interface
export interface DayPart {
  dayPartId: number;
  name: string;
  description: string;
  startTime: string;
  endTime: string;
  isAlways: number;
  isCustom: number;
}

// Get available day parts from Screenox
export const getScreenoxDayParts = async (): Promise<{
  day_parts: DayPart[];
  recurrence_options: { value: string | null; label: string }[];
  week_days: string[];
}> => {
  return apiFetch<{
    day_parts: DayPart[];
    recurrence_options: { value: string | null; label: string }[];
    week_days: string[];
  }>(`${BASE_URL}/api/bookings/screenox/day-parts`, {
    method: "GET",
  });
};

// Display Group interface
export interface DisplayGroup {
  displayGroupId: number;
  displayGroup: string;
  description: string;
  isDynamic: number;
}

// Get available display groups from Screenox
export const getScreenoxDisplayGroups = async (): Promise<{
  display_groups: DisplayGroup[];
}> => {
  return apiFetch<{
    display_groups: DisplayGroup[];
  }>(`${BASE_URL}/api/bookings/screenox/display-groups`, {
    method: "GET",
  });
};

// Helper: Get status display info
export const getBookingStatusInfo = (booking: Booking): { label: string; color: string; description: string } => {
  const { status, payment_status, screen_owner_approval } = booking;

  // Payment not done
  if (payment_status !== "paid") {
    return {
      label: "Payment Pending",
      color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      description: "Awaiting payment from advertiser",
    };
  }

  // Screen owner rejection
  if (screen_owner_approval === "rejected") {
    return {
      label: "Owner Rejected",
      color: "bg-red-500/20 text-red-400 border-red-500/30",
      description: booking.screen_owner_rejection_reason || "Rejected by screen owner",
    };
  }

  // Waiting for screen owner
  if (screen_owner_approval === "pending") {
    return {
      label: "Awaiting Owner",
      color: "bg-orange-500/20 text-orange-400 border-orange-500/30",
      description: "Waiting for screen owner approval",
    };
  }

  // Status-based
  switch (status) {
    case "owner_approved":
      return {
        label: "Owner Approved",
        color: "bg-blue-500/20 text-blue-400 border-blue-500/30",
        description: "Approved by owner, awaiting admin final approval",
      };
    case "approved":
      return {
        label: "Approved",
        color: "bg-green-500/20 text-green-400 border-green-500/30",
        description: "Booking approved",
      };
    case "scheduled":
      return {
        label: "Scheduled",
        color: "bg-green-500/20 text-green-400 border-green-500/30",
        description: "Scheduled in Screenox",
      };
    case "live":
      return {
        label: "Live",
        color: "bg-purple-500/20 text-purple-400 border-purple-500/30",
        description: "Currently displaying",
      };
    case "completed":
      return {
        label: "Completed",
        color: "bg-gray-500/20 text-gray-400 border-gray-500/30",
        description: "Campaign completed",
      };
    case "rejected":
      return {
        label: "Rejected",
        color: "bg-red-500/20 text-red-400 border-red-500/30",
        description: booking.rejection_reason || "Rejected by admin",
      };
    case "cancelled":
      return {
        label: "Cancelled",
        color: "bg-gray-500/20 text-gray-400 border-gray-500/30",
        description: "Booking cancelled",
      };
    case "paid":
      return {
        label: "Paid",
        color: "bg-blue-500/20 text-blue-400 border-blue-500/30",
        description: "Payment received, awaiting approval",
      };
    default:
      return {
        label: status || "Unknown",
        color: "bg-gray-500/20 text-gray-400 border-gray-500/30",
        description: "",
      };
  }
};

// ============ UPDATE CREATIVE (MEDIA) ============

export interface UpdateCreativeRequest {
  media_url: string;
  media_type?: string;
  cloudinary_public_id?: string;
}

export interface UpdateCreativeResponse {
  message: string;
  booking: Booking;
  cleanup_summary: {
    schedules_deleted: number;
    layout_deleted: boolean;
    media_deleted: boolean;
    was_scheduled: boolean;
  };
  next_steps: string[];
}

/**
 * Update/replace the creative (media) for an existing booking.
 *
 * This will:
 * 1. Delete existing schedules from Screenox (if any)
 * 2. Update the media URL and type in the booking
 * 3. Reset all approvals to pending (screen owner approval & admin approval)
 * 4. Clear existing Screenox layout/campaign/schedule data
 * 5. The booking will need to go through the full approval workflow again
 *
 * Only the booking owner (advertiser) or admin can update the creative.
 */
export const updateCreative = async (
  bookingId: string,
  data: UpdateCreativeRequest
): Promise<UpdateCreativeResponse> => {
  return apiFetch<UpdateCreativeResponse>(
    `${BASE_URL}/api/bookings/${bookingId}/update-creative`,
    {
      method: "PUT",
      body: JSON.stringify(data),
    }
  );
};

// Helper: Check if user can edit booking creative
export const canEditCreative = (
  booking: Booking,
  userId: string,
  isAdmin: boolean
): boolean => {
  // Only advertiser who created it or admin can edit
  const isOwner = booking.advertiser_id === userId;
  if (!isOwner && !isAdmin) return false;

  // Cannot edit cancelled, completed, or rejected bookings
  const disallowedStatuses = ['cancelled', 'completed', 'rejected'];
  if (disallowedStatuses.includes(booking.status)) return false;

  // Must have completed payment
  if (booking.payment_status !== 'paid') return false;

  return true;
};
