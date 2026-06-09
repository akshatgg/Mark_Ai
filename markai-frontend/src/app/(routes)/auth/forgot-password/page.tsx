"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import AuthSidePanel from "@/components/auth/AuthSidePanel";
import { forgotPassword } from "@/services/authService";
import toast from "react-hot-toast";

const ForgotPasswordPage = () => {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [resetToken, setResetToken] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    setSuccess(false);

    try {
      const response = await forgotPassword(email);
      setResetToken(response.token);
      setSuccess(true);
      toast.success("Password reset link sent to your email!");
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to send reset token";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleContinue = () => {
    if (resetToken) {
      router.push(`/auth/reset-password?token=${encodeURIComponent(resetToken)}`);
    }
  };

  return (
    <div className="relative lg:h-screen lg:overflow-hidden bg-base">
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 lg:h-screen">
        <AuthSidePanel
          eyebrow="Account recovery"
          title={<>Reset your password in two clicks.</>}
          subtitle="Enter the email tied to your Mark AI account — we'll send you a secure reset link, valid for 15 minutes."
          bullets={[
            "Secure, time-bound reset links",
            "We never store your password in plain text",
            "Need help? Email hello@mark-ai.tech",
          ]}
        />

        <div className="flex flex-col px-6 pt-24 pb-6 lg:px-12 lg:pt-24 lg:pb-8 lg:justify-center lg:overflow-y-auto border-l border-base">
          <div className="mx-auto w-full max-w-md">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] brand-gradient-text">
              Forgot Password
            </p>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-base">
              {success ? "Check your inbox" : "Reset your password"}
            </h1>
            <p className="mt-3 text-sm text-muted">
              {success
                ? "We've sent a password reset link to your email."
                : "Enter your email address and we'll send you a secure reset link."}
            </p>

            {!success ? (
              <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-base">Email address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-subtle" />
                    <Input
                      type="email"
                      placeholder="you@brand.com"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
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
                  disabled={isSubmitting}
                  className="brand-gradient-bg w-full rounded-full py-3 font-semibold transition-all duration-300 hover:scale-[1.02] hover:shadow-lg disabled:opacity-70"
                >
                  {isSubmitting ? "Sending…" : "Send reset link"}
                </Button>
              </form>
            ) : (
              <div className="mt-8 space-y-4">
                <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-center text-sm text-green-600 dark:text-green-400">
                  Check your email for the password reset link.
                </div>
                <Button
                  onClick={handleContinue}
                  className="brand-gradient-bg w-full rounded-full py-3 font-semibold transition-all duration-300 hover:scale-[1.02] hover:shadow-lg"
                >
                  Continue to reset password
                </Button>
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

export default ForgotPasswordPage;
