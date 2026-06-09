import { BASE_URL, apiFetch, apiUpload } from "@/utils/apiClient";

export interface ScreenOwner {
  _id: string;
  email: string;
  full_name: string;
  business_name?: string;
  phone?: string;
  country?: string;
  state?: string;
  city?: string;
  website?: string;
  is_admin?: boolean;
  is_screen_owner?: boolean;
  is_advertiser?: boolean;
  is_active?: boolean;
  screen_id?: string;
}

export type PricingFrequency = "hourly" | "daily" | "weekly" | "fortnightly" | "monthly";

export interface FrequencyDiscount {
  hourly: number;
  daily: number;
  weekly: number;
  fortnightly: number;
  monthly: number;
}

export interface CalculatedRate {
  price: number;
  multiplier: number;
  discount_percent: number;
}

export interface CalculatedRates {
  hourly: CalculatedRate;
  daily: CalculatedRate;
  weekly: CalculatedRate;
  fortnightly: CalculatedRate;
  monthly: CalculatedRate;
}

export interface Screen {
  _id: string;
  venue_id?: string;
  venue_name?: string;
  screen_name?: string;
  cafe_name?: string;
  description?: string;
  screen_owner_id: string;
  screen_images?: string[];
  // Xibo CMS integration fields
  xibo_display_id?: number;
  xibo_display_group_id?: number;
  xibo_sync_data?: Record<string, any>;
  location?: {
    region?: string;
    state?: string;
    city?: string;
    zone_area?: string;
    locality?: string;
    street?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
    address?: {
      full_address?: string;
      pincode_primary?: string;
      pincode_alt?: string;
    };
    geolocation?: {
      latitude?: number | null;
      longitude?: number | null;
    };
  };
  technical_details?: {
    width?: number;
    height?: number;
    size?: string;
    orientation?: "landscape" | "portrait";
  };
  pricing?: {
    // Legacy fields (backward compatibility)
    price?: number;
    currency?: string;
    unit?: string;

    // New dynamic pricing fields
    base_hourly_rate?: number;
    frequency_discounts?: FrequencyDiscount;
    calculated_rates?: CalculatedRates;
  };
  display?: {
    variants?: Array<{
      name: string;
      dimensions: string;
      position: string;
      price_per_week: number;
    }>;
  };
  frequency_pricing?: Array<{
    plan_name: string;
    weeks: number;
    price: number;
    discount_percent: number;
  }>;
  campaign_insights?: {
    audience_type?: string;
    weekly_footfall?: number;
    average_dwell_min?: number;
    benefits?: string[];
    use_cases?: string[];
  };
  operational_info?: {
    operating_hours?: string;
    days_open?: string;
    avg_group_size?: string;
    spending_profile?: string;
    lead_time?: string;
    rating?: number;
    verified_reviews?: number;
    avg_daily_visitors?: string;
    screen_position?: string;
    environment?: string;
  };
  media_gallery?: Array<{
    type: string;
    url: string;
  }>;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateScreenOwnerData {
  email: string;
  full_name: string;
  password: string;
  business_name: string;
  phone: string;
  country: string;
  state: string;
  city: string;
  website?: string;
}

export interface CreateScreenData {
  screen_name: string;
  description: string;
  screen_owner_id: string;
  screen_images: string[];
  location: {
    street: string;
    city: string;
    country: string;
    latitude: number;
    longitude: number;
  };
  technical_details: {
    width: number;
    height: number;
    size: string;
    orientation: "landscape" | "portrait";
  };
  pricing: {
    // Legacy fields (backward compatibility)
    price?: number;
    currency?: string;
    unit?: string;

    // New dynamic pricing fields
    base_hourly_rate?: number;
    frequency_discounts?: FrequencyDiscount;
    calculated_rates?: CalculatedRates;
  };
  // Campaign insights
  campaign_insights?: {
    weekly_footfall?: number;
    benefits?: string[];
  };
  // Legacy fields for backward compatibility
  venue_id?: string;
  venue_name?: string;
  status?: string;
}

export interface ApiError {
  error: string;
}

export interface PaginationInfo {
  count: number;
  has_next: boolean;
  has_prev: boolean;
  limit: number;
  page: number;
  pages: number;
  skip: number;
  total: number;
}

export interface PaginatedResponse<T> {
  users?: T[];
  screens?: T[];
  count?: number; // Legacy support
  pagination?: PaginationInfo;
}

// Create Screen Owner
export const createScreenOwner = async (
  data: CreateScreenOwnerData
): Promise<{ message: string; user: ScreenOwner; token: string }> => {
  const response = await fetch(`${BASE_URL}/api/auth/register/screen-owner`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Failed to create screen owner");
  }

  return result;
};

// Get All Screen Owners (Admin)
export const getAllScreenOwners = async (
  limit: number = 20,
  skip: number = 0,
  search?: string
): Promise<PaginatedResponse<ScreenOwner>> => {
  const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
  return apiFetch<PaginatedResponse<ScreenOwner>>(
    `${BASE_URL}/api/auth/admin/users/screen-owners?limit=${limit}&skip=${skip}${searchParam}`,
    {
      method: "GET",
    }
  );
};

// Get All Normal Users/Advertisers (Admin)
export const getAllNormalUsers = async (
  limit: number = 100,
  skip: number = 0,
  search?: string
): Promise<PaginatedResponse<ScreenOwner>> => {
  const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
  return apiFetch<PaginatedResponse<ScreenOwner>>(
    `${BASE_URL}/api/auth/admin/users/normal?limit=${limit}&skip=${skip}${searchParam}`,
    {
      method: "GET",
    }
  );
};

// Update Screen Owner (Admin)
export const updateScreenOwner = async (
  userId: string,
  updateData: {
    full_name?: string;
    business_name?: string;
    phone?: string;
    country?: string;
    state?: string;
    city?: string;
    website?: string;
    is_active?: boolean;
  }
): Promise<{ message: string; user: ScreenOwner }> => {
  return apiFetch<{ message: string; user: ScreenOwner }>(
    `${BASE_URL}/api/auth/admin/users/screen-owners/${userId}`,
    {
      method: "PUT",
      body: JSON.stringify(updateData),
    }
  );
};

// Create Screen
export const createScreen = async (
  data: CreateScreenData
): Promise<Screen> => {
  return apiFetch<Screen>(`${BASE_URL}/api/screens`, {
    method: "POST",
    body: JSON.stringify(data),
  });
};

// Get Screen by ID
export const getScreenById = async (screenId: string): Promise<Screen> => {

  const response = await fetch(`${BASE_URL}/api/screens/${screenId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Failed to fetch screen");
  }

  // Handle response structure: { screen: {...} } or direct screen object
  return result.screen || result;
};

// Get Multiple Screens by IDs (Batch)
export const getScreensByIds = async (screenIds: string[]): Promise<Screen[]> => {
  if (!screenIds || screenIds.length === 0) {
    return [];
  }

  const response = await fetch(`${BASE_URL}/api/screens/batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ screen_ids: screenIds }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Failed to fetch screens");
  }

