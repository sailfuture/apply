"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminTopNav } from "@/components/admin-top-nav";

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

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminTopNav admin={admin} />
      {/* `pt-14` reserves the 56px slot for the now-`fixed` top nav so
          the first page section doesn't tuck under the bar. See the
          comment on `AdminTopNav` for why the nav is fixed instead of
          sticky. */}
      <main className="mx-auto w-full max-w-7xl pt-14">{children}</main>
    </div>
  );
}
