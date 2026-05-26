import { LoadingScreen } from "@/components/loading-screen";

/**
 * Top-level loading boundary — Next.js renders this for any route
 * segment transition that doesn't have its own more-specific
 * `loading.tsx`. Used during the post-sign-in redirect chain from `/`
 * to the lifecycle-resolved destination (admin / welcome / apply /
 * registration / dashboard).
 *
 * Uses the shared parent-flow message sequence; sessionStorage
 * persistence in `LoadingScreen` keeps the cycling text progressing
 * across the back-to-back loading screens that fire during the chain
 * (this one → dashboard-segment loading → page-level SWR spinner).
 */
export default function RootLoading() {
  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4">
      <LoadingScreen />
    </div>
  );
}
