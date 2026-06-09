"use client";
import LoginForm from "@/components/auth/LoginForm";
import AuthSidePanel from "@/components/auth/AuthSidePanel";

const LoginPage = () => {
  return (
    <div className="relative lg:h-screen lg:overflow-hidden transition-colors duration-300">
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 lg:h-screen">
        <AuthSidePanel
          eyebrow="Welcome back"
          title={<>Sign in to your campaign workspace.</>}
          subtitle="Pick up where you left off — manage bookings, monitor live screens, and ship new campaigns in minutes."
          bullets={[
            "Real-time impression & footfall analytics",
            "One dashboard for every active campaign",
            "Collaborate with your team and ours",
          ]}
        />

        <div
          className="flex flex-col px-6 pt-24 pb-6 lg:px-12 lg:pt-24 lg:pb-8 lg:justify-center lg:overflow-y-auto"
          style={{
            borderLeftColor: "var(--border-primary)",
            borderLeftWidth: "1px",
            borderLeftStyle: "solid",
          }}
        >
          <div className="mx-auto w-full max-w-md">
            <LoginForm />
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
