"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
    } catch (err: any) {
      const errorMessage = err.message || "Failed to send reset token";
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
    <div className="relative min-h-screen overflow-hidden transition-colors duration-300" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      {/* Theme-aware gradient backgrounds */}
      <div className="dark:block hidden absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(123,67,255,0.25),transparent_55%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(139,92,246,0.1),transparent)]" />
      </div>

      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-10">
        <div
          className="w-full max-w-md space-y-8 rounded-3xl p-10 backdrop-blur-3xl shadow-2xl transition-all duration-300"
          style={{
            borderColor: 'var(--border-primary)',
            borderWidth: '1px',
            borderStyle: 'solid',
            backgroundColor: 'var(--bg-primary)',
            boxShadow: '0 25px 50px -12px var(--shadow-lg)'
          }}
        >
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
            <p className="text-xs uppercase tracking-[0.35em] transition-colors duration-300" style={{ color: 'var(--accent-purple)', opacity: 0.8 }}>Reset Password</p>
            <div>
              <h1 className="heading-font text-3xl font-semibold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Forgot Password?</h1>
              <p className="mt-2 text-sm transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
                {success
                  ? "We've sent a password reset link to your email."
                  : "Enter your email address and we'll send you a link to reset your password."}
              </p>
            </div>
          </div>

          {!success ? (
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                  <Input
                    type="email"
                    placeholder="you@brand.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
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
                disabled={isSubmitting}
                className="w-full py-3 font-semibold transition-all duration-300 disabled:opacity-70"
                style={{
                  backgroundColor: 'var(--accent-blue)',
                  color: 'var(--text-inverse)'
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              >
                {isSubmitting ? "Sending..." : "Send Reset Link"}
              </Button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                <p className="text-sm text-green-400 text-center">
                  Check your email for the password reset link.
                </p>
              </div>
              <Button
                onClick={handleContinue}
                className="w-full py-3 font-semibold transition-all duration-300"
                style={{
                  backgroundColor: 'var(--accent-blue)',
                  color: 'var(--text-inverse)'
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              >
                Continue to Reset Password
              </Button>
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

export default ForgotPasswordPage;
