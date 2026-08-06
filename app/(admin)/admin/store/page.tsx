"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Check,
  ExternalLink,
  Laptop,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatPriceCents } from "@/lib/store";
import type { AdminStoreOrderRow } from "@/app/api/admin/store/orders/route";
import type {
  AdminLaptopRow,
  AdminLaptopsResponse,
  LaptopStudentOption,
} from "@/app/api/admin/laptops/route";
import type { XanoStoreItem } from "@/lib/xano";

function fmtDateTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Parent Engagement → Store. Two workspaces:
 *   - Orders: every Payment Link purchase mirrored by the Stripe
 *     webhook, with a per-order "Distributed" latch for tracking
 *     hand-out to the family (stamps who/when).
 *   - Items: the catalog parents see on their dashboard — each item
 *     wraps a Stripe Payment Link created in the Stripe Dashboard.
 */
export default function AdminStorePage() {
  const {
    data: orders,
    error: ordersError,
    mutate: mutateOrders,
  } = useSWR<AdminStoreOrderRow[]>("/api/admin/store/orders", adminFetcher);
  const {
    data: items,
    error: itemsError,
    mutate: mutateItems,
  } = useSWR<XanoStoreItem[]>("/api/admin/store/items", adminFetcher);

  const [search, setSearch] = useState("");
  const filteredOrders = useMemo(() => {
    if (!orders) return [];
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) =>
      [o.family_name, o.item, o.purchaser_email]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [orders, search]);

  const awaiting = (orders ?? []).filter((o) => !o.distributed).length;
  const collectedCents = (orders ?? []).reduce(
    (sum, o) => sum + (o.total_amount_cents ?? 0),
    0
  );

  // The tables not existing yet is the expected first-run state —
  // surface the setup hint instead of a generic failure.
  const setupNeeded = !!(ordersError || itemsError);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">School Store</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Items parents can purchase from their dashboard, and every
            purchase that came through — mark each order Distributed once
            it&rsquo;s handed to the family.
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Stat label="Orders" value={String(orders?.length ?? "—")} />
          <Stat label="Awaiting pickup" value={String(orders ? awaiting : "—")} />
          <Stat
            label="Collected"
            value={orders ? `$${(collectedCents / 100).toFixed(2)}` : "—"}
          />
        </div>
      </div>

      {setupNeeded ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Couldn&rsquo;t load the store tables. If this is first-time setup,
          create the <code className="font-mono">store_items</code> and{" "}
          <code className="font-mono">store_orders</code> tables in Xano
          (with their default CRUD endpoints) — the page comes alive as soon
          as they exist.
        </div>
      ) : null}

      {/* ── Orders ── */}
      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Orders</CardTitle>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search family, item, email…"
                className="h-8 w-64 bg-white pl-8 text-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {!orders ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredOrders.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              {search
                ? "No orders match your search."
                : "No purchases yet — orders appear here automatically as parents check out."}
            </p>
          ) : (
            <Table className="text-sm">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Date</TableHead>
                  <TableHead>Family</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Purchaser</TableHead>
                  <TableHead className="pr-4 text-right">Distribution</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map((o) => (
                  <OrderRow
                    key={o.id}
                    order={o}
                    onChanged={() => void mutateOrders()}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Items ── */}
      <ItemsCard
        items={items}
        orders={orders}
        onChanged={() => void mutateItems()}
      />

      {/* ── Laptops ── */}
      <LaptopsCard />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/** One order row — read-only Stripe mirror + the Distributed latch. */
function OrderRow({
  order,
  onChanged,
}: {
  order: AdminStoreOrderRow;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);

  async function setDistributed(distributed: boolean) {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/store/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ distributed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      onChanged();
      toast.success(
        distributed
          ? `Marked distributed to ${order.family_name}.`
          : "Distribution undone."
      );
    } catch (err) {
      console.error("Failed to update order:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableRow className="hover:bg-muted/30">
      <TableCell className="pl-4 whitespace-nowrap tabular-nums text-muted-foreground">
        {fmtDateTime(Number(order.paid_at) || 0)}
      </TableCell>
      <TableCell className="font-medium">{order.family_name}</TableCell>
      <TableCell>{order.item}</TableCell>
      <TableCell className="text-right tabular-nums">
        ${((order.total_amount_cents ?? 0) / 100).toFixed(2)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {order.purchaser_email || "—"}
      </TableCell>
      <TableCell className="pr-4 text-right whitespace-nowrap">
        {order.distributed ? (
          <span className="inline-flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200"
              title={
                order.distributed_by?.trim()
                  ? `By ${order.distributed_by.trim()} · ${fmtDateTime(order.distributed_at)}`
                  : fmtDateTime(order.distributed_at)
              }
            >
              <Check className="size-3" />
              Distributed
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground"
              disabled={saving}
              onClick={() => void setDistributed(false)}
              aria-label="Undo distribution"
              title="Undo distribution"
            >
              <Undo2 className="size-3.5" />
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="bg-white"
            disabled={saving}
            onClick={() => void setDistributed(true)}
          >
            {saving ? (
              <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            ) : (
              <Check className="size-3.5 mr-1.5" />
            )}
            Mark distributed
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

/** Catalog management — the items parents see, with add/edit/delete
 *  and per-product sold / awaiting-pickup rollups from the orders
 *  mirror (`registration_store_items_id` join; unresolved orders sit
 *  outside these counts). */
function ItemsCard({
  items,
  orders,
  onChanged,
}: {
  items: XanoStoreItem[] | undefined;
  orders: AdminStoreOrderRow[] | undefined;
  onChanged: () => void;
}) {
  // item id → { sold units, units on undistributed orders }
  const rollup = useMemo(() => {
    const m = new Map<number, { sold: number; awaiting: number }>();
    for (const o of orders ?? []) {
      const itemId = Number(o.registration_store_items_id) || 0;
      if (!itemId) continue;
      const r = m.get(itemId) ?? { sold: 0, awaiting: 0 };
      const qty = Number(o.quantity) || 1;
      r.sold += qty;
      if (!o.distributed) r.awaiting += qty;
      m.set(itemId, r);
    }
    return m;
  }, [orders]);
  // null = closed; "new" = creating; otherwise the item being edited.
  const [editing, setEditing] = useState<XanoStoreItem | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<XanoStoreItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function deleteItem() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/store/items/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Delete failed (${res.status})`);
      }
      onChanged();
      toast.success(`${deleteTarget.name} deleted.`);
      setDeleteTarget(null);
    } catch (err) {
      console.error("Failed to delete item:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't delete.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Items</CardTitle>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4 mr-1" />
            Add item
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {!items ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No items yet — add your first item with its Stripe Payment Link
            and it appears on every enrolled family&rsquo;s dashboard.
          </p>
        ) : (
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Item</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">Awaiting pickup</TableHead>
                <TableHead>Payment link</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const r = rollup.get(item.id) ?? { sold: 0, awaiting: 0 };
                return (
                <TableRow key={item.id} className="hover:bg-muted/30">
                  <TableCell className="pl-4">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ShoppingBag className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="font-medium">{item.name}</p>
                        {item.description?.trim() ? (
                          <p className="text-xs text-muted-foreground truncate max-w-xs">
                            {item.description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPriceCents(item.price_cents ?? 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {orders ? r.sold : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {orders ? (
                      r.awaiting > 0 ? (
                        <span className="font-medium text-amber-700">
                          {r.awaiting}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <a
                      href={item.payment_link_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      {item.payment_link_url.replace("https://", "")}
                      <ExternalLink className="size-3" />
                    </a>
                  </TableCell>
                  <TableCell>
                    {item.is_active ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-border">
                        Hidden
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="pr-4 text-right whitespace-nowrap">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-muted-foreground hover:text-foreground"
                      onClick={() => setEditing(item)}
                      aria-label={`Edit ${item.name}`}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-muted-foreground hover:text-red-600 ml-1"
                      onClick={() => setDeleteTarget(item)}
                      aria-label={`Delete ${item.name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {editing !== null ? (
        <ItemUpsertDialog
          existing={editing === "new" ? null : editing}
          onDone={(saved) => {
            setEditing(null);
            if (saved) onChanged();
          }}
        />
      ) : null}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !deleting && !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{deleteTarget?.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Removes the item from the parent store. Past orders are kept.
              (To take it off the store temporarily, edit it and switch
              Active off instead.)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep item</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void deleteItem();
              }}
            >
              {deleting ? "Deleting…" : "Delete item"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** Create / edit one store item. Price entered in dollars. */
function ItemUpsertDialog({
  existing,
  onDone,
}: {
  existing: XanoStoreItem | null;
  onDone: (saved: boolean) => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(
    (existing?.description ?? "").trim()
  );
  const [url, setUrl] = useState(existing?.payment_link_url ?? "");
  const [active, setActive] = useState(existing ? existing.is_active : true);
  const [sortOrder, setSortOrder] = useState(
    existing ? String(existing.sort_order ?? 0) : "0"
  );
  const [saving, setSaving] = useState(false);

  const canSave =
    name.trim().length > 0 &&
    /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_-]+$/.test(url.trim());

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        payment_link_url: url.trim(),
        is_active: active,
        sort_order: Number(sortOrder) || 0,
      };
      const res = await fetch(
        existing
          ? `/api/admin/store/items/${existing.id}`
          : "/api/admin/store/items",
        {
          method: existing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      toast.success(existing ? "Item updated." : "Item added.");
      onDone(true);
    } catch (err) {
      console.error("Failed to save item:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save item.");
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onDone(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit item" : "Add item"}</DialogTitle>
          <DialogDescription>
            Create the product and its Payment Link in the Stripe Dashboard
            first, then paste the buy.stripe.com link here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="store-item-name">Name</Label>
            <Input
              id="store-item-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Uniform Shirt"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="store-item-desc">Description (optional)</Label>
            <Textarea
              id="store-item-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Shown under the item name on the parent dashboard."
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="store-item-url">Stripe Payment Link</Label>
            <Input
              id="store-item-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://buy.stripe.com/…"
            />
            <p className="text-[11px] text-muted-foreground">
              The price shown to parents is read from this link&rsquo;s
              Stripe price automatically — no need to enter it.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="store-item-sort">Sort order</Label>
            <Input
              id="store-item-sort"
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="w-24"
            />
            <p className="text-[11px] text-muted-foreground">
              Lower numbers list first.
            </p>
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div>
              <Label htmlFor="store-item-active" className="text-sm">
                Active
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Visible on the parent dashboard.
              </p>
            </div>
            <Switch
              id="store-item-active"
              checked={active}
              onCheckedChange={setActive}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            className="bg-white"
            disabled={saving}
            onClick={() => onDone(false)}
          >
            Cancel
          </Button>
          <Button disabled={!canSave || saving} onClick={() => void save()}>
            {saving ? (
              <>
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                Saving
              </>
            ) : existing ? (
              "Save changes"
            ) : (
              "Add item"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────── Laptop assignments ─────────────────── */

/**
 * School devices assigned to students — assign, edit, and unassign.
 * Parents see their own students' devices on the parent Store page.
 */
function LaptopsCard() {
  const { data, mutate } = useSWR<AdminLaptopsResponse>(
    "/api/admin/laptops",
    adminFetcher
  );
  const laptops = data?.laptops ?? [];
  const students = data?.students ?? [];

  const [editing, setEditing] = useState<AdminLaptopRow | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminLaptopRow | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);

  async function deleteLaptop() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/laptops/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Delete failed (${res.status})`);
      }
      void mutate();
      toast.success("Assignment removed.");
      setDeleteTarget(null);
    } catch (err) {
      console.error("Failed to delete laptop assignment:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't delete.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Assigned laptops</CardTitle>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4 mr-1" />
            Assign laptop
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {!data ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : laptops.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No devices assigned yet — assignments appear on the family&rsquo;s
            Store page.
          </p>
        ) : (
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Student</TableHead>
                <TableHead>Family</TableHead>
                <TableHead>Device</TableHead>
                <TableHead>Serial #</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {laptops.map((l) => (
                <TableRow key={l.id} className="hover:bg-muted/30">
                  <TableCell className="pl-4 font-medium whitespace-nowrap">
                    {l.student_name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.family_name || "—"}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5">
                      <Laptop className="size-3.5 text-muted-foreground" />
                      {l.make_model}
                      {l.asset_tag?.trim() ? (
                        <span className="text-xs text-muted-foreground">
                          · Tag {l.asset_tag.trim()}
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {l.serial_number}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {l.assigned_date || "—"}
                  </TableCell>
                  <TableCell className="pr-4 text-right whitespace-nowrap">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-muted-foreground hover:text-foreground"
                      onClick={() => setEditing(l)}
                      aria-label={`Edit laptop for ${l.student_name}`}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-muted-foreground hover:text-red-600 ml-1"
                      onClick={() => setDeleteTarget(l)}
                      aria-label={`Remove laptop for ${l.student_name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {editing !== null ? (
        <LaptopUpsertDialog
          existing={editing === "new" ? null : editing}
          students={students}
          onDone={(saved) => {
            setEditing(null);
            if (saved) void mutate();
          }}
        />
      ) : null}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !deleting && !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {deleteTarget?.student_name}&rsquo;s laptop?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Removes the assignment record — the device disappears from
              the family&rsquo;s Store page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void deleteLaptop();
              }}
            >
              {deleting ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** Assign / edit one laptop. */
function LaptopUpsertDialog({
  existing,
  students,
  onDone,
}: {
  existing: AdminLaptopRow | null;
  students: LaptopStudentOption[];
  onDone: (saved: boolean) => void;
}) {
  const [studentId, setStudentId] = useState(
    existing ? String(existing.registration_students_id) : ""
  );
  const [makeModel, setMakeModel] = useState(existing?.make_model ?? "");
  const [serial, setSerial] = useState(existing?.serial_number ?? "");
  const [assetTag, setAssetTag] = useState(
    (existing?.asset_tag ?? "").trim()
  );
  const [assignedDate, setAssignedDate] = useState(
    existing?.assigned_date ?? new Date().toISOString().slice(0, 10)
  );
  const [notes, setNotes] = useState((existing?.notes ?? "").trim());
  const [saving, setSaving] = useState(false);

  const canSave =
    Number(studentId) > 0 &&
    makeModel.trim().length > 0 &&
    serial.trim().length > 0;

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const payload = {
        registration_students_id: Number(studentId),
        make_model: makeModel.trim(),
        serial_number: serial.trim(),
        asset_tag: assetTag.trim(),
        assigned_date: assignedDate,
        notes: notes.trim(),
      };
      const res = await fetch(
        existing ? `/api/admin/laptops/${existing.id}` : "/api/admin/laptops",
        {
          method: existing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      toast.success(existing ? "Assignment updated." : "Laptop assigned.");
      onDone(true);
    } catch (err) {
      console.error("Failed to save laptop assignment:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onDone(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Edit laptop assignment" : "Assign a laptop"}
          </DialogTitle>
          <DialogDescription>
            The device shows on the student&rsquo;s family Store page.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Student</Label>
            <Select value={studentId} onValueChange={setStudentId}>
              <SelectTrigger className="w-full bg-white">
                <SelectValue placeholder="Pick a student…" />
              </SelectTrigger>
              <SelectContent>
                {students.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                    {s.family_name ? ` — ${s.family_name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="laptop-model">Make &amp; model</Label>
            <Input
              id="laptop-model"
              value={makeModel}
              onChange={(e) => setMakeModel(e.target.value)}
              placeholder="Lenovo 300e Chromebook"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="laptop-serial">Serial number</Label>
              <Input
                id="laptop-serial"
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                placeholder="5CD1234XYZ"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="laptop-tag">Asset tag (optional)</Label>
              <Input
                id="laptop-tag"
                value={assetTag}
                onChange={(e) => setAssetTag(e.target.value)}
                placeholder="SFA-042"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="laptop-date">Assigned date</Label>
            <Input
              id="laptop-date"
              type="date"
              value={assignedDate}
              onChange={(e) => setAssignedDate(e.target.value)}
              className="w-44"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="laptop-notes">Notes (optional)</Label>
            <Textarea
              id="laptop-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Condition, charger included, etc. Internal — not shown to parents."
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            className="bg-white"
            disabled={saving}
            onClick={() => onDone(false)}
          >
            Cancel
          </Button>
          <Button disabled={!canSave || saving} onClick={() => void save()}>
            {saving ? (
              <>
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                Saving
              </>
            ) : existing ? (
              "Save changes"
            ) : (
              "Assign laptop"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
