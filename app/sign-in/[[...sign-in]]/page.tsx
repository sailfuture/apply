"use client";

import { SignIn } from "@clerk/nextjs";
import { useIsClient } from "@/hooks/use-is-client";

export default function Page() {
  const mounted = useIsClient();

  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center">
      {mounted && <SignIn />}
    </div>
  );
}
