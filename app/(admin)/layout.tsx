"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminTopNav } from "@/components/admin-top-nav";
import { Skeleton } from "@/components/ui/skeleton";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

/**
 * Admin shell. Top horizontal nav (mirrors the parent dashboard's
 * `GlobalHeader` look) plus a centered content container below — same
 * layout pattern the rest of the app uses, so admins don't context-shift
 * to a sidebar paradigm just for this surface.
 *
 * Auth gate: hits `/api/admin/auth` on mount. Non-admins (or signed-out
 * users that slipped past the middleware) bounce to `/`. While the check
 * is in-flight we render skeletons so we don't flash protected content.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/auth")
      .then((r) => {
        if (!r.ok) throw new Error("Not admin");
        return r.json();
      })
      .then((data) => {
        setAdmin(data);
        setLoading(false);
      })
      .catch(() => {
        router.replace("/");
      });
  }, [router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminTopNav admin={admin} />
      <main className="mx-auto w-full max-w-7xl">{children}</main>
    </div>
  );
}
