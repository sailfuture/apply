"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Laptop, Loader2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminFetcher } from "@/lib/admin-fetcher";
import type {
  AdminLaptopRow,
  AdminLaptopsResponse,
  LaptopStudentOption,
} from "@/app/api/admin/laptops/route";

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Parent Engagement → Laptops. Assignments read from the staff-side
 * device-inventory system (RFID checkout flow) — devices and
 * check-outs are managed there; the job HERE is linking each
 * assignment to an enrolled student so the device shows on the
 * family's Store page.
 */
export default function AdminLaptopsPage() {
  const { data, mutate } = useSWR<AdminLaptopsResponse>(
    "/api/admin/laptops",
    adminFetcher
  );
  const assignments = data?.assignments ?? [];
  const students = data?.students ?? [];

  const [showReturned, setShowReturned] = useState(false);
  const [linkTarget, setLinkTarget] = useState<AdminLaptopRow | null>(null);

  const active = assignments.filter((a) => !a.returned);
  const returned = assignments.filter((a) => a.returned);
  const unlinked = active.filter((a) => !a.enrolled_students_id).length;
  const visible = showReturned ? assignments : active;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Laptops</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Device assignments from the checkout system. Link each one to an
          enrolled student so the family sees the device on their Store
          page — devices themselves are managed in the device system.
        </p>
      </div>

      <Card className="overflow-hidden gap-0 py-0 bg-white">
        <CardHeader className="py-3 !pb-3 border-b">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                Assignments{data ? ` (${active.length} active)` : ""}
              </CardTitle>
              {data ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {unlinked > 0 ? (
                    <span className="font-medium text-amber-700">
                      {unlinked} active not linked to a student yet
                    </span>
                  ) : (
                    "Every active assignment is linked"
                  )}
                </p>
              ) : null}
            </div>
            {returned.length > 0 ? (
              <Button
                size="sm"
                variant="outline"
                className="bg-white"
                onClick={() => setShowReturned((v) => !v)}
              >
                {showReturned
                  ? "Hide returned"
                  : `Show returned (${returned.length})`}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {!data ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : visible.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No active laptop assignments in the device system.
            </p>
          ) : (
            <Table className="text-sm">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Device</TableHead>
                  <TableHead>Serial #</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Enrolled student</TableHead>
                  <TableHead className="pr-4 text-right">Link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((a) => (
                  <TableRow
                    key={a.id}
                    className={
                      a.returned
                        ? "opacity-60 hover:bg-muted/30"
                        : "hover:bg-muted/30"
                    }
                  >
                    <TableCell className="pl-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <Laptop className="size-3.5 text-muted-foreground" />
                        <span className="font-medium">
                          {a.asset_number || "—"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {a.model}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.serial_number || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {a.assigned_date ? fmtDate(a.assigned_date) : "—"}
                      {a.assigned_condition ? (
                        <span className="ml-1.5 rounded bg-muted px-1 py-px text-[10px] font-semibold">
                          {a.assigned_condition}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {a.returned ? (
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-border">
                          Returned
                          {a.returned_date
                            ? ` · ${fmtDate(a.returned_date)}`
                            : ""}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                          Checked out
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {a.enrolled_students_id ? (
                        <span>
                          <span className="font-medium">{a.student_name}</span>
                          {a.family_name ? (
                            <span className="text-xs text-muted-foreground">
                              {" "}
                              — {a.family_name}
                            </span>
                          ) : null}
                        </span>
                      ) : a.returned ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                          Not linked
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-white"
                        onClick={() => setLinkTarget(a)}
                      >
                        {a.enrolled_students_id ? "Change" : "Link student"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {linkTarget ? (
        <LaptopLinkDialog
          key={linkTarget.id}
          assignment={linkTarget}
          students={students}
          onDone={(saved) => {
            setLinkTarget(null);
            if (saved) void mutate();
          }}
        />
      ) : null}
    </div>
  );
}

/** Pick which enrolled student a device assignment belongs to. */
function LaptopLinkDialog({
  assignment,
  students,
  onDone,
}: {
  assignment: AdminLaptopRow;
  students: LaptopStudentOption[];
  onDone: (saved: boolean) => void;
}) {
  const [studentId, setStudentId] = useState(
    assignment.enrolled_students_id
      ? String(assignment.enrolled_students_id)
      : ""
  );
  const [saving, setSaving] = useState(false);

  async function save(targetId: number) {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/laptops/${assignment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrolled_students_id: targetId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Save failed (${res.status})`);
      }
      toast.success(targetId ? "Assignment linked." : "Link removed.");
      onDone(true);
    } catch (err) {
      console.error("Failed to link laptop assignment:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onDone(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Link {assignment.asset_number || assignment.model}
          </DialogTitle>
          <DialogDescription>
            Serial {assignment.serial_number || "unknown"} — pick the
            enrolled student holding this device so it appears on their
            family&rsquo;s Store page.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Enrolled student</Label>
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
        <DialogFooter className="gap-2 sm:justify-between">
          {assignment.enrolled_students_id ? (
            <Button
              variant="outline"
              className="bg-white text-red-600 hover:bg-red-50 hover:text-red-700"
              disabled={saving}
              onClick={() => void save(0)}
            >
              Unlink
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="bg-white"
              disabled={saving}
              onClick={() => onDone(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={!Number(studentId) || saving}
              onClick={() => void save(Number(studentId))}
            >
              {saving ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Saving
                </>
              ) : (
                "Link student"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