  return result.screens || [];
};

// Update Screen by ID
export const updateScreen = async (
  screenId: string,
  data: Partial<Screen>
): Promise<Screen> => {
  return apiFetch<Screen>(`${BASE_URL}/api/screens/${screenId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
};

// Delete Screen by ID
export const deleteScreen = async (screenId: string): Promise<void> => {
  await apiFetch<void>(`${BASE_URL}/api/screens/${screenId}`, {
    method: "DELETE",
  });
};

// Get All Screens (Admin)
export const getAllScreens = async (
  limit: number = 20,
  skip: number = 0,
  status?: string,
  hasXibo?: boolean,
  search?: string
): Promise<PaginatedResponse<Screen>> => {
  const statusParam = status ? `&status=${status}` : "";
  const xiboParam = hasXibo !== undefined ? `&has_xibo=${hasXibo}` : "";
  const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
  return apiFetch<PaginatedResponse<Screen>>(
    `${BASE_URL}/api/screens/admin/all?limit=${limit}&skip=${skip}${statusParam}${xiboParam}${searchParam}`,
    {
      method: "GET",
    }
  );
};

// Get Screens by Screen Owner ID
export const getScreensByOwnerId = async (
  ownerId: string,
  limit: number = 20,
  skip: number = 0,
  search?: string
): Promise<PaginatedResponse<Screen>> => {
  const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
  return apiFetch<PaginatedResponse<Screen>>(
    `${BASE_URL}/api/screens/owner/${ownerId}?limit=${limit}&skip=${skip}${searchParam}`,
    {
      method: "GET",
    }
  );
};

// Get All Public Screens (No authentication required)
export const getPublicScreens = async (
  limit: number = 20,
  skip: number = 0,
  status?: string,
  city?: string,
  search?: string
): Promise<PaginatedResponse<Screen>> => {
  const statusParam = status ? `&status=${status}` : "";
  const cityParam = city ? `&city=${encodeURIComponent(city)}` : "";
  const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
  const response = await fetch(
    `${BASE_URL}/api/screens?limit=${limit}&skip=${skip}${statusParam}${cityParam}${searchParam}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Failed to fetch screens");
  }

  return result;
};

