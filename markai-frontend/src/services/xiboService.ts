import { apiUrl, xiboUrl, XIBO_CLIENT_ID, XIBO_CLIENT_SECRET } from "@/utility/apiUrl";

// Use backend API for Xibo operations (recommended for security)
const BACKEND_API = apiUrl || "https://api.mark-ai.tech/api"
const XIBO_DIRECT_URL = xiboUrl || "https://saas.screenox.in";

// Types based on Xibo API
export interface XiboAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface XiboCampaign {
  campaignId: number;
  campaign: string;
  isLayoutSpecific: number;
  cyclePlaybackEnabled: number;
  playCount: number;
  type: string;
  startDt: string;
  endDt: string;
  totalDuration: number;
  layouts: Array<{
    layoutId: number;
    layout: string;
  }>;
}

export interface XiboDisplay {
  displayId: number;
  display: string;
  displayGroupId: number;
  description: string;
  licensed: number;
  loggedIn: number;
  lastAccessed: string;
  currentLayoutId: number;
  defaultLayoutId: number;
  latitude: number;
  longitude: number;
  clientAddress: string;
  mediaInventoryStatus: number;
  macAddress: string;
  screenShotRequested: number;
}

export interface XiboDisplayGroup {
  displayGroupId: number;
  displayGroup: string;
  description: string;
  isDisplaySpecific: number;
}

export interface XiboStats {
  statId: number;
  type: string;
  start: string;
  end: string;
  layoutId: number;
  displayId: number;
  mediaId: number;
  widgetId: number;
  count: number;
  duration: number;
  tag: string;
}

export interface XiboLayout {
  layoutId: number;
  layout: string;
  description: string;
  duration: number;
  status: number;
  width: number;
  height: number;
}

export interface XiboScheduleEvent {
  eventId: number;
  eventTypeId: number;
  campaignId?: number;
  commandId?: number;
  displayGroupIds: number[];
  dayPartId?: number;
  fromDt: string;
  toDt: string;
  isPriority: number;
  displayOrder: number;
  recurrenceType?: string;
  recurrenceDetail?: string;
}

export interface FeaturedScreen {
  id: number;
  name: string;
  description: string;
  location: {
    latitude: number | null;
    longitude: number | null;
    address: string;
  };
  status: {
    online: boolean;
    licensed: boolean;
    lastAccessed: string;
    mediaInventoryStatus: number;
  };
  technical: {
    macAddress: string;
    clientAddress: string;
    currentLayoutId: number;
    defaultLayoutId: number;
  };
  group: {
    id: number;
    name: string;
  };
  source: string;
}

export interface ApiError {
  error: string;
}

// ============ BACKEND API METHODS (Recommended) ============
// These methods use your backend as a proxy for Xibo API calls
// This is more secure as credentials are not exposed to the client

const makeBackendRequest = async <T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> => {
  const response = await fetch(`${BACKEND_API}/api/xibo${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `API error: ${response.status}`);
  }

  return data;
};

// ============ CONNECTION TEST ============

export const testConnection = async (): Promise<{ connected: boolean; server_time?: string; error?: string }> => {
  return makeBackendRequest("/test");
};

export const getCMSTime = async (): Promise<{ time: string }> => {
  return makeBackendRequest("/time");
};

// ============ DISPLAY ENDPOINTS ============

export const getDisplays = async (params?: Record<string, string>): Promise<{ displays: XiboDisplay[]; count: number }> => {
  const searchParams = params ? `?${new URLSearchParams(params)}` : "";
  return makeBackendRequest(`/displays${searchParams}`);
};

export const getDisplayById = async (displayId: number): Promise<XiboDisplay> => {
  return makeBackendRequest(`/displays/${displayId}`);
};

export const getDisplayStatus = async (displayId: number): Promise<{
  displayId: number;
  name: string;
  loggedIn: boolean;
  licensed: boolean;
  lastAccessed: string;
  mediaInventoryStatus: number;
  currentLayoutId: number;
}> => {
  return makeBackendRequest(`/displays/${displayId}/status`);
};

export const requestScreenshot = async (displayId: number, authToken: string): Promise<{ message: string }> => {
  return makeBackendRequest(`/displays/${displayId}/screenshot`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${authToken}`,
    },
  });
};

// ============ DISPLAY GROUPS ENDPOINTS ============

export const getDisplayGroups = async (): Promise<{ displayGroups: XiboDisplayGroup[]; count: number }> => {
  return makeBackendRequest("/display-groups");
};

// ============ CAMPAIGN ENDPOINTS ============

export const getCampaigns = async (params?: Record<string, string>): Promise<{ campaigns: XiboCampaign[]; count: number }> => {
  const searchParams = params ? `?${new URLSearchParams(params)}` : "";
  return makeBackendRequest(`/campaigns${searchParams}`);
};

