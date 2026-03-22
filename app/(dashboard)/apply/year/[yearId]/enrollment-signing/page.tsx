"use client";

import { useEffect } from "react";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function EnrollmentSigningPage() {
  const { setPageTitle, setHideBottomBar } = useApplicationFlow();

  useEffect(() => {
    setPageTitle("Enrollment");
    setHideBottomBar(true);
    return () => setHideBottomBar(false);
  }, [setPageTitle, setHideBottomBar]);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
      <div className="text-center xl:text-left">
        <h1 className="text-2xl font-semibold">Enrollment Agreement</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Review and sign the enrollment agreement to confirm your student&apos;s seat for the upcoming school year.
        </p>
      </div>

      <div>
        <p className="text-sm text-muted-foreground mb-4">
          Your enrollment agreement is being prepared by the admissions team. You will be notified when it is ready for your signature.
        </p>
        <Button disabled>
          Sign Enrollment Agreement
        </Button>
      </div>
    </div>
  );
}
