"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { mutateFamily } from "@/hooks/use-api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Add Parent / Guardian sheet — sends a Clerk invitation email and
 * creates a pending parent row on the family. The invitee creates their
 * own account from the invite link and the webhook flips
 * `invite_status` from "pending" to "active".
 *
 * Single-column layout matching the EditContactSheet — every field
 * stretches the full width of the sheet.
 */
export function AddParentSheet({ open, onOpenChange }: Props) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [relationship, setRelationship] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setRelationship("");
    setError("");
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          first_name: firstName,
          last_name: lastName,
          relationship,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to send invitation");
      }
      await mutateFamily();
      toast.success("Invitation sent. They'll receive an email to join.");
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
          <SheetTitle>Add Parent / Guardian</SheetTitle>
          <SheetDescription>
            They&rsquo;ll receive an email to create their own account and
            join your family.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleInvite} className="flex flex-col flex-1 min-h-0">
          <div className="flex flex-col gap-4 p-6 overflow-y-auto flex-1">
          <Field>
            <FieldLabel>First Name</FieldLabel>
            <Input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>Last Name</FieldLabel>
            <Input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>Email</FieldLabel>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field>
            <FieldLabel>Relationship</FieldLabel>
            <Input
              placeholder="e.g. Mother, Father, Guardian"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
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
              {submitting ? "Sending..." : "Send Invitation"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
