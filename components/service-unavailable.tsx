"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WrenchIcon } from "lucide-react";

/**
 * Shown when one or more SWR fetches give up after exhausting their
 * retry budget. SWR's global `errorRetryCount` is capped at 3 in
 * `<SWRProvider>` — after that we surface this card instead of letting
 * the spinner spin forever. Covers any persistent backend failure
 * (auth provider down, API outage, network blip) with a single
 * friendly message.
 */
export function ServiceUnavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4">
      <Card className="max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
            <WrenchIcon className="size-5 text-muted-foreground" />
          </div>
          <CardTitle>We&apos;re making improvements</CardTitle>
          <CardDescription>
            The dashboard isn&apos;t loading right now. Please check back in a few
            minutes — this usually clears up quickly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => {
              if (onRetry) onRetry();
              else window.location.reload();
            }}
          >
            Try again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
