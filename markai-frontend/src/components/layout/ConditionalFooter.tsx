"use client";
import { usePathname } from "next/navigation";
import Footer from "./Footer/Footer";

const ConditionalFooter = () => {
  const pathname = usePathname();

  // Hide footer on dashboard and auth routes
  if (pathname?.startsWith('/dashboard') || pathname?.startsWith('/auth')) {
    return null;
  }

  return <Footer />;
};

export default ConditionalFooter;

