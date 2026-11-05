import { LoadingScreen } from "@/components/loading-screen";

/**
 * Loading boundary for the onboarding segment (`/welcome`). This used
 * to be covered by a top-level `app/loading.tsx`, but that boundary
 * also wrapped the `/` resolver and turned its server `redirect()`
 * into a streamed client-side replay instead of an HTTP 307 (see
 * `app/(root)/page.tsx`), so segment-level boundaries replaced it.
 */
export default function OnboardingLoading() {
  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4">
      <LoadingScreen />
    </div>
  );
}
