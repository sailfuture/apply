"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminTopNav } from "@/components/admin-top-nav";
import { PastYearBanner } from "@/components/admin/past-year-banner";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

/**
 * Admin shell. Top horizontal nav (mirrors the parent dashboard's
 * `GlobalHeader` look) plus a centered content container below.
 *
 * Auth gate: hits `/api/admin/auth` on mount. Non-admins (or signed-out
 * users that slipped past the middleware) bounce to `/`. We render the
 * chrome + page contents IMMEDIATELY rather than blanking the screen
 * with a centered skeleton during the in-flight check — that blank
 * frame between sign-in landing and chrome appearing was the "flash"
 * the user saw on every initial admin navigation. Page-level data
 * fetches go through admin-gated `/api/admin/*` endpoints which return
 * 401/403 to non-admins, so any brief mount before the auth-check
 * redirect can't leak data; it just shows empty SWR states until the
 * `router.replace("/")` resolves.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminUser | null>(null);

  useEffect(() => {
    fetch("/api/admin/auth")
      .then((r) => {
        if (!r.ok) throw new Error("Not admin");
        return r.json();
      })
      .then((data) => setAdmin(data))
      .catch(() => router.replace("/"));
  }, [router]);

  // `AdminTopNav` and `PastYearBanner` both read `useSearchParams()`,
  // which bails the static prerender out to client rendering up to the
  // nearest Suspense boundary — and the build fails if there is none.
  // The top-level `app/loading.tsx` used to be that boundary for this
  // whole layout (every `/admin/*` page prerendered as a full-page
  // spinner). It was removed so the `/` resolver can answer with a real
  // 307 (see `app/(root)/page.tsx`), so the two consumers get their own
  // boundaries here; `admin/loading.tsx` still covers the page area.
  // The nav fallback is the same fixed bar, empty, so the `pt-14` slot
  // below stays filled until the real nav renders on the client.
  return (
    <div className="min-h-screen bg-gray-50">
      <Suspense
        fallback={
          <header className="fixed inset-x-0 top-0 z-50 h-14 border-b bg-white" />
        }
      >
        <AdminTopNav admin={admin} />
      </Suspense>
      {/* `pt-14` reserves the 56px slot for the now-`fixed` top nav so
          the first page section doesn't tuck under the bar. See the
          comment on `AdminTopNav` for why the nav is fixed instead of
          sticky. The past-year banner sits inside the padded flow (not
          the fixed bar) so it pushes content down when present and
          sticks just under the nav while scrolling. */}
      <div className="pt-14">
        <Suspense fallback={null}>
          <PastYearBanner />
        </Suspense>
        <main className="mx-auto w-full max-w-7xl">{children}</main>
      </div>
    </div>
  );
}
