import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state for parent-side route transitions (apply / registration
 * / reapply / dashboard). Sits below the global header (which is
 * mounted by `<AppChrome>` in the root layout) so this only fills the
 * main content area.
 *
 * Eliminates the white-flash that used to appear between sign-in
 * landing on `/` and the destination apply / dashboard chrome rendering.
 */
export default function DashboardLoading() {
  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4 bg-gray-50">
      <div className="w-full max-w-2xl py-8">
        <div className="text-center mb-8">
          <Skeleton className="size-16 rounded-full mx-auto mb-4" />
          <Skeleton className="h-7 w-3/4 mx-auto" />
          <Skeleton className="h-4 w-2/3 mx-auto mt-3" />
        </div>
        <div className="rounded-xl bg-background p-1.5 shadow-sm border">
          <div className="overflow-hidden rounded-lg border">
            <div className="divide-y">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center px-4 py-4 gap-3">
                  <Skeleton className="size-8 rounded-full shrink-0" />
                  <Skeleton className="h-4 w-48 flex-1" />
                  <Skeleton className="size-7 rounded-md shrink-0" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
