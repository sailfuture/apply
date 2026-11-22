import { LoadingScreen } from "@/components/loading-screen";

/**
 * Backdrop for the `/` resolver (see `page.tsx` in this group).
 *
 * `/` only ever redirects. On a document load that is a real 307 and
 * nothing here is seen. But a CLIENT arrival — Clerk's push after
 * sign-in, the welcome form's `router.replace("/")`, the dashboard's
 * fallback — receives the redirect inside the RSC payload, and while
 * the router replays it the page has nothing to draw: the screen went
 * blank between the sign-in card and the destination's loader.
 *
 * This layout paints the shared loader BEHIND the page, in the same
 * spot the destination's own loader uses, so the sequence reads as one
 * continuous spinner (the loader carries its message sequence across
 * mounts). The page's one real render — the "no enrollment period"
 * message — sits on an opaque block and covers it.
 *
 * This is a layout, not a `loading.tsx`: a `loading.tsx` is a Suspense
 * boundary and would turn the document-load 307 back into a streamed
 * client redirect. Keep it that way.
 */
export default function RootResolverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute inset-0 flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4"
      >
        <LoadingScreen />
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}
