import { RAZORPAY_KEY_ID } from "@/utility/apiUrl";
import Cookies from "js-cookie";

// Use Next.js API routes for payment processing
const API_BASE = "/api/payments";

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

export interface CreateOrderResponse {
  orderId: string;
  amount: number;
  currency: string;
  key: string;
  bookingId?: string;
}

export interface PaymentSuccessData {
  orderId: string;
  paymentId: string;
  signature: string;
  bookingId?: string;
  authToken?: string;
}

// Helper to get auth token from cookies (where AuthContext stores it)
const getAuthToken = (): string | null => {
  if (typeof window !== "undefined") {
    // Get from cookies (AuthContext uses js-cookie with key "token")
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'token') {
        return decodeURIComponent(value);
      }
    }
    // Fallback to localStorage
    return localStorage.getItem("auth_token") || localStorage.getItem("token");
  }
  return null;
};

// Create payment order (server-side via Next.js API route)
export const createPaymentOrder = async (
  amount: number,
  currency: string = "INR",
  screenId: string,
  campaignData: any
): Promise<CreateOrderResponse> => {
  // Convert to paise (Razorpay expects amount in smallest currency unit)
  const amountInPaise = Math.round(amount * 100);
  const authToken = getAuthToken();

  const response = await fetch(`${API_BASE}/create-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountInPaise,
      currency,
      screenId,
      campaignData,
      authToken,
    }),
  });

  // Check for 401 Unauthorized - token expired
  if (response.status === 401) {
    handleLogout();
    throw new Error("Session expired. Please login again.");
  }

  // Check for 403 Forbidden
  if (response.status === 403) {
    handleLogout();
    throw new Error("Access denied. Please login again.");
  }

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Failed to create payment order");
  }

  // Store bookingId for later use in verification
  if (result.bookingId && typeof window !== "undefined") {
    sessionStorage.setItem("current_booking_id", result.bookingId);
  }

  return {
    orderId: result.orderId || result.id,
    amount: result.amount,
    currency: result.currency,
    key: result.key || RAZORPAY_KEY_ID || "",
    bookingId: result.bookingId,
  };
};

// Verify payment (server-side via Next.js API route)
export const verifyPayment = async (
  paymentData: PaymentSuccessData
): Promise<{ success: boolean; message: string; scheduled?: boolean }> => {
  try {
    // Get bookingId from sessionStorage if not provided
    let bookingId = paymentData.bookingId;
    if (!bookingId && typeof window !== "undefined") {
      bookingId = sessionStorage.getItem("current_booking_id") || undefined;
    }

    const authToken = paymentData.authToken || getAuthToken();

    const response = await fetch(`${API_BASE}/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...paymentData,
        bookingId,
        authToken,
      }),
    });

    // Check for 401 Unauthorized - token expired
    if (response.status === 401) {
      handleLogout();
      throw new Error("Session expired. Please login again.");
    }

    // Check for 403 Forbidden
    if (response.status === 403) {
      handleLogout();
      throw new Error("Access denied. Please login again.");
    }

    // Parse JSON response (can only be done once)
    let result: any;
    try {
      result = await response.json();
    } catch (parseError) {
      console.error("Failed to parse JSON response:", parseError);
      throw new Error("Invalid response from payment verification server");
    }

    // Check if response is ok
    if (!response.ok) {
      const errorMessage = result?.error || result?.message || response.statusText || "Payment verification failed";
      throw new Error(errorMessage);
    }

    // Validate result structure
    if (!result || typeof result !== 'object') {
      console.error("Invalid response structure:", result);
      throw new Error("Invalid response format from payment verification server");
    }

    // Clear stored bookingId after successful verification
    if (result.success && typeof window !== "undefined") {
      sessionStorage.removeItem("current_booking_id");
    }

    // Return structured result
    return {
      success: result.success === true,
      message: result.message || (result.success === true ? "Payment verified successfully" : "Payment verification failed"),
      scheduled: result.scheduled || false,
    };
  } catch (error: any) {
    console.error("Payment verification error in service:", error);
    // Re-throw with better error message
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(error?.message || "Failed to verify payment");
  }
};

