import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { GlobalHeader } from "@/components/global-header";
import { GlobalFooter } from "@/components/global-footer";
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
          <GlobalHeader />
          <main className="pt-14 pb-16 min-h-screen">
            <TooltipProvider>{children}</TooltipProvider>
          </main>
          <GlobalFooter />
          {/* Position is responsive — top-center on mobile (so it doesn't
              collide with the fixed bottom nav), bottom-right on xl+. */}
          <Toaster />
        </body>
      </html>
    </ClerkProvider>
  );
}
