import { apiUrl } from "@/utility/apiUrl";

// Ensure BASE_URL doesn't have trailing slash and doesn't include /api
const baseUrl = apiUrl || "";
const BASE_URL = baseUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");

export interface LoginResponse {
  message: string;
  token: string;
  user: {
    _id: string;
    email: string;
    full_name: string;
    business_name?: string;
    phone?: string;
    country?: string;
    state?: string;
    city?: string;
    website?: string;
    user_type?: string;
    is_admin?: boolean;
    is_screen_owner?: boolean;
    is_advertiser?: boolean;
  };
}

export interface RegisterResponse {
  message: string;
  token: string;
  user: {
    _id: string;
    email: string;
    full_name: string;
    is_admin?: boolean;
    is_screen_owner?: boolean;
    is_advertiser?: boolean;
    business_name?: string;
    phone?: string;
    country?: string;
    state?: string;
    city?: string;
    website?: string;
    user_type?: string;
  };
}

export interface SendOTPResponse {
  message: string;
  token: string;
}

export interface VerifyOTPResponse {
  message: string;
  email: string;
}

export interface ForgotPasswordResponse {
  message: string;
  token: string;
}

export interface ResetPasswordResponse {
  message: string;
}

export interface ApiError {
  error: string;
}

// Login with email and password
export const login = async (email: string, password: string): Promise<LoginResponse> => {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Login failed");
  }

  return data;
};

// Login with Google
export const loginWithGoogle = async (
  email: string,
  googleId: string,
  fullName: string
): Promise<LoginResponse> => {
  const response = await fetch(`${BASE_URL}/api/auth/login/google`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      google_id: googleId,
      full_name: fullName,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Google login failed");
  }

  return data;
};

// Register normal user (advertiser)
export const register = async (userData: {
  email: string;
  full_name: string;
  password: string;
  business_name: string;
  phone: string;
  country: string;
  state: string;
  city: string;
  website?: string;
  google_id?: string;
}): Promise<RegisterResponse> => {
  const response = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(userData),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Registration failed");
  }

  return data;
};

// Register screen owner
export const registerScreenOwner = async (userData: {
  email: string;
  full_name: string;
  password: string;
  business_name: string;
  phone: string;
  country: string;
  state: string;
  city: string;
  website?: string;
  screen_id: string;
}): Promise<RegisterResponse> => {
  const response = await fetch(`${BASE_URL}/api/auth/register/screen-owner`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(userData),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Screen owner registration failed");
  }

  return data;
};

// Send OTP to email
export const sendOTP = async (email: string): Promise<SendOTPResponse> => {
  const response = await fetch(`${BASE_URL}/api/auth/send-otp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to send OTP");
  }

  return data;
};

// Verify OTP
export const verifyOTP = async (token: string, otp: string): Promise<VerifyOTPResponse> => {
  const response = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token, otp }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "OTP verification failed");
  }

  return data;
};

// Forgot password (send reset token)
export const forgotPassword = async (email: string): Promise<ForgotPasswordResponse> => {
  const response = await fetch(`${BASE_URL}/api/auth/forgot-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to send reset token");
  }

  return data;
};

// Reset password
export const resetPassword = async (token: string, password: string): Promise<ResetPasswordResponse> => {
  const response = await fetch(`${BASE_URL}/api/auth/reset-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Password reset failed");
  }

  return data;
};

