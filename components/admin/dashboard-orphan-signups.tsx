"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminFetcher as fetcher } from "@/lib/admin-fetcher";
import { formatTimestampUs } from "@/lib/us-date";

/** The fields this card reads off `/api/admin/families` rows. */
interface AdminFamilyRow {
  id: number;
  family_name: string;
  created_at: number;
  student_count: number;
  primary_email: string;
  /** Sign-in address is a student's school account — see
   *  lib/student-accounts.ts. */
  primary_is_student_account: boolean;
}

/** Rows per page. Five keeps the card to one block; most days the
 *  list is empty or a handful. */
const PAGE_SIZE = 5;

/**
 * Families that signed up but never added a student. Two things land
 * here: a parent who created their account and stalled before the
 * application (nudge them), and a stray account — a student who signed
 * in with their school Google login and got a family minted before the
 * /student-account guard existed (delete it). The badge tells the two
 * apart. Rows open the family's overview page, where the Danger Zone
 * delete lives.
 */
export function OrphanSignupsCard() {
  const router = useRouter();
  const { data, isLoading } = useSWR<AdminFamilyRow[]>(
    "/api/admin/families",
    fetcher
  );
  // The route already sorts newest first.
  const rows = useMemo(
    () =>
      (Array.isArray(data) ? data : []).filter((f) => f.student_count === 0),
    [data]
  );

  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const first = current * PAGE_SIZE;
  const visible = rows.slice(first, first + PAGE_SIZE);
  const loading = isLoading && !data;

  return (
    <Card className="overflow-hidden bg-white py-0 gap-0">
      <CardHeader className="py-4 border-b bg-white">
        <div className="flex items-baseline gap-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground">
            Sign-ups Without Students
          </CardTitle>
          {!loading ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              ({rows.length})
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="bg-white px-3 pb-3">
        {loading ? (
          <div className="space-y-2 p-1 pt-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-md" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm italic text-muted-foreground">
            Every family has at least one student.
          </p>
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[30%] text-[10px] text-muted-foreground">
                  Family
                </TableHead>
                <TableHead className="w-[36%] text-[10px] text-muted-foreground">
                  Sign-in email
                </TableHead>
                <TableHead className="w-[18%] text-[10px] text-muted-foreground">
                  Account
                </TableHead>
                <TableHead className="w-[16%] text-right text-[10px] text-muted-foreground">
                  Created
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((f) => {
                const href = `/admin/families/${f.id}/overview`;
                return (
                  <TableRow
                    key={f.id}
                    onClick={() => router.push(href)}
                    className="cursor-pointer"
                  >
                    <TableCell className="text-sm font-medium">
                      <Link
                        href={href}
                        className="block truncate hover:underline"
                        title={f.family_name}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {f.family_name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span
                        className="block truncate text-sm text-muted-foreground"
                        title={f.primary_email}
                      >
                        {f.primary_email || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {f.primary_is_student_account ? (
                        <Badge variant="secondary">Student account</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                      {formatTimestampUs(f.created_at) || "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {!loading && rows.length > PAGE_SIZE ? (
          <div className="flex items-center justify-between border-t px-2 pt-2 text-xs tabular-nums text-muted-foreground">
            <span>
              {first + 1}–{first + visible.length} of {rows.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous page"
                disabled={current === 0}
                onClick={() => setPage(Math.max(0, current - 1))}
                className="rounded p-1 hover:bg-muted disabled:opacity-40"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Next page"
                disabled={current >= pageCount - 1}
                onClick={() => setPage(Math.min(pageCount - 1, current + 1))}
                className="rounded p-1 hover:bg-muted disabled:opacity-40"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
