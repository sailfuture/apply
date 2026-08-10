import { cn } from "@/lib/utils";

/** Letter grades used for device condition at pickup/return. */
export const LAPTOP_CONDITIONS = ["A", "B", "C", "D", "F"] as const;

/** Circular letter-grade chip — blue for like-new, shifting warm as
 *  the condition degrades. Matches the staff checkout system's
 *  grading so the two surfaces read the same. */
export function ConditionBadge({
  condition,
  className,
}: {
  condition: string;
  className?: string;
}) {
  const letter = (condition || "").trim().toUpperCase();
  if (!letter) return <span className="text-muted-foreground">—</span>;
  const tone =
    letter === "A" || letter === "B"
      ? "bg-blue-50 text-blue-700 ring-blue-200"
      : letter === "C"
        ? "bg-amber-50 text-amber-700 ring-amber-200"
        : "bg-red-50 text-red-700 ring-red-200";
  return (
    <span
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold ring-1",
        tone,
        className
      )}
    >
      {letter}
    </span>
  );
}

/** "May 29, 2026" from unix ms; em-dash when unset. */
export function fmtLaptopDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Today as a `<input type="date">` value in local time. */
export function todayInputValue(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/** Local-noon unix ms from a `<input type="date">` value — noon so
 *  the stored instant renders as the same calendar day in any nearby
 *  timezone. 0 when unparsable. */
export function dateInputToMs(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return 0;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime();
}
