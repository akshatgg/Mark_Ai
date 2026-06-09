"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useGoogleLogin } from "@react-oauth/google";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { Mail, Lock, Chrome, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { login, loginWithGoogle } from "@/services/authService";
import toast from "react-hot-toast";

interface LoginDialogProps {
  trigger?: React.ReactNode;
  triggerClassName?: string;
  onOpenChange?: (open: boolean) => void;
}

const LoginDialog = ({ trigger, triggerClassName, onOpenChange }: LoginDialogProps) => {
  const router = useRouter();
  const { login: authLogin } = useAuth();
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const formFields = useMemo(
    () => [
      {
        label: "Work Email",
        type: "email",
        icon: Mail,
        placeholder: "you@brand.com",
        field: "email",
      },
      {
        label: "Password",
        type: "password",
        icon: Lock,
        placeholder: "••••••••",
        field: "password",
      },
    ],
    [],
  );

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    onOpenChange?.(newOpen);
    if (!newOpen) {
      setError("");
      setFormData({ email: "", password: "" });
    }
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
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
      setOpen(false);
      onOpenChange?.(false);
      router.push("/dashboard");
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
        setOpen(false);
        onOpenChange?.(false);
        router.push("/dashboard");
      } catch (loginErr: any) {
        // User doesn't exist (404/401) or other error - redirect to signup
        toast("Redirecting to create account...", {
          icon: "ℹ️",
        });
        router.push(
          `/auth/signup?google=true&email=${encodeURIComponent(email)}&name=${encodeURIComponent(fullName)}&googleId=${encodeURIComponent(googleId)}`
        );
        setOpen(false);
        onOpenChange?.(false);
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button
            className={cn(
              "hidden md:block px-4 py-2 rounded-lg font-semibold text-base",
              "bg-white text-black border-2 border-white/30",
              "hover:scale-110 transition-all duration-200",
              "backdrop-blur-sm",
              triggerClassName
            )}
          >
            Login
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>
        <DialogHeader className="space-y-2 text-left">
          <DialogTitle className="text-2xl heading-font transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>Login to launch</DialogTitle>
          <DialogDescription className="transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
            Access your dashboard to start a campaign. New to Mark AI?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <form className="space-y-4" onSubmit={handleSubmit}>
            {formFields.map(({ label, type, icon: Icon, placeholder, field }) => (
              <div key={label} className="space-y-2">
                <label className="text-sm font-medium transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>{label}</label>
                <div className="relative">
                  <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 z-10 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }} />
                  {type === "password" ? (
                    <PasswordInput
                      placeholder={placeholder}
                      value={formData[field as keyof typeof formData]}
                      onChange={(e) => handleChange(field, e.target.value)}
                      className="pl-10 border transition-all duration-300"
                      style={{
                        backgroundColor: 'var(--bg-accent)',
                        borderColor: 'var(--border-primary)',
                        color: 'var(--text-primary)'
                      }}
                      required
                    />
                  ) : (
                    <Input
                      type={type}
                      placeholder={placeholder}
                      value={formData[field as keyof typeof formData]}
                      onChange={(e) => handleChange(field, e.target.value)}
                      className="pl-10 border transition-all duration-300"
                      style={{
                        backgroundColor: 'var(--bg-accent)',
                        borderColor: 'var(--border-primary)',
                        color: 'var(--text-primary)'
                      }}
                      required
                    />
                  )}
                </div>
              </div>
            ))}

            {error && (
              <p className="text-sm text-red-400">{error}</p>
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
              className="w-full font-semibold disabled:opacity-70 transition-all duration-300"
              style={{
                backgroundColor: 'var(--accent-purple)',
                color: '#ffffff'
              }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
            >
              {isSubmitting ? "Signing in..." : "Continue"}
            </Button>
          </form>

          <div className="relative text-center">
            <span className="px-3 text-xs uppercase tracking-[0.3em] transition-colors duration-300" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-tertiary)' }}>
              OR
            </span>
            <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px transition-colors duration-300" style={{ backgroundColor: 'var(--border-primary)' }} />
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => handleGoogleLogin()}
            disabled={isSubmitting}
            className="w-full border gap-2 disabled:opacity-70 transition-all duration-300"
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

          <div className="flex flex-wrap items-center justify-between text-sm pt-2 transition-colors duration-300" style={{ color: 'var(--text-tertiary)' }}>
            <span>Not a user yet?</span>
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-2 font-medium transition-colors duration-300"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-purple)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
            >
              <UserPlus className="w-4 h-4" />
              Create account
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LoginDialog;

