"use client";

import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WrenchIcon } from "lucide-react";
import { useOptionalApplicationFlow } from "@/contexts/application-flow-context";

/**
 * Shown when one or more SWR fetches give up after exhausting their
 * retry budget. SWR's global `errorRetryCount` is capped at 3 in
 * `<SWRProvider>` — after that we surface this card instead of letting
 * the spinner spin forever. Covers any persistent backend failure
 * (auth provider down, API outage, network blip) with a single
 * friendly message.
 */
export function ServiceUnavailable({ onRetry }: { onRetry?: () => void }) {
  // Inside the step layout the bottom bar would otherwise keep offering
  // "Complete <section>" underneath a card that says the page didn't
  // load. Hide it while the card is up and put it back as it was.
  const flow = useOptionalApplicationFlow();
  const setHideBottomBar = flow?.setHideBottomBar;
  const wasHidden = flow?.hideBottomBar ?? false;
  useEffect(() => {
    if (!setHideBottomBar) return;
    setHideBottomBar(true);
    return () => setHideBottomBar(wasHidden);
    // `wasHidden` is read once, at mount, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setHideBottomBar]);

  return (
    // Full-viewport by default, so the card sits where the loading
    // spinner was. Inside the step layout (side nav + bottom bar) that
    // height pushed the page past the viewport and left the card
    // floating beside the nav with the bottom bar cut off; the layout
    // sets `--svc-min-h` to a shorter block there.
    <div className="flex min-h-[var(--svc-min-h,calc(100vh-7.5rem))] items-center justify-center px-4">
      {/* `w-full` is load-bearing: the card is a flex item, and its
          header is a size container, which contributes no width of its
          own. Without it the card shrank to the "Try again" button and
          the text wrapped a word per line. */}
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
            <WrenchIcon className="size-5 text-muted-foreground" />
          </div>
          <CardTitle>This page didn&apos;t load</CardTitle>
          <CardDescription>
            Something went wrong on our end. Please try again. If it keeps
            happening, wait a few minutes and reload the page.
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
