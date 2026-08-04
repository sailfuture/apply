"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 1–5 clickable star scale — the admin's gut-feel conversion rating,
 * shared by the Inquiries and All Leads pages (and read-only in the
 * messaging composers). Filled amber up to `value`; clicking a star
 * writes that value, and clicking the current rating again clears it
 * back to 0 (unrated). Omit `onChange` for a read-only display.
 *
 * Hovering previews the rating you'd set: stars 1..N fill dark gray
 * (the STAR shape itself, no block background), so hovering the 5th
 * star lights all five and hovering the 3rd lights the first three.
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
  const [hover, setHover] = useState(0);
  const interactive = Boolean(onChange) && !disabled;
  const previewing = interactive && hover > 0;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseLeave={() => setHover(0)}
      // `flex w-fit` (block-level), NOT `inline-flex`: table cells
      // truncate with text-overflow, and an inline star row that
      // brushes the cell edge rendered a stray "…" dot after the
      // stars. Block children never get the ellipsis.
      className={cn("flex w-fit items-center gap-0.5", className)}
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
          disabled={!interactive}
          onClick={() => onChange?.(n === value ? 0 : n)}
          onMouseEnter={() => {
            if (interactive) setHover(n);
          }}
          className={cn(
            "p-0.5",
            interactive
              ? "cursor-pointer transition-transform hover:scale-110"
              : "cursor-default"
          )}
        >
          <Star
            className={cn(
              "size-4 transition-colors",
              previewing
                ? n <= hover
                  ? "fill-gray-400 text-gray-400"
                  : "text-muted-foreground/30"
                : n <= value
                  ? "fill-amber-400 text-amber-400"
                  : "text-muted-foreground/30"
            )}
          />
        </button>
      ))}
    </div>
  );
}
