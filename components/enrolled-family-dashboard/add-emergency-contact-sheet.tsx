"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Field, FieldLabel } from "@/components/ui/field";
import { StateSelect } from "@/components/state-select";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const blankForm = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  relationship: "",
  address_line_1: "",
  address_line_2: "",
  city: "",
  state: "",
  zipcode: "",
};

/**
 * Add Emergency Contact sheet — creates a new emergency contact directly
 * (no Clerk invite, since emergency contacts don't get accounts). Single-
 * column layout to match EditContactSheet.
 */
export function AddEmergencyContactSheet({ open, onOpenChange }: Props) {
  const { mutate } = useSWRConfig();
  const [form, setForm] = useState(blankForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function update<K extends keyof typeof blankForm>(field: K, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function reset() {
    setForm(blankForm);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/emergency-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to add emergency contact");
      }
      await mutate("/api/emergency-contacts");
      toast.success("Emergency contact added.");
      onOpenChange(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <SheetContent className="flex flex-col p-0 gap-0">
        <SheetHeader className="px-6 py-4 border-b shrink-0">
          <SheetTitle>Add Emergency Contact</SheetTitle>
          <SheetDescription>
            Used by the school if the primary parents can&rsquo;t be
            reached. No account is created — this is for our records only.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex flex-col gap-4 p-6 overflow-y-auto flex-1">
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
              placeholder="e.g. Aunt, Grandparent, Family friend"
            />
          </Field>
          <Field>
            <FieldLabel>Phone</FieldLabel>
            <PhoneInput
              value={form.phone}
              onChange={(d) => update("phone", d)}
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
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
          </div>
          <div className="grid grid-cols-2 gap-2 px-6 py-4 border-t shrink-0 bg-background">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Adding..." : "Add Contact"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
