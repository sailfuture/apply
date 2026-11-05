import { LoadingScreen } from "@/components/loading-screen";

/**
 * Loading boundary for parent-side route transitions (apply /
 * registration / re-apply / dashboard). Shares the parent-flow
 * message sequence with the sign-in, onboarding and page-level
 * loaders — the sessionStorage-backed `LoadingScreen` carries
 * progress across them so the text doesn't reset to "Loading..."
 * between back-to-back boundaries. The root `/` resolver deliberately
 * has no loading boundary (see `app/(root)/page.tsx`).
 */
export default function DashboardLoading() {
  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4 bg-gray-50">
      <LoadingScreen />
    </div>
  );
}
