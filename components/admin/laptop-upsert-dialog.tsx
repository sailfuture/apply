"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { AdminLaptopDevice } from "@/app/api/admin/laptops/route";

/**
 * New / Edit Laptop — the inventory record itself. Asset + serial
 * should match what's printed on the device; RFIDs and deactivation
 * are edited from the detail panel, not here.
 */
export function LaptopUpsertDialog({
  existing,
  onDone,
}: {
  /** null = create a new device. */
  existing: AdminLaptopDevice | null;
  onDone: (saved: boolean) => void;
}) {
  const [assetNumber, setAssetNumber] = useState(existing?.asset_number ?? "");
  const [serialNumber, setSerialNumber] = useState(
    existing?.serial_number ?? ""
  );
  const [model, setModel] = useState(existing?.model ?? "");
  const [yearPurchase, setYearPurchase] = useState(
    existing?.year_purchase ?? ""
  );
  const [managementUrl, setManagementUrl] = useState(
    existing?.device_management_url ?? ""
  );
  const [saving, setSaving] = useState(false);

  const valid =
    assetNumber.trim().length > 0 &&
    serialNumber.trim().length > 0 &&
    model.trim().length > 0;

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const payload = {
        asset_number: assetNumber.trim(),
        serial_number: serialNumber.trim(),
        model: model.trim(),
        year_purchase: yearPurchase.trim(),
        device_management_url: managementUrl.trim(),
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
      toast.success(existing ? "Laptop updated." : "Laptop added.");
      onDone(true);
    } catch (err) {
      console.error("Failed to save laptop:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onDone(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {existing ? `Edit ${existing.asset_number}` : "New Laptop"}
          </DialogTitle>
          <DialogDescription>
            Inventory record. The asset number and serial number should
            match what&rsquo;s printed on the device. RFIDs and retired
            status are edited later from the laptop detail panel.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              Asset Number <span className="text-red-500">*</span>
            </Label>
            <Input
              value={assetNumber}
              onChange={(e) => setAssetNumber(e.target.value)}
              placeholder="1-01"
              autoFocus={!existing}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              Serial Number <span className="text-red-500">*</span>
            </Label>
            <Input
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value)}
              placeholder="NXKKBAA0014480037B2N00"
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              Model <span className="text-red-500">*</span>
            </Label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Acer Chromebook 311"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Year Purchased</Label>
            <Input
              value={yearPurchase}
              onChange={(e) => setYearPurchase(e.target.value)}
              placeholder="2025"
              inputMode="numeric"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Device Management URL</Label>
            <Input
              value={managementUrl}
              onChange={(e) => setManagementUrl(e.target.value)}
              placeholder="https://admin.google.com/…"
              type="url"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            className="bg-white"
            disabled={saving}
            onClick={() => onDone(false)}
          >
            Cancel
          </Button>
          <Button disabled={!valid || saving} onClick={() => void save()}>
            {saving ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Saving
              </>
            ) : existing ? (
              "Save Changes"
            ) : (
              "Add Laptop"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
