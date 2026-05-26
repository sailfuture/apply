import { LoadingScreen } from "@/components/loading-screen";

/**
 * Top-level loading boundary — Next.js renders this for any route
 * segment transition that doesn't have its own more-specific
 * `loading.tsx`. Used during the post-sign-in redirect chain from `/`
 * to the lifecycle-resolved destination (admin / welcome / apply /
 * registration / dashboard).
 *
 * The root `/` page does several server-side Xano queries + Clerk
 * metadata write before redirecting, so this can easily linger a few
 * seconds — cycling text reassures the user that work is happening.
 */
export default function RootLoading() {
  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4">
      <LoadingScreen
        messages={[
          "Loading your application...",
          "Getting things ready...",
          "Almost there...",
        ]}
      />
    </div>
  );
}
