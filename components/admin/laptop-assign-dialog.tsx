"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  LAPTOP_CONDITIONS,
  dateInputToMs,
  todayInputValue,
} from "@/components/admin/laptop-condition";
import type {
  AdminLaptopDevice,
  LaptopStudentOption,
} from "@/app/api/admin/laptops/route";

/**
 * Assign a device to an enrolled student — searchable roster (crew
 * on the right), pickup date, condition at pickup, optional handoff
 * notes. Students already holding a device are disabled so a laptop
 * can't be double-issued; the POST route enforces the same rule.
 *
 * With `linkAssignmentId` the dialog becomes the LINK flow instead:
 * legacy staff-system checkouts carry only the ops student UUID, so
 * this picks which enrolled student the open row belongs to and
 * PATCHes the bridge columns (no new row, no date/condition inputs).
 *
 * Archived and unenrolled students appear in both flows but are only
 * pickable when linking. Linking records who actually held a device,
 * and leaving the school doesn't change that — whereas issuing a
 * laptop to someone who has left is the mistake worth blocking.
 */
export function LaptopAssignDialog({
  laptop,
  students,
  linkAssignmentId,
  onDone,
}: {
  laptop: AdminLaptopDevice;
  students: LaptopStudentOption[];
  /** When set, PATCH this assignment's enrolled-student link instead
   *  of creating a new checkout. */
  linkAssignmentId?: number;
  onDone: (saved: boolean) => void;
}) {
  const linking = !!linkAssignmentId;
  const [studentId, setStudentId] = useState(0);
  const [date, setDate] = useState(todayInputValue());
  const [condition, setCondition] = useState("A");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!studentId || saving) return;
    setSaving(true);
    try {
      const res = linking
        ? await fetch(`/api/admin/laptops/assignments/${linkAssignmentId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enrolled_students_id: studentId }),
          })
        : await fetch("/api/admin/laptops/assignments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              laptops_id: laptop.id,
              enrolled_students_id: studentId,
              assigned_date: dateInputToMs(date) || Date.now(),
              assigned_condition: condition,
              notes: notes.trim(),
            }),
          });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Assign failed (${res.status})`);
      }
      toast.success(linking ? "Student linked." : "Laptop assigned.");
      onDone(true);
    } catch (err) {
      console.error("Failed to assign laptop:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't assign.");
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onDone(false)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {linking
              ? `Link Student — Laptop ${laptop.asset_number || laptop.model}`
              : `Assign Laptop ${laptop.asset_number || laptop.model}`}
          </DialogTitle>
          <DialogDescription>
            {laptop.model}
            {laptop.serial_number ? ` · Serial ${laptop.serial_number}` : ""}
            {linking
              ? " — this checkout came from the staff system without an enrolled-student link. Pick who's holding it so the device shows on the family's Store page."
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              Student <span className="text-red-500">*</span>
            </Label>
            <Command className="rounded-md border">
              <CommandInput placeholder="Search students…" />
              <CommandList className="max-h-56">
                <CommandEmpty>No students match.</CommandEmpty>
                {students.map((s) => {
                  const taken = !!s.assigned_asset;
                  // Former students can be linked to a checkout they
                  // actually had, but never issued a new one.
                  const former = s.status !== "active";
                  const disabled = taken || (former && !linking);
                  return (
                    <CommandItem
                      key={s.id}
                      value={`${s.name} ${s.crew}`}
                      disabled={disabled}
                      onSelect={() => setStudentId(s.id)}
                      className={cn(
                        "flex items-center justify-between gap-3",
                        studentId === s.id && "bg-accent"
                      )}
                    >
                      <span
                        className={cn(
                          "flex items-center gap-1.5",
                          studentId === s.id && "font-medium",
                          disabled && "text-muted-foreground"
                        )}
                      >
                        {s.name}
                        {former ? (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {s.status === "archived" ? "Archived" : "Not enrolled"}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {taken ? `Has ${s.assigned_asset}` : s.crew}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandList>
            </Command>
            <p className="text-[11px] text-muted-foreground">
              Students with an open assignment are disabled to prevent
              double-issuing.
              {linking
                ? " Former students can be linked to a checkout they held."
                : " Former students are listed but can't be issued a laptop."}
            </p>
          </div>

          {!linking ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Assigned Date</Label>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Condition at Pickup</Label>
                  <Select value={condition} onValueChange={setCondition}>
                    <SelectTrigger className="w-full bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LAPTOP_CONDITIONS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional handoff notes (charger included, missing case, etc.)"
                  rows={3}
                />
              </div>
            </>
          ) : null}
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
          <Button disabled={!studentId || saving} onClick={() => void save()}>
            {saving ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                {linking ? "Linking" : "Assigning"}
              </>
            ) : linking ? (
              "Link Student"
            ) : (
              "Assign Laptop"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
