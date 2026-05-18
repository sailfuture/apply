import { Spinner } from "@/components/ui/spinner";

/**
 * Loading boundary for parent-side route transitions (apply /
 * registration / re-apply / dashboard). Centered spinner — no
 * skeleton chrome. See the root `app/loading.tsx` for the rationale
 * (skeletons read as a layout flash before the real page renders).
 */
export default function DashboardLoading() {
  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4 bg-gray-50">
      <Spinner className="size-8 text-muted-foreground" />
    </div>
  );
}
