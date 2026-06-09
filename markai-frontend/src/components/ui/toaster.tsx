"use client"

import { Toaster } from "react-hot-toast"

export function HotToaster() {
  return (

    <Toaster
      position="top-center"
      reverseOrder={false}
      toastOptions={{
        duration: 4000,
        style: {
          background: "#111",
          color: "#fff",
          borderRadius: "16px",
          padding: "15px",
          fontSize: "16px",
          backdropFilter: "blur(10px) saturate(180%)",
          WebkitBackdropFilter: "blur(10px) saturate(180%)",
          border: "1px solid rgba(255, 255, 255, 0.2)",
          boxShadow: "0 4px 30px rgba(0, 0, 0, 0.1)",
        },
        success: {
          style: {
            background: "#111",
            color: "#fff",
            borderRadius: "16px",
            padding: "15px",
            fontSize: "16px",
            backdropFilter: "blur(10px) saturate(180%)",
            WebkitBackdropFilter: "blur(10px) saturate(180%)",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            boxShadow: "0 4px 30px rgba(0, 0, 0, 0.1)",
          },
        },
        error: {
          style: {
            background: "#111",
            color: "#fff",
            borderRadius: "16px",
            padding: "15px",
            fontSize: "16px",
            backdropFilter: "blur(10px) saturate(180%)",
            WebkitBackdropFilter: "blur(10px) saturate(180%)",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            boxShadow: "0 4px 30px rgba(0, 0, 0, 0.1)",
          },
        },
      }}
    />
  )
}

