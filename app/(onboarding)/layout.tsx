"use client";

import { useAuth } from "@clerk/nextjs";

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
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      )}
    </div>
  );
}
