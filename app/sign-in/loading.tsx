import { LoadingScreen } from "@/components/loading-screen";

/**
 * Loading boundary for `/sign-in` navigations (sign-out lands here via
 * `afterSignOutUrl`). Replaces the former top-level `app/loading.tsx`,
 * which had to go so the `/` resolver's `redirect()` reaches the
 * browser as a real 307 (see `app/(root)/page.tsx`).
 */
export default function SignInLoading() {
  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4">
      <LoadingScreen />
    </div>
  );
}
