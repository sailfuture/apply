import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state for any admin sub-route transition (Dashboard →
 * Inquiries → Applications → etc.). The admin layout supplies the
 * top nav, so this boundary only needs to fill the content area.
 *
 * Most admin pages are tables or lists, so the placeholder is a
 * stack of horizontal bars that approximates that shape — eliminates
 * the white-flash that otherwise appears in the content area while
 * the next route's data fetches.
 */
export default function AdminLoading() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 mt-2" />
      </div>
      <div className="rounded-lg border bg-white p-2 space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
