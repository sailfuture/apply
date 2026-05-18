import { Spinner } from "@/components/ui/spinner";

/**
 * Top-level loading boundary — Next.js renders this for any route
 * segment transition that doesn't have its own more-specific
 * `loading.tsx`. Used during the post-sign-in redirect chain from `/`
 * to the lifecycle-resolved destination (admin / welcome / apply /
 * registration / dashboard).
 *
 * Single centered spinner — no skeleton chrome. Skeletons committed
 * to a layout shape that doesn't match the destination, so they read
 * as a second layout flash before the real page renders. A bare
 * spinner says "working" without misleading the user about what's
 * about to appear.
 */
export default function RootLoading() {
  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4">
      <Spinner className="size-8 text-muted-foreground" />
    </div>
  );
}
