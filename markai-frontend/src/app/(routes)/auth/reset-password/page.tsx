"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { resetPassword } from "@/services/authService";
import toast from "react-hot-toast";

const ResetPasswordForm = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const tokenParam = searchParams.get("token");
    if (tokenParam) {
      setToken(decodeURIComponent(tokenParam));
    } else {
      setError("Invalid or missing reset token");
    }
  }, [searchParams]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long");
      return;
    }

    if (!token) {
      setError("Invalid reset token");
      return;
    }

    setIsSubmitting(true);

    try {
      await resetPassword(token, password);
      setSuccess(true);
      toast.success("Password reset successfully! Redirecting to login...");
      setTimeout(() => {
        router.push("/auth/login");
      }, 2000);
    } catch (err: any) {
      const errorMessage = err.message || "Failed to reset password";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!token && !error) {
    return null; // Loading state
  }

  return (
    <div className="relative min-h-screen overflow-hidden transition-colors duration-300" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      {/* Theme-aware gradient backgrounds */}
      <div className="dark:block hidden absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(47,86,224,0.22),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(31,196,207,0.12),transparent_55%)]" />
      </div>

      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-10">
        <div className="glass-panel-strong w-full max-w-md space-y-8 rounded-3xl p-10 transition-all duration-300">
          <div className="space-y-4 text-center">
            <Link
              href="/auth/login"
              className="inline-flex items-center gap-2 transition-colors duration-300 mb-4"
              style={{ color: 'var(--text-tertiary)' }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-tertiary)'}
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Login
            </Link>
            <p className="text-xs uppercase tracking-[0.35em] font-semibold brand-gradient-text">Reset Password</p>
            <div>
              <h1 className="heading-font text-3xl font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Create New Password</h1>
              <p className="mt-2 text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                {success
                  ? "Password reset successfully! Redirecting to login..."
                  : "Enter your new password below."}
              </p>
            </div>
          </div>

          {!success ? (
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>New Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 z-10 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                  <PasswordInput
                    placeholder="Enter new password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError("");
                    }}
                    className="pl-10 border py-3 transition-all duration-300"
                    style={{
                      backgroundColor: 'var(--bg-accent)',
                      borderColor: 'var(--border-primary)',
                      color: 'var(--text-primary)'
                    }}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Confirm Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 z-10 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                  <PasswordInput
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setError("");
                    }}
                    className="pl-10 border py-3 transition-all duration-300"
                    style={{
                      backgroundColor: 'var(--bg-accent)',
                      borderColor: 'var(--border-primary)',
                      color: 'var(--text-primary)'
                    }}
                    required
                  />
                </div>
              </div>

              {error && <p className="text-sm text-red-400 text-center">{error}</p>}

              <Button
                type="submit"
                disabled={isSubmitting || !token}
                className="brand-gradient-bg w-full rounded-full py-3 font-semibold transition-all duration-300 hover:scale-[1.02] hover:shadow-lg disabled:opacity-70"
              >
                {isSubmitting ? "Resetting..." : "Reset Password"}
              </Button>
            </form>
          ) : (
            <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
              <p className="text-sm text-green-400 text-center">
                Your password has been reset successfully!
              </p>
            </div>
          )}

          <div className="text-center text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
            <span>Remember your password?</span>{" "}
            <Link href="/auth/login" className="font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }} onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-purple)'} onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-primary)'}>
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

const ResetPasswordPage = () => {
  return (
    <Suspense
      fallback={
        <div className="relative min-h-screen overflow-hidden flex items-center justify-center transition-colors duration-300" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <div className="text-center">
            <p className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>Loading...</p>
          </div>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
};

export default ResetPasswordPage;
