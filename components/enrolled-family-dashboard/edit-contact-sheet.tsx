"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { StateSelect } from "@/components/state-select";

/** Shared contact shape — parents and emergency contacts have the same fields
 *  the parent cares about editing, so one sheet handles both. The `kind`
 *  prop decides the PATCH endpoint. */
interface Contact {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  relationship: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  zipcode: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which endpoint to PATCH. `parent` → `/api/parents/:id`, `emergency` → `/api/emergency-contacts/:id`. */
  kind: "parent" | "emergency";
  contact: Contact | null;
  onSaved: () => void;
}

/**
 * Sheet used from the enrolled-family dashboard to let parents self-serve
 * contact updates (primary/secondary parent, emergency contacts). Reuses the
 * same StateSelect + Field primitives as the registration flow for
 * consistency. Fires a targeted SWR invalidation on save so the dashboard
 * re-renders with the updated values without a manual reload.
 */
export function EditContactSheet({
  open,
  onOpenChange,
  kind,
  contact,
  onSaved,
}: Props) {
  const { mutate } = useSWRConfig();
  const [form, setForm] = useState<Contact | null>(null);
  const [saving, setSaving] = useState(false);

  // Pull fresh form state out of the incoming contact every time the sheet
  // opens on a new record. We can't just bind the input `value` to `contact`
  // directly because the parent clears `editing` (and thus `contact`) during
  // sheet close, which would wipe the inputs on the way out.
  useEffect(() => {
    if (open && contact) setForm({ ...contact });
  }, [open, contact]);

  function update<K extends keyof Contact>(field: K, value: Contact[K]) {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    try {
      const url =
        kind === "parent"
          ? `/api/parents/${form.id}`
          : `/api/emergency-contacts/${form.id}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: form.first_name,
          last_name: form.last_name,
          email: form.email,
          phone: form.phone,
          relationship: form.relationship,
          address_line_1: form.address_line_1,
          address_line_2: form.address_line_2,
          city: form.city,
          state: form.state,
          zipcode: form.zipcode,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      // Invalidate whichever collection this record lives in so the
      // dashboard picks up the change on next render.
      if (kind === "parent") {
        mutate("/api/families");
      } else {
        mutate("/api/emergency-contacts");
      }
      toast.success("Contact updated.");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to update contact:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to save. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col p-0 gap-0">
        {/* Header is fixed; scrollable body and sticky footer below. */}
        <SheetHeader className="px-6 py-4 border-b shrink-0">
          <SheetTitle>
            {kind === "parent" ? "Edit Parent / Guardian" : "Edit Emergency Contact"}
          </SheetTitle>
          <SheetDescription>
            Changes apply immediately. For updates to tuition, student records,
            or anything else, contact the office.
          </SheetDescription>
        </SheetHeader>

        {form ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
            className="flex flex-col flex-1 min-h-0"
          >
            {/* Scrollable body — fields stack vertically full-width. */}
            <div className="flex flex-col gap-4 p-6 overflow-y-auto flex-1">
            {/* Single-column layout — every field stretches the full width
                of the sheet for easier reading on touch devices and to
                avoid cramped two-column rows. */}
            <Field>
              <FieldLabel>First Name</FieldLabel>
              <Input
                value={form.first_name}
                onChange={(e) => update("first_name", e.target.value)}
                required
              />
            </Field>

            <Field>
              <FieldLabel>Last Name</FieldLabel>
              <Input
                value={form.last_name}
                onChange={(e) => update("last_name", e.target.value)}
                required
              />
            </Field>

            <Field>
              <FieldLabel>Relationship</FieldLabel>
              <Input
                value={form.relationship}
                onChange={(e) => update("relationship", e.target.value)}
                placeholder="e.g. Mother, Aunt, Grandparent"
              />
            </Field>

            <Field>
              <FieldLabel>Phone</FieldLabel>
              <Input
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
                placeholder="(555) 555-5555"
              />
            </Field>

            <Field>
              <FieldLabel>Email</FieldLabel>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                placeholder="email@example.com"
              />
            </Field>

            <Field>
              <FieldLabel>Address Line 1</FieldLabel>
              <Input
                value={form.address_line_1}
                onChange={(e) => update("address_line_1", e.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel>Address Line 2</FieldLabel>
              <Input
                value={form.address_line_2}
                onChange={(e) => update("address_line_2", e.target.value)}
                placeholder="Apt, Suite, Unit (optional)"
              />
            </Field>

            <Field>
              <FieldLabel>City</FieldLabel>
              <Input
                value={form.city}
                onChange={(e) => update("city", e.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel>State</FieldLabel>
              <StateSelect
                value={form.state}
                onChange={(val) => update("state", val)}
              />
            </Field>

            <Field>
              <FieldLabel>Zip</FieldLabel>
              <Input
                value={form.zipcode}
                onChange={(e) => update("zipcode", e.target.value)}
              />
            </Field>
            </div>

            {/* Sticky footer — Cancel + Save sit at the bottom of the
                sheet regardless of how long the form scrolls. 50/50 split
                so both buttons span the full width. */}
            <div className="grid grid-cols-2 gap-2 px-6 py-4 border-t shrink-0 bg-background">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
