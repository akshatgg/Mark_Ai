import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import ConditionalFooter from "@/components/layout/ConditionalFooter";
import { GoogleOAuthProvider } from '@react-oauth/google';
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { HotToaster } from "@/components/ui/toaster";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Mark AI – Buy Outdoor Ads Globally",
    template: "%s | MarkAI",
  },
  description:
    "Buy outdoor ads globally from your browser. MarkAI is the modern Digital Out-of-Home (DOOH) advertising marketplace to discover screens, book instantly, and launch campaigns in minutes.",
  keywords: [
    "Digital Out of Home Advertising",
    "DOOH Marketplace",
    "Outdoor Advertising Platform",
    "Buy Outdoor Ads Online",
    "OOH Advertising",
    "Programmatic DOOH",
    "Digital Billboards",
    "Outdoor Media Buying",
    "Advertising Marketplace",
    "Screen Owners Platform",
    "Global Outdoor Advertising",
    "Instant Ad Booking",
    "MarkAI",
  ],
  authors: [{ name: "MarkAI" }],
  creator: "MarkAI",
  publisher: "MarkAI",
  metadataBase: new URL("https://mark-ai.tech"),

  openGraph: {
    title: "Mark AI - Meta for Outdoor Ads",
    description:
      "For brands and agencies in India. Plan, book, and track DOOH campaigns on one simple dashboard.",
    url: "https://mark-ai.tech",
    siteName: "MarkAI",
    images: [
      {
        url: "https://storage.googleapis.com/careers-crm-data/careers-data/Mark_AI_Logo_02_20260123_140835_d7399e6b.png",
        width: 1200,
        height: 630,
        alt: "MarkAI Digital Out-of-Home Advertising Marketplace",
      },
    ],
    locale: "en_US",
    type: "website",
  },

  twitter: {
    card: "summary_large_image",
    title: "MarkAI – Buy Outdoor Ads Globally",
    description:
      "For brands and agencies in India. Plan, book, and track DOOH campaigns on one simple dashboard.",
    images: [
      "https://storage.googleapis.com/careers-crm-data/careers-data/Mark_AI_Logo_02_20260123_140835_d7399e6b.png",
    ],
  },

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },

  category: "Advertising Technology",
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '388332365810-i1j7ihkm46e67rqirhcrgojsalfi60tr.apps.googleusercontent.com';
  return (
    <html lang="en">
      <body
        className={`${plusJakarta.variable} antialiased`}
      >
        <ThemeProvider>
          <GoogleOAuthProvider clientId={clientId}>
            <AuthProvider>
              <Navbar />
              <div>
                {children}
              </div>
              <ConditionalFooter />
              <HotToaster />
            </AuthProvider>
          </GoogleOAuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
