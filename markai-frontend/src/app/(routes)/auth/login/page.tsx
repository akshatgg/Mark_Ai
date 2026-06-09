"use client";
import LoginForm from "@/components/auth/LoginForm";

const LoginPage = () => {
  return (
    <div className="relative py-14 min-h-screen overflow-hidden transition-colors duration-300">
      {/* Grid pattern background */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[50px_50px]" />
      {/* Theme-aware gradient backgrounds - only visible in dark mode */}
      <div className="dark:block hidden absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(47,86,224,0.22),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(31,196,207,0.12),transparent_55%)]" />
      </div>

      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-10">
        <div className="glass-panel-strong w-full max-w-md space-y-8 rounded-3xl p-10 py-16 transition-all duration-300">
          <LoginForm />
        </div>
      </div>
    </div>
  );
};

export default LoginPage;