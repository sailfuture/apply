"use client";

import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ColumnDef<T> {
  key: string;
  header: string;
  sortable?: boolean;
  searchable?: boolean;
  render?: (row: T) => React.ReactNode;
  accessor?: (row: T) => string | number | null | undefined;
  /** Tailwind width class applied to BOTH the header and body cells
   *  (e.g. `"w-[180px]"`, `"w-1/4"`). Set this when multiple tables on
   *  the same page share columns and need their widths to line up
   *  vertically — a `<table>` otherwise sizes columns purely from
   *  content, so two siblings with the same headers can still drift.
   *  Pair with `<Table className="table-fixed">` if rendering inside
   *  a fixed-layout container. */
  width?: string;
  /** Tailwind alignment class for body cells (e.g. `"text-right"`).
   *  Defaults to left-aligned. */
  align?: "left" | "right" | "center";
}

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  isLoading?: boolean;
  pageSize?: number;
  searchPlaceholder?: string;
  onRowClick?: (row: T) => void;
  /** Optional per-row class (e.g. a background tint for rows that
   *  need to stand out). When it returns a value, it fully owns the
   *  row's background + hover; rows it skips fall back to the default
   *  hover treatment. */
  rowClassName?: (row: T) => string | undefined;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  isLoading = false,
  pageSize = 20,
  searchPlaceholder = "Search...",
  onRowClick,
  rowClassName,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const searchableKeys = useMemo(
    () => columns.filter((c) => c.searchable).map((c) => c),
    [columns]
  );

  const safeData = Array.isArray(data) ? data : [];

  const filtered = useMemo(() => {
    if (!search.trim()) return safeData;
    const q = search.toLowerCase();
    return safeData.filter((row) =>
      searchableKeys.some((col) => {
        const val = col.accessor
          ? col.accessor(row)
          : (row[col.key] as string | number | null | undefined);
        return val != null && String(val).toLowerCase().includes(q);
      })
    );
  }, [safeData, search, searchableKeys]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    return [...filtered].sort((a, b) => {
      const aVal = col?.accessor ? col.accessor(a) : (a[sortKey] as string);
      const bVal = col?.accessor ? col.accessor(b) : (b[sortKey] as string);
      const aStr = aVal != null ? String(aVal) : "";
      const bStr = bVal != null ? String(bVal) : "";
      const cmp = aStr.localeCompare(bStr, undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));

  // Clamp the page into range at render time rather than storing it —
  // when the row set shrinks under the current page (an external filter
  // like the SUFS/Registrations Select, or a search, cuts the data down
  // while the user is on a later page) an unclamped `page` would slice
  // past the end (empty table) and the pager hides once `totalPages`
  // drops to 1, stranding the user. Deriving avoids a setState-in-effect
  // cascade and never persists an invalid page.
  const safePage = Math.min(page, totalPages - 1);
  const paged = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {searchableKeys.length > 0 && (
        <Input
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          className="max-w-sm"
        />
      )}

      {/* `table-fixed` only when at least one column actually has an
          explicit `width` — otherwise content-based auto-sizing is
          fine. With `fixed`, browsers honour the `w-...` class on the
          first row of cells and distribute leftover space evenly to
          width-less columns; with `auto`, those classes are
          suggestions and content can override them. */}
      <div className="rounded-md border bg-white overflow-hidden">
        <Table
          className={cn(columns.some((c) => c.width) && "table-fixed")}
        >
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-muted/40">
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn(
                    "text-xs font-semibold uppercase tracking-wider text-muted-foreground",
                    col.width,
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center"
                  )}
                >
                  {col.sortable ? (
                    // `flex w-full min-w-0` bounds the button to the
                    // (fixed) cell width so the label span can actually
                    // truncate — an `inline-flex` button sizes to its
                    // content and spills long headers into the next
                    // cell. `justify-*` keeps the label aligned with the
                    // body cells below it; the chevron never shrinks.
                    <button
                      type="button"
                      className={cn(
                        "flex w-full min-w-0 items-center gap-1 hover:text-foreground",
                        col.align === "right" && "justify-end",
                        col.align === "center" && "justify-center"
                      )}
                      onClick={() => toggleSort(col.key)}
                    >
                      <span className="min-w-0 truncate">{col.header}</span>
                      {sortKey === col.key ? (
                        sortDir === "asc" ? (
                          <ChevronUp className="size-3.5 shrink-0" />
                        ) : (
                          <ChevronDown className="size-3.5 shrink-0" />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3.5 opacity-40 shrink-0" />
                      )}
                    </button>
                  ) : (
                    <span className="block truncate">{col.header}</span>
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  No results found.
                </TableCell>
              </TableRow>
            ) : (
              paged.map((row, i) => (
                <TableRow
                  key={i}
                  className={cn(
                    onRowClick && "cursor-pointer",
                    // A custom row class owns the background + hover;
                    // otherwise fall back to the default hover tint.
                    rowClassName?.(row) ?? "hover:bg-muted/50"
                  )}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={cn(
                        "text-sm truncate",
                        col.width,
                        col.align === "right" && "text-right",
                        col.align === "center" && "text-center"
                      )}
                    >
                      {col.render
                        ? col.render(row)
                        : String(row[col.key] ?? "")}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Showing {safePage * pageSize + 1}–
            {Math.min((safePage + 1) * pageSize, sorted.length)} of{" "}
            {sorted.length}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
