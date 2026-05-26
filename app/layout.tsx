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
              collide with the fixed bottom nav), bottom-right on xl+. */}
          <Toaster />
          <Analytics />
        </body>
      </html>
    </ClerkProvider>
  );
}
