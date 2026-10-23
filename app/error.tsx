"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Route-level error boundary for every page under the root layout.
 *
 * Until this existed, a server component that threw — the `/` sign-in
 * resolver when Clerk's Backend API or Xano hiccupped, for one — fell
 * through to Next's bare "Application error: a server-side exception
 * has occurred" page. For a parent that's a dead end: nothing tells
 * them a reload fixes it. `reset()` re-renders the failed segment in
 * place (for the `/` resolver that re-runs the lookups and redirects);
 * the reload button is the fallback for anything that survives it.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4">
      <Card className="max-w-md">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
            <TriangleAlert className="size-5 text-muted-foreground" />
          </div>
          <CardTitle>Something went wrong</CardTitle>
          <CardDescription>
            We couldn&apos;t load this page. This is usually temporary &mdash;
            try again, and if it keeps happening, reload the page or contact
            us at{" "}
            <a
              href="mailto:admissions@sailfuture.org"
              className="text-primary underline underline-offset-2"
            >
              admissions@sailfuture.org
            </a>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => reset()}>
            Try again
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.location.reload()}
          >
            Reload page
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
