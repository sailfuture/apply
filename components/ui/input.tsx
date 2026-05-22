import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, onWheel, ...props }: React.ComponentProps<"input">) {
  // Browser default: scrolling on a focused `<input type="number">`
  // increments/decrements the value. That's a foot-gun — admins
  // editing tuition figures or SUFS amounts can scroll the page
  // and silently wipe their numbers. Blur the input on wheel so
  // the scroll moves the page instead. Side benefit: the onBlur
  // save handler fires, which is the user's intent when they're
  // moving on from the field. Consumers that pass their own
  // `onWheel` still get it called.
  const handleWheel = React.useCallback(
    (event: React.WheelEvent<HTMLInputElement>) => {
      if (
        type === "number" &&
        typeof document !== "undefined" &&
        document.activeElement === event.currentTarget
      ) {
        event.currentTarget.blur();
      }
      onWheel?.(event);
    },
    [type, onWheel]
  );

  return (
    <input
      type={type}
      onWheel={handleWheel}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2.5 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:my-0.5 file:mr-3 file:inline-flex file:h-7 file:cursor-pointer file:rounded-md file:border file:border-input file:bg-background file:px-3 file:text-sm file:font-medium file:text-foreground file:transition-colors hover:file:bg-muted placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
