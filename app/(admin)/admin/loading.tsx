import { LoadingScreen } from "@/components/loading-screen";

/**
 * Loading boundary for any admin sub-route transition. The admin
 * layout supplies the top nav, so this only fills the content area
 * with the cycling-text loading screen.
 */
export default function AdminLoading() {
  return (
    <div className="flex min-h-[calc(100vh-12rem)] items-center justify-center px-4">
      <LoadingScreen
        messages={[
          "Loading admin...",
          "Fetching the latest data...",
          "Almost there...",
        ]}
      />
    </div>
  );
}
