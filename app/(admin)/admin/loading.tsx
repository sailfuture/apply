import { Spinner } from "@/components/ui/spinner";

/**
 * Loading boundary for any admin sub-route transition. The admin
 * layout supplies the top nav, so this only fills the content area
 * with a centered spinner. Matches the parent-side loading pattern.
 */
export default function AdminLoading() {
  return (
    <div className="flex min-h-[calc(100vh-12rem)] items-center justify-center px-4">
      <Spinner className="size-8 text-muted-foreground" />
    </div>
  );
}
