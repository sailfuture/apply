"use client";

import { useEffect } from "react";
import { useApplicationFlow } from "@/contexts/application-flow-context";

export default function RegistrationPage() {
  const { setPageTitle, setHideBottomBar } = useApplicationFlow();

  useEffect(() => {
    setPageTitle("Registration");
    setHideBottomBar(true);
    return () => setHideBottomBar(false);
  }, [setPageTitle, setHideBottomBar]);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
      <div className="text-center xl:text-left">
        <h1 className="text-2xl font-semibold">Complete Registration</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Complete the final registration steps to confirm your student&apos;s seat.
        </p>
      </div>

      <div className="rounded-lg border px-6 py-12 text-center">
        <p className="text-muted-foreground text-sm">
          Registration form coming soon. Please complete the previous steps first.
        </p>
      </div>
    </div>
  );
}
