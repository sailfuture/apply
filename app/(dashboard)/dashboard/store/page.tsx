"use client";

/* eslint-disable @next/next/no-img-element -- product images come
   from Stripe's CDN with unknown dimensions; next/image would need
   remotePatterns config for files.stripe.com for no real gain at
   this scale. */

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { useUser } from "@clerk/nextjs";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Laptop,
  ShoppingBag,
} from "lucide-react";
import { DashboardPageHeader } from "@/components/dashboard-page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetcher, useFamily } from "@/hooks/use-api";
import { formatPriceCents, storeCheckoutUrl } from "@/lib/store";

interface StoreItem {
  id: number;
  name: string;
  description: string;
  price_cents: number;
  payment_link_url: string;
  image_url: string;
}

interface StoreOrder {
  id: number;
  item: string;
  quantity: number;
  total_amount_cents: number;
  paid_at: number;
  distributed: boolean;
  distributed_at: number | null;
}

interface StudentLaptop {
  id: number;
  student_name: string;
  make_model: string;
  serial_number: string;
  asset_tag: string;
  assigned_date: string;
}

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "YYYY-MM-DD" → "Aug 6, 2026" without the UTC off-by-one. */
function fmtIsoDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Parent School Store page — the catalog (Stripe Payment Link
 * checkout, product image + price pulled live from Stripe), the
 * family's full purchase history with hand-out status, and any school
 * laptops assigned to their students.
 */
