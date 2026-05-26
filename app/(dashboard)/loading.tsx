import { LoadingScreen } from "@/components/loading-screen";

/**
 * Loading boundary for parent-side route transitions (apply /
 * registration / re-apply / dashboard). Renders the cycling-text
 * loading screen so the wait — which can include initial Xano fetches
 * — doesn't read as a stall.
 */
export default function DashboardLoading() {
  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4 bg-gray-50">
      <LoadingScreen
        messages={[
          "Loading your application...",
          "Collecting your details...",
          "Almost there...",
        ]}
      />
    </div>
  );
}
