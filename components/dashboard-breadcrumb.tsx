"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface Item {
  label: string;
  href?: string;
}

/**
 * Breadcrumb trail used across the dashboard sub-pages. Pairs with the
 * large "← Back" button rendered above it on every detail view, so the
 * parent has both a one-click jump back and a sense of where they are.
 */
export function DashboardBreadcrumb({ items }: { items: Item[] }) {
  return (
    <nav aria-label="Breadcrumb">
      {/* Styled to match the small-caps section label used elsewhere on
          the apply flow — uppercase, tracked, muted. The current page
          (last item) gets the foreground color so it stands out. */}
      <ol className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5">
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="hover:text-foreground transition-colors"
                >
                  {item.label}
                </Link>
              ) : (
                <span className={last ? "text-foreground" : ""}>
                  {item.label}
                </span>
              )}
              {!last ? (
                <ChevronRight className="size-3 text-muted-foreground/60" aria-hidden="true" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
