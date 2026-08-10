"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  ArrowRightLeft,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  ConditionBadge,
  LAPTOP_CONDITIONS,
  dateInputToMs,
  fmtLaptopDate,
  todayInputValue,
} from "@/components/admin/laptop-condition";
import { LaptopGoogleCard } from "@/components/admin/laptop-google-card";
import type {
  AdminLaptopDevice,
  LaptopAssignmentInfo,
} from "@/app/api/admin/laptops/route";

/**
 * Device detail panel — the full record for one laptop: identity
 * fields, deactivate toggle, RFID tag management, the open
 * assignment (assign / return / undo), past checkout history, and
 * the edit/delete actions. All writes revalidate through
 * `onChanged` so the sheet re-renders from fresh SWR data.
 */
export function LaptopDetailSheet({
  laptop,
  onOpenChange,
  onEdit,
  onAssign,
  onLink,
  onChanged,
  onDeleted,
}: {
  laptop: AdminLaptopDevice | null;
  onOpenChange: (open: boolean) => void;
  /** Open the edit dialog for this device. */
  onEdit: (laptop: AdminLaptopDevice) => void;
  /** Open the assign dialog for this device. */
  onAssign: (laptop: AdminLaptopDevice) => void;
  /** Open the link-student dialog for an unlinked legacy checkout. */
  onLink: (laptop: AdminLaptopDevice, assignmentId: number) => void;
  /** Revalidate the page's SWR data after any write. */
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [newUid, setNewUid] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [returning, setReturning] = useState<LaptopAssignmentInfo | null>(
    null
  );

  async function patchDevice(
    action: string,
    body: Record<string, unknown>,
    okMessage: string
  ) {
    if (!laptop || busy) return;
    setBusy(action);
    try {
      const res = await fetch(`/api/admin/laptops/${laptop.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error ?? `Save failed (${res.status})`);
      }
      toast.success(okMessage);
      onChanged();
    } catch (err) {
      console.error("Failed to update laptop:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteDevice() {
    if (!laptop || busy) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/admin/laptops/${laptop.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error ?? `Delete failed (${res.status})`);
      }
      toast.success("Laptop deleted.");
      setConfirmDelete(false);
      onDeleted();
    } catch (err) {
      console.error("Failed to delete laptop:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't delete.");
    } finally {
      setBusy(null);
    }
  }

  /** Undo a mis-assignment — removes the open row without writing a
   *  return into the device's history. */
  async function removeOpenAssignment() {
    if (!laptop?.current || busy) return;
    setBusy("undo");
    try {
      const res = await fetch(
        `/api/admin/laptops/assignments/${laptop.current.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error ?? `Remove failed (${res.status})`);
      }
      toast.success("Assignment removed.");
      onChanged();
    } catch (err) {
      console.error("Failed to remove assignment:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't remove.");
    } finally {
      setBusy(null);
    }
  }

  function addUid() {
    if (!laptop) return;
    const uid = newUid.trim().toUpperCase();
    if (!uid) return;
    if (laptop.rfid_uid.some((u) => u.toUpperCase() === uid)) {
      toast.error("That UID is already on this laptop.");
      return;
    }
    setNewUid("");
    void patchDevice(
      "rfid",
      { rfid_uid: [...laptop.rfid_uid, uid] },
      "RFID UID added."
    );
  }

  const current = laptop?.current ?? null;
  // Condition chip in the header: what the device is graded at right
  // now — the open checkout's pickup grade, else the latest return.
  const headerCondition =
    current?.assigned_condition ||
    laptop?.history.find((h) => h.returned_condition)?.returned_condition ||
    "";

  return (
    <>
      <Sheet open={!!laptop} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl"
        >
          {laptop ? (
            <>
              <SheetHeader className="border-b px-5 py-4">
                <SheetTitle className="flex items-center gap-2 text-lg">
                  {laptop.asset_number || `Laptop #${laptop.id}`}
                  <ConditionBadge condition={headerCondition} />
                  {laptop.deactivated ? (
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground ring-1 ring-border">
                      Deactivated
                    </span>
                  ) : null}
                </SheetTitle>
                <SheetDescription>{laptop.model}</SheetDescription>
              </SheetHeader>

              <div className="flex-1 space-y-6 px-5 py-5">
                <div className="space-y-4">
                  <Field label="Serial Number">
                    <span className="font-mono text-sm">
                      {laptop.serial_number || "—"}
                    </span>
                  </Field>
                  <Field label="Model">{laptop.model || "—"}</Field>
                  <Field label="Asset Number">
                    {laptop.asset_number || "—"}
                  </Field>
                  <Field label="Year Purchased">
                    {laptop.year_purchase || "—"}
                  </Field>
                  <Field label="Device Management URL">
                    {laptop.device_management_url ? (
                      <a
                        href={laptop.device_management_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm hover:underline"
                      >
                        Open in Google Admin
                        <ExternalLink className="size-3.5 text-muted-foreground" />
                      </a>
                    ) : (
                      "—"
                    )}
                  </Field>
                </div>

                <div className="flex items-start justify-between gap-4 rounded-md border px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">Deactivated</p>
                    <p className="text-xs text-muted-foreground">
                      Move this device into the deactivated table. History
                      is preserved.
                    </p>
                    {current && !laptop.deactivated ? (
                      <p className="mt-1 text-[11px] text-amber-700">
                        Currently assigned — return the laptop before
                        deactivating.
                      </p>
                    ) : null}
                  </div>
                  <Switch
                    checked={laptop.deactivated}
                    disabled={busy !== null || (!!current && !laptop.deactivated)}
                    onCheckedChange={(checked) =>
                      void patchDevice(
                        "deactivate",
                        { deactivated: checked },
                        checked ? "Laptop deactivated." : "Laptop reactivated."
                      )
                    }
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      RFID UIDs
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {laptop.rfid_uid.length}{" "}
                      {laptop.rfid_uid.length === 1 ? "UID" : "UIDs"}
                    </p>
                  </div>
                  {laptop.rfid_uid.map((uid) => (
                    <div
                      key={uid}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <span className="font-mono text-sm">{uid}</span>
                      <button
                        type="button"
                        aria-label={`Remove UID ${uid}`}
                        disabled={busy !== null}
                        className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                        onClick={() =>
                          void patchDevice(
                            "rfid",
                            {
                              rfid_uid: laptop.rfid_uid.filter(
                                (u) => u !== uid
                              ),
                            },
                            "RFID UID removed."
                          )
                        }
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <Input
                      value={newUid}
                      onChange={(e) => setNewUid(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addUid();
                        }
                      }}
                      placeholder="Enter UID Here"
                      className="font-mono"
                    />
                    <Button
                      variant="outline"
                      className="shrink-0 bg-white"
                      disabled={!newUid.trim() || busy !== null}
                      onClick={addUid}
                    >
                      <Plus className="size-3.5" />
                      Add UID
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">Current Assignment</p>
                    {!current && !laptop.deactivated ? (
                      <Button
                        variant="outline"
                        className="bg-white"
                        disabled={busy !== null}
                        onClick={() => onAssign(laptop)}
                      >
                        <ArrowRightLeft className="size-3.5" />
                        Assign to student
                      </Button>
                    ) : null}
                  </div>
                  {current ? (
                    <div className="rounded-md border px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <StudentAvatar
                            name={current.student_name}
                            photoUrl={current.student_photo_url}
                          />
                          <div>
                            <p className="text-sm font-medium">
                              {current.student_name || (
                                <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                                  Not linked to an enrolled student
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {[
                                current.crew,
                                `Assigned ${fmtLaptopDate(
                                  current.assigned_date
                                )}`,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                          <ConditionBadge
                            condition={current.assigned_condition}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          {!current.enrolled_students_id ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="bg-white"
                              disabled={busy !== null}
                              onClick={() => onLink(laptop, current.id)}
                            >
                              Link student
                            </Button>
                          ) : null}
                          <Button
                            variant="outline"
                            size="sm"
                            className="bg-white"
                            disabled={busy !== null}
                            onClick={() => removeOpenAssignmentWithConfirm()}
                          >
                            {busy === "undo" ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Undo2 className="size-3.5" />
                            )}
                            Undo
                          </Button>
                          <Button
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => setReturning(current)}
                          >
                            Return laptop
                          </Button>
                        </div>
                      </div>
                      {current.notes ? (
                        <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                          {current.notes}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </div>

                <LaptopGoogleCard laptop={laptop} />

                <div className="space-y-2">
                  <p className="text-sm font-semibold">
                    Past History
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      · {laptop.history.length}{" "}
                      {laptop.history.length === 1 ? "record" : "records"}
                    </span>
                  </p>
                  {laptop.history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No past assignments.
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-md border">
                      <Table className="text-sm">
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="pl-3">Student</TableHead>
                            <TableHead>Assigned</TableHead>
                            <TableHead>Returned</TableHead>
                            <TableHead>Condition</TableHead>
                            <TableHead className="pr-3">Notes</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {laptop.history.map((h) => (
                            <TableRow key={h.id} className="hover:bg-muted/30">
                              <TableCell className="pl-3">
                                <span className="flex items-center gap-2">
                                  <StudentAvatar
                                    name={h.student_name}
                                    photoUrl={h.student_photo_url}
                                    size="sm"
                                  />
                                  <span className="whitespace-nowrap">
                                    {h.student_name || (
                                      <span className="text-muted-foreground">
                                        Staff-system record
                                      </span>
                                    )}
                                  </span>
                                </span>
                              </TableCell>
                              <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                                {fmtLaptopDate(h.assigned_date)}
                              </TableCell>
                              <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                                {fmtLaptopDate(h.returned_date)}
                              </TableCell>
                              <TableCell>
                                <span className="inline-flex items-center gap-1">
                                  <ConditionBadge
                                    condition={h.assigned_condition}
                                  />
                                  {h.returned_condition ? (
                                    <>
                                      <ArrowRight className="size-3 text-muted-foreground" />
                                      <ConditionBadge
                                        condition={h.returned_condition}
                                      />
                                    </>
                                  ) : null}
                                </span>
                              </TableCell>
                              <TableCell className="pr-3 max-w-40 truncate text-muted-foreground">
                                {h.notes || "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </div>

              <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t bg-white px-5 py-3">
                <Button
                  variant="outline"
                  className="bg-white text-red-600 hover:bg-red-50 hover:text-red-700"
                  disabled={busy !== null}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="size-3.5" />
                  Delete Laptop
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="bg-white"
                    disabled={busy !== null}
                    onClick={() => onEdit(laptop)}
                  >
                    <Pencil className="size-3.5" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    className="bg-white"
                    onClick={() => onOpenChange(false)}
                  >
                    Close
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {laptop?.asset_number || "this laptop"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the device and its entire
              assignment history
              {laptop && laptop.history.length > 0
                ? ` (${laptop.history.length} past ${
                    laptop.history.length === 1 ? "record" : "records"
                  })`
                : ""}
              . If the device is just being retired, use the Deactivated
              toggle instead — that keeps the history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "delete"}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={busy === "delete"}
              onClick={(e) => {
                e.preventDefault();
                void deleteDevice();
              }}
            >
              {busy === "delete" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Deleting
                </>
              ) : (
                "Delete Laptop"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {returning && laptop ? (
        <LaptopReturnDialog
          laptop={laptop}
          assignment={returning}
          onDone={(saved) => {
            setReturning(null);
            if (saved) onChanged();
          }}
        />
      ) : null}
    </>
  );

  function removeOpenAssignmentWithConfirm() {
    // Undo is for "wrong student / wrong laptop" mistakes — the row
    // disappears rather than becoming history, so double-check.
    if (
      window.confirm(
        "Remove this assignment without recording a return? Use this only to undo a mistake — returning the laptop should use the Return button."
      )
    ) {
      void removeOpenAssignment();
    }
  }
}

/** Close a checkout — return date, condition at return, notes. */
function LaptopReturnDialog({
  laptop,
  assignment,
  onDone,
}: {
  laptop: AdminLaptopDevice;
  assignment: LaptopAssignmentInfo;
  onDone: (saved: boolean) => void;
}) {
  const [date, setDate] = useState(todayInputValue());
  const [condition, setCondition] = useState(
    assignment.assigned_condition || "A"
  );
  const [notes, setNotes] = useState(assignment.notes);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/laptops/assignments/${assignment.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            returned_date: dateInputToMs(date) || Date.now(),
            returned_condition: condition,
            notes: notes.trim(),
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Return failed (${res.status})`);
      }
      toast.success("Laptop returned.");
      onDone(true);
    } catch (err) {
      console.error("Failed to return laptop:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't return.");
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onDone(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Return {laptop.asset_number || laptop.model}
          </DialogTitle>
          <DialogDescription>
            Checking in from {assignment.student_name || "the current holder"}
            {assignment.assigned_date
              ? ` (assigned ${fmtLaptopDate(assignment.assigned_date)})`
              : ""}
            . The assignment moves into the device&rsquo;s history.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Returned Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Condition at Return</Label>
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
              placeholder="Damage, missing charger, etc."
              rows={3}
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
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Returning
              </>
            ) : (
              "Return Laptop"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Tiny uppercase label + value row, matching the screenshot's
 *  spec-sheet style. */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}

function StudentAvatar({
  name,
  photoUrl,
  size = "default",
}: {
  name: string;
  photoUrl: string | null;
  size?: "default" | "sm";
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?";
  return (
    <Avatar size={size}>
      {photoUrl ? <AvatarImage src={photoUrl} alt={name} /> : null}
      <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
    </Avatar>
  );
}
