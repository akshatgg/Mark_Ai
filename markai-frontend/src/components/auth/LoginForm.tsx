"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGoogleLogin } from "@react-oauth/google";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Chrome } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { login, loginWithGoogle } from "@/services/authService";
import toast from "react-hot-toast";

interface LoginFormProps {
  onSuccess?: () => void;
  showSignupLink?: boolean;
  className?: string;
}

const LoginForm = ({ onSuccess, showSignupLink = true, className }: LoginFormProps) => {
  const router = useRouter();
  const { login: authLogin } = useAuth();
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (field: string, value: string) => {
    setFormData((previous) => ({ ...previous, [field]: value }));
    setError("");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const response = await login(formData.email, formData.password);
      
      // Update auth context
      authLogin(response);

      toast.success("Login successful! Redirecting...");
      onSuccess?.();
      
      // Check for redirect parameter
      const urlParams = new URLSearchParams(window.location.search);
      const redirect = urlParams.get("redirect") || "/dashboard";
      router.push(redirect);
    } catch (err: any) {
      const errorMessage = err.message || "Invalid email or password";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleLoginSuccess = async (tokenResponse: any) => {
    setIsSubmitting(true);
    setError("");

    try {
      // Fetch user info from Google
      const userInfoResponse = await fetch(
        `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${tokenResponse.access_token}`
      );

      if (!userInfoResponse.ok) {
        throw new Error("Failed to fetch Google user info");
      }

      const googleUser = await userInfoResponse.json();

      const email = googleUser.email;
      const googleId = googleUser.sub;
      const fullName = googleUser.name || googleUser.given_name || "";

      if (!email || !googleId) {
        throw new Error("Failed to get required information from Google");
      }

      try {
        // Try to login with Google - check if user exists
        const response = await loginWithGoogle(email, googleId, fullName);

        // User exists, login successful
        authLogin(response);
        toast.success("Google login successful! Redirecting...");
        onSuccess?.();

        // Check for redirect parameter
        const urlParams = new URLSearchParams(window.location.search);
        const redirect = urlParams.get("redirect") || "/dashboard";
        router.push(redirect);
      } catch (loginErr: any) {
        // User doesn't exist (404/401) or other error - redirect to signup
        toast("Redirecting to create account...", {
          icon: "ℹ️",
        });
        router.push(
          `/auth/signup?google=true&email=${encodeURIComponent(email)}&name=${encodeURIComponent(fullName)}&googleId=${encodeURIComponent(googleId)}`
        );
      }
    } catch (err: any) {
      console.error("Google login error:", err);
      const errorMessage = err.message || "Google login failed. Please try again.";
      setError(errorMessage);
      toast.error(errorMessage);
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = useGoogleLogin({
    onSuccess: handleGoogleLoginSuccess,
    onError: () => {
      setError("Google login failed. Please try again.");
      setIsSubmitting(false);
    },
  });

  return (
    <div className={className}>
      <div className="space-y-3 text-center">
        <p className="text-xs uppercase tracking-[0.35em] font-semibold brand-gradient-text">Welcome Back</p>
        <div>
          <h1 className="heading-font text-3xl font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Login to Mark AI</h1>
          <p className="mt-3 text-sm transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>
            Access your campaigns, dashboards, and collaboration tools.
          </p>
        </div>
      </div>

      <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Work Email</Label>
          <Input
            type="email"
            placeholder="you@brand.com"
            value={formData.email}
            onChange={(event) => handleChange("email", event.target.value)}
            className="border py-3 transition-all duration-300"
            style={{
              backgroundColor: 'var(--bg-accent)',
              borderColor: 'var(--border-primary)',
              color: 'var(--text-primary)'
            }}
            required
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Password</Label>
          <PasswordInput
            placeholder="Enter your password"
            value={formData.password}
            onChange={(event) => handleChange("password", event.target.value)}
            className="border py-3 transition-all duration-300"
            style={{
              backgroundColor: 'var(--bg-accent)',
              borderColor: 'var(--border-primary)',
              color: 'var(--text-primary)'
            }}
            required
          />
        </div>

        {error && (
          <p className="text-sm text-red-400 text-center">{error}</p>
        )}

        <div className="flex items-center justify-between text-sm">
          <Link
            href="/auth/forgot-password"
            className="transition-colors duration-300"
            style={{ color: 'var(--accent-purple)' }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
          >
            Forgot password?
          </Link>
        </div>

        <Button
          type="submit"
          disabled={isSubmitting}
          className="brand-gradient-bg w-full rounded-full py-3 font-semibold transition-all duration-300 hover:scale-[1.02] hover:shadow-lg disabled:opacity-70"
        >
          {isSubmitting ? "Signing in..." : "Sign In"}
        </Button>
      </form>

      <div className="relative text-center my-5">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t transition-colors duration-300" style={{ borderColor: 'var(--border-primary)' }} />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="px-3 tracking-[0.3em] transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-tertiary)' }}>OR</span>
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={() => handleGoogleLogin()}
        disabled={isSubmitting}
        className="w-full border mb-3 gap-2 py-3 disabled:opacity-70 transition-all duration-300"
        style={{
          borderColor: 'var(--border-primary)',
          backgroundColor: 'transparent',
          color: 'var(--text-primary)'
        }}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-accent)'}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        <Chrome className="w-4 h-4" style={{ color: 'var(--accent-blue)' }} />
        Continue with Google
      </Button>

      {showSignupLink && (
        <div className="text-center text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
          <span>New to Mark AI?</span>{" "}
          <Link href="/auth/signup" className="font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }} onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-purple)'} onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-primary)'}>
            Create an account
          </Link>
        </div>
      )}
    </div>
  );
};

export default LoginForm;

