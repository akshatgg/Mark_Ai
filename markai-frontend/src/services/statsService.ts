import { BASE_URL, getAuthToken } from "@/utils/apiClient";

export interface DashboardStats {
  stats: {
    // Admin stats
    total_bookings?: number;
    total_bookings_change?: string;
    active_screens?: number;
    active_screens_change?: string;
    screen_owners?: number;
    screen_owners_change?: string;
    total_users?: number;
    total_users_change?: string;

    // Screen owner stats
    my_bookings?: number;
    my_bookings_change?: string;
    revenue?: string;
    revenue_change?: string;
    pending_creatives?: number;
    pending_creatives_change?: string;
    approved_creatives?: number;
    rejected_creatives?: number;

    // Advertiser stats
    total_spent?: string;
    total_spent_change?: string;
    impressions?: string;
    impressions_change?: string;
  };
  user_role: "admin" | "screen_owner" | "advertiser";
}

export interface BookingsByStatus {
  status_counts: Record<string, number>;
}

export interface Activity {
  type: string;
  message: string;
  timestamp: string;
  booking_id: string;
}

export interface RecentActivities {
  activities: Activity[];
}

/**
 * Fetch dashboard statistics based on user role
 */
export const getDashboardStats = async (): Promise<DashboardStats> => {
  const token = getAuthToken();
  if (!token) {
    console.error("🔒 No authentication token found in cookies");
    throw new Error("No authentication token found");
  }

  const url = `${BASE_URL}/api/stats/dashboard`;
  console.log("🌐 Fetching dashboard stats from:", url);
  console.log("🔑 Token present:", token.substring(0, 20) + "...");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  console.log("📡 Response status:", response.status, response.statusText);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("❌ API Error Response:", errorText);
    throw new Error(`Failed to fetch dashboard stats: ${response.statusText}`);
  }

  const data = await response.json();
  console.log("✅ Dashboard stats received:", data);
  return data;
};

/**
 * Fetch booking counts grouped by status
 */
export const getBookingsByStatus = async (): Promise<BookingsByStatus> => {
  const token = getAuthToken();
  if (!token) {
    throw new Error("No authentication token found");
  }

  const response = await fetch(`${BASE_URL}/api/stats/bookings-by-status`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch bookings by status: ${response.statusText}`);
  }

  return response.json();
};

/**
 * Fetch recent activities/notifications for the user
 */
export const getRecentActivities = async (limit: number = 10): Promise<RecentActivities> => {
  const token = getAuthToken();
  if (!token) {
    throw new Error("No authentication token found");
  }

  const response = await fetch(`${BASE_URL}/api/stats/recent-activities?limit=${limit}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch recent activities: ${response.statusText}`);
  }

  return response.json();
};