export const getCampaignById = async (campaignId: number): Promise<XiboCampaign> => {
  return makeBackendRequest(`/campaigns/${campaignId}`);
};

export const createCampaign = async (
  data: {
    name: string;
    folderId?: number;
    cyclePlaybackEnabled?: number;
    playCount?: number;
  },
  authToken: string
): Promise<XiboCampaign> => {
  return makeBackendRequest("/campaigns", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${authToken}`,
    },
    body: JSON.stringify(data),
  });
};

export const updateCampaign = async (
  campaignId: number,
  data: Record<string, unknown>,
  authToken: string
): Promise<XiboCampaign> => {
  return makeBackendRequest(`/campaigns/${campaignId}`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${authToken}`,
    },
    body: JSON.stringify(data),
  });
};

export const deleteCampaign = async (campaignId: number, authToken: string): Promise<{ message: string }> => {
  return makeBackendRequest(`/campaigns/${campaignId}`, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${authToken}`,
    },
  });
};

export const assignLayoutToCampaign = async (
  campaignId: number,
  layoutId: number,
  authToken: string,
  displayOrder: number = 1
): Promise<unknown> => {
  return makeBackendRequest(`/campaigns/${campaignId}/assign-layout`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${authToken}`,
    },
    body: JSON.stringify({ layoutId, displayOrder }),
  });
};

// ============ LAYOUT ENDPOINTS ============

export const getLayouts = async (params?: Record<string, string>): Promise<{ layouts: XiboLayout[]; count: number }> => {
  const searchParams = params ? `?${new URLSearchParams(params)}` : "";
  return makeBackendRequest(`/layouts${searchParams}`);
};

export const getLayoutById = async (layoutId: number): Promise<XiboLayout> => {
  return makeBackendRequest(`/layouts/${layoutId}`);
};

// ============ SCHEDULE ENDPOINTS ============

export const getSchedules = async (params?: {
  displayGroupIds?: string;
  fromDt?: string;
  toDt?: string;
}): Promise<{ schedules: XiboScheduleEvent[]; count: number }> => {
  const searchParams = params ? `?${new URLSearchParams(params as Record<string, string>)}` : "";
  return makeBackendRequest(`/schedules${searchParams}`);
};

export const getScheduleByDisplay = async (
  displayGroupId: number,
  fromDt?: string,
  toDt?: string
): Promise<{ schedules: XiboScheduleEvent[]; count: number }> => {
  const params: Record<string, string> = {};
  if (fromDt) params.fromDt = fromDt;
  if (toDt) params.toDt = toDt;
  const searchParams = Object.keys(params).length ? `?${new URLSearchParams(params)}` : "";
  return makeBackendRequest(`/schedules/display/${displayGroupId}${searchParams}`);
};

export const getScheduleByDateRange = async (params: {
  displayId?: number;
  fromDt: string;
  toDt: string;
}): Promise<{ schedules: XiboScheduleEvent[]; count: number }> => {
  const searchParams: Record<string, string> = {
    fromDt: params.fromDt,
    toDt: params.toDt,
  };
  if (params.displayId) {
    searchParams.displayGroupIds = params.displayId.toString();
  }
  return makeBackendRequest(`/schedules?${new URLSearchParams(searchParams)}`);
};

// ============ SCHEDULE CREATION ENDPOINTS ============

export const createSchedule = async (
  scheduleData: {
    eventTypeId: number;
    campaignId?: number;
    layoutId?: number;
    displayGroupIds: number[];
    fromDt: string;
    toDt: string;
    isPriority?: number;
    displayOrder?: number;
    dayPartId?: number;
    recurrenceType?: string;
    recurrenceDetail?: string;
  },
  authToken: string
): Promise<XiboScheduleEvent> => {
  return makeBackendRequest("/schedules", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${authToken}`,
    },
    body: JSON.stringify(scheduleData),
  });
};

export const deleteSchedule = async (eventId: number, authToken: string): Promise<{ message: string }> => {
  return makeBackendRequest(`/schedules/${eventId}`, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${authToken}`,
    },
  });
};

// ============ STATISTICS ENDPOINTS ============

export const getStats = async (params: {
  fromDt?: string;
  toDt?: string;
  displayId?: number;
  layoutId?: number;
  mediaId?: number;
  type?: "layout" | "media" | "widget" | "event";
}): Promise<{ stats: XiboStats[]; count: number }> => {
  const searchParams = new URLSearchParams();
  if (params.fromDt) searchParams.append("fromDt", params.fromDt);
  if (params.toDt) searchParams.append("toDt", params.toDt);
  if (params.displayId) searchParams.append("displayId", params.displayId.toString());
  if (params.layoutId) searchParams.append("layoutId", params.layoutId.toString());
  if (params.mediaId) searchParams.append("mediaId", params.mediaId.toString());
  if (params.type) searchParams.append("type", params.type);

  return makeBackendRequest(`/stats?${searchParams.toString()}`);
};

