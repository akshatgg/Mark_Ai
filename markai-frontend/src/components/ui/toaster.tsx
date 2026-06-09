"use client"

import { Toaster } from "react-hot-toast"

const baseStyle: React.CSSProperties = {
  // All colors sourced from theme.css via CSS variables
  background: "var(--toast-info-bg)",
  color: "var(--color-text-inverse)",
  borderRadius: "9999px",
  padding: "12px 20px",
  fontSize: "14px",
  fontWeight: 500,
  backdropFilter: "blur(12px) saturate(180%)",
  WebkitBackdropFilter: "blur(12px) saturate(180%)",
  border: "1px solid rgba(255, 255, 255, 0.15)",
  boxShadow: "var(--toast-shadow)",
}

export function HotToaster() {
  return (
    <Toaster
      position="top-center"
      reverseOrder={false}
      toastOptions={{
        duration: 4000,
        style: baseStyle,
        success: {
          style: {
            ...baseStyle,
            background: "var(--toast-success-bg)",
          },
          iconTheme: {
            primary: "#ffffff",
            // Razorpay/react-hot-toast icon theme accepts only hex strings; mirrors --brand-blue
            secondary: "#2f56e0",
          },
        },
        error: {
          style: {
            ...baseStyle,
            background: "var(--toast-error-bg)",
            boxShadow: "var(--toast-error-shadow)",
          },
          iconTheme: {
            primary: "#ffffff",
            // Mirrors --color-danger (#ef4444 in light theme)
            secondary: "#ef4444",
          },
        },
      }}
    />
  )
}
