"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import AuthSidePanel from "@/components/auth/AuthSidePanel";
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
    if (tokenParam) setToken(decodeURIComponent(tokenParam));
    else setError("Invalid or missing reset token");
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
      setTimeout(() => router.push("/auth/login"), 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reset password";
      setError(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!token && !error) return null;

  return (
    <div className="relative lg:h-screen lg:overflow-hidden bg-base">
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 lg:h-screen">
        <AuthSidePanel
          eyebrow="Account recovery"
          title={<>Create a new password.</>}
          subtitle="Pick a strong password — at least 6 characters. You'll be signed in to your campaign workspace right after."
          bullets={[
            "Encrypted at rest with industry-standard hashing",
            "Reset links expire after 15 minutes",
            "Need help? Email hello@mark-ai.tech",
          ]}
        />

        <div className="flex flex-col px-6 pt-24 pb-6 lg:px-12 lg:pt-24 lg:pb-8 lg:justify-center lg:overflow-y-auto border-l border-base">
          <div className="mx-auto w-full max-w-md">
            <Link
              href="/auth/login"
              className="mb-6 inline-flex items-center gap-2 text-sm text-subtle transition hover:text-base"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to login
            </Link>

            <p className="text-xs font-semibold uppercase tracking-[0.3em] brand-gradient-text">
              Reset Password
            </p>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-base">
              {success ? "Password updated" : "Create new password"}
            </h1>
            <p className="mt-3 text-sm text-muted">
              {success ? "Redirecting to login…" : "Enter your new password below."}
            </p>

            {!success ? (
              <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-base">New password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 z-10 h-4 w-4 text-subtle" />
                    <PasswordInput
                      placeholder="Enter new password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setError("");
                      }}
                      className="border-base bg-base pl-10 py-3 text-base placeholder:text-faint"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-base">Confirm password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 z-10 h-4 w-4 text-subtle" />
                    <PasswordInput
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        setError("");
                      }}
                      className="border-base bg-base pl-10 py-3 text-base placeholder:text-faint"
                      required
                    />
                  </div>
                </div>

                {error && <p className="text-sm text-red-500">{error}</p>}

                <Button
                  type="submit"
                  disabled={isSubmitting || !token}
                  className="brand-gradient-bg w-full rounded-full py-3 font-semibold transition-all duration-300 hover:scale-[1.02] hover:shadow-lg disabled:opacity-70"
                >
                  {isSubmitting ? "Resetting…" : "Reset password"}
                </Button>
              </form>
            ) : (
              <div className="mt-8 rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-center text-sm text-green-600 dark:text-green-400">
                Your password has been reset successfully!
              </div>
            )}

            <div className="mt-8 text-center text-sm text-subtle">
              <span>Remember your password?</span>{" "}
              <Link href="/auth/login" className="font-semibold text-base transition hover:opacity-80">
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ResetPasswordPage = () => (
  <Suspense
    fallback={
      <div className="flex min-h-screen items-center justify-center bg-base">
        <p className="text-sm text-subtle">Loading…</p>
      </div>
    }
  >
    <ResetPasswordForm />
  </Suspense>
);

export default ResetPasswordPage;