// Upload Image to Google Cloud Storage
export const uploadScreenImage = async (
  file: File,
  folder: string = "screens"
): Promise<{ message: string; url: string; type: string }> => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("folder", folder);

  return apiUpload<{ message: string; url: string; type: string }>(
    `${BASE_URL}/api/screens/upload-image`,
    formData
  );
};

// Add Media to Screen Gallery
export const addMediaToScreen = async (
  screenId: string,
  media: { type: string; url: string }
): Promise<Screen> => {
  return apiFetch<Screen>(`${BASE_URL}/api/screens/${screenId}/media`, {
    method: "POST",
    body: JSON.stringify(media),
  });
};

// Assign Screen Owner to Screen (Admin only)
export const assignScreenOwner = async (
  screenId: string,
  screenOwnerId: string
): Promise<{ message: string; screen: Screen; new_owner: { user_id: string; email: string; name: string } }> => {
  return apiFetch<{ message: string; screen: Screen; new_owner: { user_id: string; email: string; name: string } }>(
    `${BASE_URL}/api/screens/admin/assign-owner`,
    {
      method: "POST",
      body: JSON.stringify({
        screen_id: screenId,
        screen_owner_id: screenOwnerId,
      }),
    }
  );
};

// Get All Screen Owners from Admin API (Admin only)
export const getScreenOwnersAdmin = async (): Promise<{
  screen_owners: Array<{
    user_id: string;
    email: string;
    name: string;
    is_screen_owner: boolean;
    is_admin: boolean;
    created_at: string | null;
  }>;
  total: number;
}> => {
  return apiFetch<{
    screen_owners: Array<{
      user_id: string;
      email: string;
      name: string;
      is_screen_owner: boolean;
      is_admin: boolean;
      created_at: string | null;
    }>;
    total: number;
  }>(`${BASE_URL}/api/screens/admin/screen-owners`, {
    method: "GET",
  });
};

// Make User a Screen Owner (Admin only)
export const makeUserScreenOwner = async (
  userId: string
): Promise<{ message: string; user: { user_id: string; email: string; name: string; is_screen_owner: boolean } }> => {
  return apiFetch<{ message: string; user: { user_id: string; email: string; name: string; is_screen_owner: boolean } }>(
    `${BASE_URL}/api/screens/admin/make-screen-owner/${userId}`,
    {
      method: "POST",
    }
  );
};

// Remove Screen Owner Role (Admin only)
export const removeScreenOwnerRole = async (
  userId: string
): Promise<{ message: string; user: { user_id: string; email: string; name: string; is_screen_owner: boolean } }> => {
  return apiFetch<{ message: string; user: { user_id: string; email: string; name: string; is_screen_owner: boolean } }>(
    `${BASE_URL}/api/screens/admin/remove-screen-owner/${userId}`,
    {
      method: "POST",
    }
  );
};

// Sync Screens from ScreenOX (Admin only)
export interface SyncScreenOXResponse {
  message: string;
  results: {
    created: number;
    updated: number;
    failed: number;
    total: number;
    display_group_ids: number[] | null;
    errors: string[];
  };
}

export const syncScreensFromScreenOX = async (
  displayGroupIds?: number[],
  screenOwnerId?: string
): Promise<SyncScreenOXResponse> => {
  const body: { display_group_ids?: number[]; screen_owner_id?: string } = {};
  if (displayGroupIds && displayGroupIds.length > 0) {
    body.display_group_ids = displayGroupIds;
  }
  if (screenOwnerId) {
    body.screen_owner_id = screenOwnerId;
  }

  return apiFetch<SyncScreenOXResponse>(
    `${BASE_URL}/api/screens/admin/sync-screenox`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
};