export default function StorePage() {
  const searchParams = useSearchParams();
  const yearIdParam = searchParams.get("yearId");
  const yearId = yearIdParam ? Number(yearIdParam) : null;
  const dashboardHref = yearId ? `/dashboard?yearId=${yearId}` : "/dashboard";

  const { user } = useUser();
  const { data: familyData } = useFamily();
  const familyId =
    (familyData as { id?: number } | null | undefined)?.id ?? null;
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  const { data: items } = useSWR<StoreItem[]>("/api/store/items", apiFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });
  const { data: orders } = useSWR<StoreOrder[]>(
    "/api/store/orders",
    apiFetcher,
    { revalidateOnFocus: true, dedupingInterval: 10000 }
  );
  const { data: laptops } = useSWR<StudentLaptop[]>(
    "/api/laptops",
    apiFetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );

  const summary = useMemo(() => {
    const list = orders ?? [];
    return {
      count: list.length,
      awaiting: list.filter((o) => !o.distributed).length,
    };
  }, [orders]);

  const loading = !items || !orders || !familyData;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
      <DashboardPageHeader
        backHref={dashboardHref}
        backLabel="Back to Dashboard"
        breadcrumb={[
          { label: "Dashboard", href: dashboardHref },
          { label: "School Store" },
        ]}
        title="School Store"
        subtitle="Purchase uniforms and other school items, track pickup on past orders, and see the school devices assigned to your students. Payments are processed securely by Stripe."
      />

      {loading ? (
        <StoreSkeleton />
      ) : (
        <>
          {/* ── Catalog ── */}
          {items.length > 0 ? (
            <div>
              <h2 className="text-sm font-semibold mb-3">Available items</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex gap-4 rounded-xl border bg-white p-4 shadow-sm"
                  >
                    {/* Product image from Stripe; icon fallback. */}
                    <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.name}
                          className="size-full object-cover"
                        />
                      ) : (
                        <ShoppingBag className="size-7 text-muted-foreground/60" />
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <p className="text-sm font-semibold">
                        {item.name}
                        <span className="ml-2 font-normal text-muted-foreground">
                          {formatPriceCents(item.price_cents)}
                        </span>
                      </p>
                      {item.description.trim() ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {item.description}
                        </p>
                      ) : null}
                      <div className="mt-auto pt-2">
                        <Button
                          asChild
                          size="sm"
                          variant="outline"
                          className="bg-white"
                          disabled={familyId === null}
                        >
                          <a
                            href={
                              familyId !== null
                                ? storeCheckoutUrl(
                                    item.payment_link_url,
                                    familyId,
                                    yearId,
                                    email
                                  )
                                : undefined
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Purchase
                            <ExternalLink className="size-3.5 ml-1.5" />
                          </a>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* ── Purchases ── */}
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-sm font-semibold">Your purchases</h2>
              {summary.count > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {summary.awaiting > 0
                    ? `${summary.awaiting} awaiting pickup`
                    : "All items picked up"}
                </p>
              ) : null}
            </div>
            <div className="rounded-xl bg-background p-1.5 shadow-sm border">
              <div className="overflow-hidden rounded-lg border bg-white">
                {summary.count === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No purchases yet — items you buy above will appear here
                    with their pickup status.
                  </p>
                ) : (
                  <Table className="text-sm">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="px-4 py-2">Date</TableHead>
                        <TableHead className="px-4 py-2">Item</TableHead>
                        <TableHead className="px-4 py-2 text-right whitespace-nowrap">
                          Amount
                        </TableHead>
                        <TableHead className="px-4 py-2 text-right whitespace-nowrap">
                          Status
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(orders ?? []).map((o) => (
                        <TableRow key={o.id} className="hover:bg-transparent">
                          <TableCell className="px-4 py-3 whitespace-nowrap tabular-nums">
                            {fmtDate(o.paid_at)}
                          </TableCell>
                          <TableCell className="px-4 py-3 font-medium">
                            {o.item}
                          </TableCell>
                          <TableCell className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                            ${((o.total_amount_cents ?? 0) / 100).toFixed(2)}
                          </TableCell>
                          <TableCell className="px-4 py-3 text-right whitespace-nowrap">
                            {o.distributed ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                                <CheckCircle2 className="size-3.5" />
                                Delivered
                                {o.distributed_at
                                  ? ` · ${fmtDate(o.distributed_at)}`
                                  : ""}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
                                <Clock className="size-3.5" />
                                Paid — awaiting pickup
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          </div>

          {/* ── Assigned laptops ── */}
          {laptops && laptops.length > 0 ? (
            <div>
              <h2 className="text-sm font-semibold mb-3">
                School devices assigned to your students
              </h2>
              <div className="rounded-xl bg-background p-1.5 shadow-sm border">
                <div className="overflow-hidden rounded-lg border bg-white">
                  <Table className="text-sm">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="px-4 py-2">Student</TableHead>
                        <TableHead className="px-4 py-2">Device</TableHead>
                        <TableHead className="px-4 py-2">Serial #</TableHead>
                        <TableHead className="px-4 py-2 text-right whitespace-nowrap">
                          Assigned
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {laptops.map((l) => (
                        <TableRow key={l.id} className="hover:bg-transparent">
                          <TableCell className="px-4 py-3 font-medium whitespace-nowrap">
                            {l.student_name}
                          </TableCell>
                          <TableCell className="px-4 py-3">
                            <span className="inline-flex items-center gap-1.5">
                              <Laptop className="size-3.5 text-muted-foreground" />
                              {l.make_model}
                              {l.asset_tag ? (
                                <span className="text-xs text-muted-foreground">
                                  · Tag {l.asset_tag}
                                </span>
                              ) : null}
                            </span>
                          </TableCell>
                          <TableCell className="px-4 py-3 font-mono text-xs">
                            {l.serial_number}
                          </TableCell>
                          <TableCell className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                            {fmtIsoDate(l.assigned_date)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Assigned devices remain school property. Report damage or
                loss to the office as soon as possible.
              </p>
            </div>
          ) : null}
        </>
      )}

      <p className="text-xs text-muted-foreground text-center pt-4 border-t">
        Purchased items are handed out at school. Questions about an order
        or device?{" "}
        <a
          href="mailto:tward@sailfuture.org?subject=School%20store"
          className="text-primary underline underline-offset-2"
        >
          Contact the office
        </a>
        .
      </p>
    </div>
  );
}

/** Skeleton mirroring catalog cards + purchases table. */
function StoreSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-4 w-28 mb-3" />
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex gap-4 rounded-xl border bg-white p-4">
              <Skeleton className="size-20 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-8 w-28 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <Skeleton className="h-4 w-32 mb-3" />
        <div className="rounded-xl border bg-white divide-y">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-5 w-32 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
