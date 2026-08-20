"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Laptop, Loader2, Plus, Search } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminFetcher } from "@/lib/admin-fetcher";
import {
  ConditionBadge,
  fmtLaptopDate,
} from "@/components/admin/laptop-condition";
import { LaptopAssignDialog } from "@/components/admin/laptop-assign-dialog";
import { LaptopDetailSheet } from "@/components/admin/laptop-detail-sheet";
import { LaptopUpsertDialog } from "@/components/admin/laptop-upsert-dialog";
import type {
  AdminLaptopDevice,
  AdminLaptopsResponse,
} from "@/app/api/admin/laptops/route";

/**
 * Laptop inventory — the management surface for the school's device
 * fleet. Devices are created/edited here, RFID tags managed, and the
 * assign/return checkout flow run from the detail panel. Three
 * groups: currently assigned, available on the shelf, and
 * deactivated (retired but history preserved). Assignments always
 * link to an enrolled student, which is what surfaces the device on
 * the family's Store page.
 */
export default function AdminLaptopsPage() {
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const { data, mutate } = useSWR<AdminLaptopsResponse>(
    `/api/admin/laptops${yearId ? `?yearId=${yearId}` : ""}`,
    adminFetcher
  );
  const laptops = useMemo(() => data?.laptops ?? [], [data]);
  const students = data?.students ?? [];

  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminLaptopDevice | null>(null);
  const [assignTarget, setAssignTarget] = useState<AdminLaptopDevice | null>(
    null
  );
  // Legacy staff-system checkout being linked to an enrolled student.
  const [linkTarget, setLinkTarget] = useState<{
    laptop: AdminLaptopDevice;
    assignmentId: number;
  } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return laptops;
    return laptops.filter((l) =>
      [
        l.asset_number,
        l.serial_number,
        l.model,
        l.current?.student_name ?? "",
        ...l.rfid_uid,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [laptops, query]);

  const assigned = filtered.filter((l) => !l.deactivated && l.current);
  const available = filtered.filter((l) => !l.deactivated && !l.current);
  const deactivated = filtered.filter((l) => l.deactivated);

  // Detail sheet reads the live SWR row so every write re-renders it
  // with fresh data instead of a stale snapshot.
  const detailLaptop =
    detailId != null ? laptops.find((l) => l.id === detailId) ?? null : null;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Laptops</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Device inventory and student checkouts. Assignments link to
          enrolled students, which is what shows the device on the
          family&rsquo;s Store page.
        </p>
      </div>

      {/* Search + action on their own full-width row under the header,
          spanning the same width as the table below. */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search asset, serial, student…"
            type="search"
            autoComplete="off"
            className="w-full bg-white pl-8"
          />
        </div>
        <Button className="shrink-0" onClick={() => setShowNew(true)}>
          <Plus className="size-3.5" />
          Add Laptop
        </Button>
      </div>

      {!data ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : laptops.length === 0 ? (
        <Card className="bg-white">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Laptop className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">No laptops yet</p>
            <p className="text-sm text-muted-foreground">
              Add the first device to start tracking the fleet.
            </p>
            <Button className="mt-2" onClick={() => setShowNew(true)}>
              <Plus className="size-3.5" />
              Add Laptop
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <LaptopGroupCard
            title="Currently Assigned"
            count={assigned.length}
            emptyText="No laptops are checked out right now."
            laptops={assigned}
            columns="assigned"
            onRowClick={(l) => setDetailId(l.id)}
          />
          <LaptopGroupCard
            title="Available"
            count={available.length}
            emptyText="Nothing on the shelf — every active laptop is checked out."
            laptops={available}
            columns="available"
            onRowClick={(l) => setDetailId(l.id)}
            onAssign={(l) => setAssignTarget(l)}
          />
          {deactivated.length > 0 ? (
            <LaptopGroupCard
              title="Deactivated"
              count={deactivated.length}
              emptyText=""
              laptops={deactivated}
              columns="deactivated"
              onRowClick={(l) => setDetailId(l.id)}
            />
          ) : null}
        </>
      )}

      <LaptopDetailSheet
        laptop={detailLaptop}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        onEdit={(l) => setEditTarget(l)}
        onAssign={(l) => setAssignTarget(l)}
        onLink={(l, assignmentId) =>
          setLinkTarget({ laptop: l, assignmentId })
        }
        onChanged={() => void mutate()}
        onDeleted={() => {
          setDetailId(null);
          void mutate();
        }}
      />

      {showNew ? (
        <LaptopUpsertDialog
          existing={null}
          onDone={(saved) => {
            setShowNew(false);
            if (saved) void mutate();
          }}
        />
      ) : null}
      {editTarget ? (
        <LaptopUpsertDialog
          key={editTarget.id}
          existing={editTarget}
          onDone={(saved) => {
            setEditTarget(null);
            if (saved) void mutate();
          }}
        />
      ) : null}
      {assignTarget ? (
        <LaptopAssignDialog
          key={assignTarget.id}
          laptop={assignTarget}
          students={students}
          onDone={(saved) => {
            setAssignTarget(null);
            if (saved) void mutate();
          }}
        />
      ) : null}
      {linkTarget ? (
        <LaptopAssignDialog
          key={`link-${linkTarget.assignmentId}`}
          laptop={linkTarget.laptop}
          students={students}
          linkAssignmentId={linkTarget.assignmentId}
          onDone={(saved) => {
            setLinkTarget(null);
            if (saved) void mutate();
          }}
        />
      ) : null}
    </div>
  );
}

/** One inventory group (assigned / available / deactivated) as a
 *  table card. Row click opens the detail sheet; the Available group
 *  also gets a quick Assign shortcut per row. */
function LaptopGroupCard({
  title,
  count,
  emptyText,
  laptops,
  columns,
  onRowClick,
  onAssign,
}: {
  title: string;
  count: number;
  emptyText: string;
  laptops: AdminLaptopDevice[];
  columns: "assigned" | "available" | "deactivated";
  onRowClick: (laptop: AdminLaptopDevice) => void;
  onAssign?: (laptop: AdminLaptopDevice) => void;
}) {
  return (
    <Card className="overflow-hidden gap-0 py-0 bg-white">
      <CardHeader className="py-3 !pb-3 border-b">
        <CardTitle className="text-base">
          {title}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {count}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {laptops.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            {emptyText}
          </p>
        ) : (
          /* table-fixed + the shared width scale below keep the
             Device / Serial / third / fourth / fifth columns in the
             same horizontal position across all three group cards,
             so the stacked tables read as one aligned grid. */
          <Table className="table-fixed text-sm">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[30%] pl-4">Device</TableHead>
                <TableHead className="w-[24%]">Serial #</TableHead>
                {columns === "assigned" ? (
                  <>
                    <TableHead className="w-[24%]">Student</TableHead>
                    <TableHead className="w-[12%]">Assigned</TableHead>
                    <TableHead className="w-[10%] pr-4">Condition</TableHead>
                  </>
                ) : columns === "available" ? (
                  <>
                    <TableHead className="w-[24%]">Year</TableHead>
                    <TableHead className="w-[12%]">RFID tags</TableHead>
                    <TableHead className="w-[10%] pr-4 text-right"></TableHead>
                  </>
                ) : (
                  <TableHead className="w-[46%] pr-4">Reason</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {laptops.map((l) => (
                <TableRow
                  key={l.id}
                  className="cursor-pointer hover:bg-muted/30"
                  onClick={() => onRowClick(l)}
                >
                  <TableCell className="pl-4 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <Laptop className="size-3.5 text-muted-foreground" />
                      <span className="font-medium">
                        {l.asset_number || `#${l.id}`}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {l.model}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {l.serial_number || "—"}
                  </TableCell>
                  {columns === "assigned" ? (
                    <>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <RowAvatar
                            name={l.current?.student_name ?? ""}
                            photoUrl={l.current?.student_photo_url ?? null}
                          />
                          <span>
                            {l.current?.student_name ? (
                              <span className="font-medium whitespace-nowrap">
                                {l.current.student_name}
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                                Not linked
                              </span>
                            )}
                            {l.current?.crew ? (
                              <span className="ml-1.5 text-xs text-muted-foreground">
                                {l.current.crew}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {fmtLaptopDate(l.current?.assigned_date)}
                      </TableCell>
                      <TableCell className="pr-4">
                        <ConditionBadge
                          condition={l.current?.assigned_condition ?? ""}
                        />
                      </TableCell>
                    </>
                  ) : columns === "available" ? (
                    <>
                      <TableCell className="text-muted-foreground">
                        {l.year_purchase || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {l.rfid_uid.length || "—"}
                      </TableCell>
                      <TableCell className="pr-4 text-right whitespace-nowrap">
                        {onAssign ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-white"
                            onClick={(e) => {
                              e.stopPropagation();
                              onAssign(l);
                            }}
                          >
                            Assign
                          </Button>
                        ) : null}
                      </TableCell>
                    </>
                  ) : (
                    <TableCell className="pr-4 text-muted-foreground">
                      {l.reason_for_archive || "—"}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function RowAvatar({
  name,
  photoUrl,
}: {
  name: string;
  photoUrl: string | null;
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?";
  return (
    <Avatar size="sm">
      {photoUrl ? <AvatarImage src={photoUrl} alt={name} /> : null}
      <AvatarFallback className="text-[9px]">{initials}</AvatarFallback>
    </Avatar>
  );
}
