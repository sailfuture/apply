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
        <div className="flex min-h-[40vh] items-center justify-center">
          <LoadingScreen />
        </div>
      )}
    </div>
  );
}
