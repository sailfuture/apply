"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { GraduationCap, Loader2, Search, UserRound, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { adminFetcher } from "@/lib/admin-fetcher";
import type { AdminSearchIndex } from "@/app/api/admin/search/route";

/**
 * Dashboard quick search — one box that finds any student, parent,
 * or family by name, email, or phone and jumps to the right detail
 * page. The full index loads once on first focus (Xano can't search
 * server-side, and the whole school fits in one payload), then every
 * keystroke filters locally for instant results.
 *
 * Navigation targets: families → family detail; parents → their
 * family's detail; enrolled students → the enrolled student detail
 * (needs a year in context), everyone else → their family detail.
 * The current `?yearId=` is propagated so the destination pages keep
 * the year picker's context.
 */

interface ResultItem {
  key: string;
  kind: "student" | "parent" | "family";
  title: string;
  subtitle: string;
  badge?: "enrolled" | "unenrolled";
  href: string;
}

const GROUP_LIMIT = 6;

export function DashboardSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  // The index only fetches after the admin first focuses the box —
  // no point paying for three Xano list calls on every dashboard
  // visit that never searches.
  const [armed, setArmed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useSWR<AdminSearchIndex>(
    armed ? "/api/admin/search" : null,
    adminFetcher,
    { revalidateOnFocus: false }
  );

  // Close when clicking anywhere outside the search container.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const withYear = (href: string) =>
    yearId ? `${href}${href.includes("?") ? "&" : "?"}yearId=${yearId}` : href;

  const results = useMemo<ResultItem[]>(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    // Every whitespace token must match somewhere in the haystack, so
    // "hunter thom" finds Hunter Thompson. Phone queries match on
    // digits alone ("(727) 555" ↔ 7275550123).
    const tokens = q.split(/\s+/).filter(Boolean);
    const qDigits = q.replace(/\D/g, "");
    const matches = (haystack: string, digits = "") =>
      tokens.every((t) => haystack.includes(t)) ||
      (qDigits.length >= 4 && digits.includes(qDigits));

    const students = data.students
      .filter((s) =>
        matches(`${s.name} ${s.family_name}`.toLowerCase())
      )
      .slice(0, GROUP_LIMIT)
      .map<ResultItem>((s) => ({
        key: `student-${s.id}`,
        kind: "student",
        title: s.name,
        subtitle: s.family_name,
        badge: s.is_enrolled
          ? "enrolled"
          : s.is_archived
            ? "unenrolled"
            : undefined,
        // The enrolled detail page needs a year in context; without
        // one (or for non-enrolled students) the family page is the
        // best landing spot.
        href:
          s.is_enrolled && yearId
            ? withYear(`/admin/enrolled/${s.id}`)
            : s.family_id
              ? withYear(`/admin/families/${s.family_id}`)
              : withYear(`/admin/enrolled/${s.id}`),
      }));

    const parents = data.parents
      .filter((p) =>
        matches(
          `${p.name} ${p.email} ${p.family_name}`.toLowerCase(),
          p.phone.replace(/\D/g, "")
        )
      )
      .slice(0, GROUP_LIMIT)
      .map<ResultItem>((p) => ({
        key: `parent-${p.id}`,
        kind: "parent",
        title: p.name,
        subtitle: [p.email, p.family_name].filter(Boolean).join(" · "),
        href: p.family_id
          ? withYear(`/admin/families/${p.family_id}`)
          : "#",
      }))
      .filter((p) => p.href !== "#");

    const families = data.families
      .filter((f) =>
        matches(`${f.name} ${f.student_names}`.toLowerCase())
      )
      .slice(0, GROUP_LIMIT)
      .map<ResultItem>((f) => ({
        key: `family-${f.id}`,
        kind: "family",
        title: f.name,
        subtitle: f.student_names,
        href: withYear(`/admin/families/${f.id}`),
      }));

    return [...students, ...parents, ...families];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, query, yearId]);

  // Reset keyboard cursor whenever the result set changes.
  useEffect(() => setActiveIndex(0), [query]);

  function go(item: ResultItem | undefined) {
    if (!item) return;
    setOpen(false);
    setQuery("");
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      e.currentTarget.blur();
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[activeIndex]);
    }
  }

  const showPanel = open && query.trim().length >= 2;
  const grouped: Array<{ label: string; items: ResultItem[] }> = [
    {
      label: "Students",
      items: results.filter((r) => r.kind === "student"),
    },
    { label: "Parents", items: results.filter((r) => r.kind === "parent") },
    {
      label: "Families",
      items: results.filter((r) => r.kind === "family"),
    },
  ].filter((g) => g.items.length > 0);

  return (
    <div ref={containerRef} className="relative max-w-xl">
      <Search
        className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60"
        aria-hidden="true"
      />
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setArmed(true);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder="Search students, parents, families…"
        className="h-10 bg-white pl-9"
        role="combobox"
        aria-expanded={showPanel}
        aria-label="Quick search"
      />
      {showPanel ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-lg border bg-white shadow-lg">
          {isLoading && !data ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading directory…
            </div>
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No matches for &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto overscroll-contain py-1">
              {grouped.map((group) => (
                <div key={group.label}>
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </p>
                  {group.items.map((item) => {
                    const flatIndex = results.indexOf(item);
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => go(item)}
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2 text-left",
                          flatIndex === activeIndex && "bg-muted/60"
                        )}
                      >
                        {item.kind === "student" ? (
                          <GraduationCap className="size-4 shrink-0 text-muted-foreground" />
                        ) : item.kind === "parent" ? (
                          <UserRound className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <Users className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {item.title}
                          </span>
                          {item.subtitle ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {item.subtitle}
                            </span>
                          ) : null}
                        </span>
                        {item.badge === "enrolled" ? (
                          <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                            Enrolled
                          </span>
                        ) : item.badge === "unenrolled" ? (
                          <span className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            Unenrolled
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
