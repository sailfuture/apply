import { Skeleton } from "@/components/ui/skeleton";

/**
 * Top-level loading boundary — Next.js renders this for any route
 * segment transition that doesn't have its own more-specific
 * `loading.tsx`. Without this, the app shows a blank screen during
 * server-component data fetches (the `/` redirect chain after sign-in
 * was the worst offender — a full white frame between Clerk landing
 * the user and the destination chrome appearing).
 *
 * Intentionally minimal: a single soft skeleton block centered in the
 * viewport. It doesn't try to mimic any specific page chrome — that
 * would just trade one flash for another (skeleton chrome → real
 * chrome). Showing a content-sized placeholder reads as "we're
 * working" without committing to a layout shape.
 */
export default function RootLoading() {
  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4">
      <div className="w-full max-w-2xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}
