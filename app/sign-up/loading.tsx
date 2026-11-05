import { LoadingScreen } from "@/components/loading-screen";

/**
 * Loading boundary for `/sign-up` navigations. Same reason as
 * `app/sign-in/loading.tsx`: the former top-level `app/loading.tsx`
 * had to go so the `/` resolver's `redirect()` reaches the browser as
 * a real 307 (see `app/(root)/page.tsx`).
 */
export default function SignUpLoading() {
  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] items-center justify-center px-4">
      <LoadingScreen />
    </div>
  );
}
