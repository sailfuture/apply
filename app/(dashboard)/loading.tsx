import { LoadingScreen } from "@/components/loading-screen";

/**
 * Loading boundary for parent-side route transitions (apply /
 * registration / re-apply / dashboard). Shares the parent-flow
 * message sequence with the root and page-level loaders — the
 * sessionStorage-backed `LoadingScreen` carries progress across all
 * three so the text doesn't reset to "Loading..." between them.
 */
export default function DashboardLoading() {
  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4 bg-gray-50">
      <LoadingScreen />
    </div>
  );
}
