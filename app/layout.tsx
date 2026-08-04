import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Analytics } from "@vercel/analytics/next";
import { Toaster } from "@/components/ui/sonner";
import { AppChrome } from "@/components/app-chrome";
import { SWRProvider } from "./swr-provider";
import "./globals.css";
import { cn } from "@/lib/utils";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SFA Registration",
  description: "SailFuture Academy Registration Portal",
  // Home-screen install support. `appleWebApp` is what makes iOS open
  // the site chrome-less once added to the home screen — and a
  // home-screen install is the only context where iOS exposes web
  // notifications at all (Safari tabs never do).
  appleWebApp: {
    capable: true,
    title: "SFA Admin",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/logo.svg",
    apple: "/logo.jpg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className={cn("font-sans", geistSans.variable)}>
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50`}
        >
          <SWRProvider>
            <AppChrome>{children}</AppChrome>
          </SWRProvider>
          {/* Position is responsive — top-center on mobile (so it doesn't
              collide with the fixed bottom nav), bottom-LEFT on xl+ so
              toasts clear the right-hand sheets. */}
          <Toaster />
          <Analytics />
        </body>
      </html>
    </ClerkProvider>
  );
}
