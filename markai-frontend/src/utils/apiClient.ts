import Cookies from "js-cookie";
import { apiUrl } from "@/utility/apiUrl";

const baseUrl = apiUrl || "";
export const BASE_URL = baseUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");

// Get auth token from cookies
export const getAuthToken = (): string | null => {
  if (typeof window === "undefined") return null;
  const cookies = document.cookie.split(";");
  const tokenCookie = cookies.find((cookie) => cookie.trim().startsWith("token="));
  return tokenCookie ? tokenCookie.split("=")[1] : null;
};

// Logout function - clears all auth cookies and redirects to login
const handleLogout = () => {
  if (typeof window === "undefined") return;

  // Clear all auth cookies
  Cookies.remove('user');
  Cookies.remove('fullUserData');
  Cookies.remove('token');

  // Redirect to login page
  window.location.href = '/auth/login';
};

// Centralized fetch wrapper with automatic 401 handling
export const apiFetch = async <T = any>(
  url: string,
  options: RequestInit = {}
): Promise<T> => {
  const token = getAuthToken();

  // Add authorization header if token exists
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Check for 401 Unauthorized - token expired or invalid
  if (response.status === 401) {
    handleLogout();
    throw new Error("Session expired. Please login again.");
  }

  const data = await response.json();

  // Check for 403 Forbidden - insufficient permissions (don't logout, just throw error)
  if (response.status === 403) {
    throw new Error(data.error || "Access denied. You don't have permission to perform this action.");
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }

  return data;
};

// For multipart/form-data requests (file uploads)
export const apiUpload = async <T = any>(
  url: string,
  formData: FormData
): Promise<T> => {
  const token = getAuthToken();

  const headers: HeadersInit = {};

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: formData,
  });

  // Check for 401 Unauthorized
  if (response.status === 401) {
    handleLogout();
    throw new Error("Session expired. Please login again.");
  }

  const data = await response.json();

  // Check for 403 Forbidden - insufficient permissions (don't logout, just throw error)
  if (response.status === 403) {
    throw new Error(data.error || "Access denied. You don't have permission to perform this action.");
  }

  if (!response.ok) {
    throw new Error(data.error || `Upload failed with status ${response.status}`);
  }

  return data;
};