export const getProofOfPlay = async (params: {
  fromDt: string;
  toDt: string;
  displayId?: number;
  layoutId?: number;
}): Promise<{ report: unknown[]; count: number }> => {
  const searchParams = new URLSearchParams({
    fromDt: params.fromDt,
    toDt: params.toDt,
  });
  if (params.displayId) searchParams.append("displayId", params.displayId.toString());
  if (params.layoutId) searchParams.append("layoutId", params.layoutId.toString());

  return makeBackendRequest(`/stats/proof-of-play?${searchParams.toString()}`);
};

export interface ExportStatsCount {
  [key: string]: any; // Allow for flexible response structure from ScreenOX
}

export const getExportStatsCount = async (params?: {
  fromDt?: string;
  toDt?: string;
  displayId?: number;
}): Promise<ExportStatsCount> => {
  const searchParams = new URLSearchParams();
  if (params?.fromDt) searchParams.append("fromDt", params.fromDt);
  if (params?.toDt) searchParams.append("toDt", params.toDt);
  if (params?.displayId) searchParams.append("displayId", params.displayId.toString());

  const queryString = searchParams.toString();
  return makeBackendRequest(`/stats/export-count${queryString ? `?${queryString}` : ""}`);
};

export interface DetailedStatRecord {
  id: number;
  type: "layout" | "media";
  displayId: number;
  display: string;
  layout: string;
  media: string | null;
  numberPlays: number;
  duration: number;
  start: string;
  end: string;
  layoutId: number;
  campaignId: number;
  widgetId: number;
  mediaId: number;
  scheduleId: number;
  tag: string | null;
  statDate: string;
  engagements: any[];
}

export const getDetailedStats = async (params: {
  fromDt: string;
  toDt: string;
  displayId?: number;
  layoutIds?: number[];
  start?: number;
  length?: number;
}): Promise<{ stats: DetailedStatRecord[]; count: number; fromDt: string; toDt: string; displayId?: number; layoutIds?: number[] }> => {
  const searchParams = new URLSearchParams({
    fromDt: params.fromDt,
    toDt: params.toDt,
  });
  if (params.displayId) searchParams.append("displayId", params.displayId.toString());
  if (params.layoutIds && params.layoutIds.length > 0) {
    params.layoutIds.forEach(id => searchParams.append("layoutId", id.toString()));
  }
  if (params.start !== undefined) searchParams.append("start", params.start.toString());
  if (params.length !== undefined) searchParams.append("length", params.length.toString());

  return makeBackendRequest(`/stats/detailed?${searchParams.toString()}`);
};

// ============ DATASET ENDPOINTS ============

export const getDataSets = async (): Promise<{ datasets: unknown[]; count: number }> => {
  return makeBackendRequest("/datasets");
};

// ============ FEATURED SCREENS (COMBINED DATA) ============

export const getFeaturedScreens = async (): Promise<{ screens: FeaturedScreen[]; count: number; source: string }> => {
  return makeBackendRequest("/featured-screens");
};

// ============ DIRECT XIBO API METHODS (Legacy/Fallback) ============
// These methods call Xibo API directly from the browser
// Only use these if backend API is not available

let accessToken: string | null = null;
let tokenExpiry: number | null = null;

export const authenticateDirect = async (): Promise<string> => {
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
    return accessToken;
  }

  if (!XIBO_CLIENT_ID || !XIBO_CLIENT_SECRET) {
    throw new Error("Xibo API credentials not configured");
  }

  const response = await fetch(`${XIBO_DIRECT_URL}/api/authorize/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: XIBO_CLIENT_ID,
      client_secret: XIBO_CLIENT_SECRET,
    }),
  });

  const data: XiboAuthResponse = await response.json();

  if (!response.ok) {
    throw new Error("Xibo authentication failed");
  }

  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;

  return accessToken;
};

const makeDirectRequest = async <T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> => {
  const token = await authenticateDirect();

  const response = await fetch(`${XIBO_DIRECT_URL}/api${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Xibo API error: ${response.status}`);
  }

  return data;
};

// Direct API calls (use only as fallback)
export const getDisplaysDirect = async (): Promise<XiboDisplay[]> => {
  return makeDirectRequest<XiboDisplay[]>("/display");
};

export const getCampaignsDirect = async (): Promise<XiboCampaign[]> => {
  return makeDirectRequest<XiboCampaign[]>("/campaign");
};

export const getLayoutsDirect = async (): Promise<XiboLayout[]> => {
  return makeDirectRequest<XiboLayout[]>("/layout");
};

export const getSchedulesDirect = async (): Promise<XiboScheduleEvent[]> => {
  return makeDirectRequest<XiboScheduleEvent[]>("/schedule");
};
