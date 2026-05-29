"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** School year the new student is being registered for — the year the
   *  dashboard is currently scoped to. */
  yearId: number;
}

const blankForm = {
  first_name: "",
  last_name: "",
  date_of_birth: "",
  gender: "",
  ethnicity: "",
};

/**
 * "Create New Registration" sheet for residential / foster families.
 * Collects a new student's identity, then POSTs to
 * `/api/residential-students` (which creates the student + a marked
 * mid-year application) and routes the parent into the per-student
 * registration flow at `/dashboard/add-student/[applicationId]`.
 */
export function AddResidentialStudentSheet({
  open,
  onOpenChange,
  yearId,
}: Props) {
  const router = useRouter();
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
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/residential-students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: form.first_name,
          last_name: form.last_name,
          date_of_birth: form.date_of_birth || null,
          gender: form.gender,
          ethnicity: form.ethnicity,
          yearId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? `Failed to create student (${res.status})`);
      }
      const applicationId = data?.application?.id;
      onOpenChange(false);
      reset();
      if (applicationId) {
        router.push(`/dashboard/add-student/${applicationId}`);
      } else {
        toast.success("Student created.");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Network error — please try again"
      );
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
          <SheetTitle>Create New Registration</SheetTitle>
          <SheetDescription>
            Add a new student to your family. You&rsquo;ll complete their
            registration details on the next step, then our admissions team
            reviews it.
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
              <FieldLabel>Date of Birth</FieldLabel>
              <Input
                type="date"
                value={form.date_of_birth}
                onChange={(e) => update("date_of_birth", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>Gender</FieldLabel>
              <Select
                value={form.gender}
                onValueChange={(v) => update("gender", v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Non-binary">Non-binary</SelectItem>
                  <SelectItem value="Prefer not to say">
                    Prefer not to say
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Ethnicity</FieldLabel>
              <Select
                value={form.ethnicity}
                onValueChange={(v) => update("ethnicity", v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select ethnicity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="American Indian or Alaska Native">
                    American Indian or Alaska Native
                  </SelectItem>
                  <SelectItem value="Asian">Asian</SelectItem>
                  <SelectItem value="Black or African American">
                    Black or African American
                  </SelectItem>
                  <SelectItem value="Hispanic or Latino">
                    Hispanic or Latino
                  </SelectItem>
                  <SelectItem value="Native Hawaiian or Pacific Islander">
                    Native Hawaiian or Pacific Islander
                  </SelectItem>
                  <SelectItem value="White">White</SelectItem>
                  <SelectItem value="Two or More Races">
                    Two or More Races
                  </SelectItem>
                  <SelectItem value="Prefer not to say">
                    Prefer not to say
                  </SelectItem>
                </SelectContent>
              </Select>
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
              {submitting ? "Creating…" : "Continue to Registration"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
