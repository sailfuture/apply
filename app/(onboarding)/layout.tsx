"use client";

import { useAuth } from "@clerk/nextjs";
import { LoadingScreen } from "@/components/loading-screen";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoaded } = useAuth();

  return (
    <div className="min-h-[calc(100vh-7.5rem)] bg-background">
      {isLoaded ? (
        children
      ) : (
        // Same box as every other parent loader, so the spinner doesn't
        // jump when this hands off to the page's own (it used to sit
        // near the top of the screen here and mid-screen everywhere
        // else).
        <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4">
          <LoadingScreen />
        </div>
      )}
    </div>
  );
}
