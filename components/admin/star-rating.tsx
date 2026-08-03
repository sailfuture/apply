"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 1–5 clickable star scale — the admin's gut-feel conversion rating,
 * shared by the Inquiries and All Leads pages (and read-only in the
 * messaging composers). Filled amber up to `value`; clicking a star
 * writes that value, and clicking the current rating again clears it
 * back to 0 (unrated). Omit `onChange` for a read-only display.
 */
export function StarRating({
  value,
  onChange,
  disabled,
  className,
}: {
  value: number;
  onChange?: (v: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={cn("inline-flex items-center gap-0.5", className)}
      role="radiogroup"
      aria-label="Interest level"
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          title={value === n ? "Click again to clear" : undefined}
          disabled={disabled || !onChange}
          onClick={() => onChange?.(n === value ? 0 : n)}
          className={cn(
            "p-0.5",
            onChange && !disabled
              ? "cursor-pointer transition-transform hover:scale-110"
              : "cursor-default"
          )}
        >
          <Star
            className={cn(
              "size-4",
              n <= value
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/30"
            )}
          />
        </button>
      ))}
    </div>
  );
}
