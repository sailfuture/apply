"use client";

import { AlertCircle } from "lucide-react";
import type { Requirement } from "@/lib/application-schemas";

interface Props {
  /** List of outstanding requirements. Empty list → panel hidden. */
  missing: Requirement[];
  /** Optional label shown above the list. */
  title?: string;
  /**
   * Optional click handler for each missing item. Receives the requirement.
   * Default: if the requirement has a `jumpTo` value, scroll to that element.
   */
  onItemClick?: (req: Requirement) => void;
}

/**
 * Renders an inline, dismissible checklist of outstanding required fields
 * for the current section. Rendered near the top of the section body, below
 * the header. Hidden when there are no missing items.
 */
export function MissingItemsPanel({ missing, title = "Complete to finish this section", onItemClick }: Props) {
  if (missing.length === 0) return null;

  const handleClick = (req: Requirement) => {
    if (onItemClick) {
      onItemClick(req);
      return;
    }
    if (!req.jumpTo) return;
    // Default behavior: scroll the target into view and briefly highlight it.
    const id = req.jumpTo.startsWith("#") ? req.jumpTo.slice(1) : req.jumpTo;
    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("ring-2", "ring-amber-400", "ring-offset-2");
      setTimeout(() => {
        target.classList.remove("ring-2", "ring-amber-400", "ring-offset-2");
      }, 1500);
    }
  };

  return (
    <div
      role="status"
      className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-900/20"
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            {title} <span className="text-amber-700 dark:text-amber-300">({missing.length})</span>
          </p>
          <ul className="mt-2 space-y-1">
            {missing.map((req) => (
              <li key={req.key}>
                <button
                  type="button"
                  onClick={() => handleClick(req)}
                  className="text-left text-xs text-amber-800 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-200 hover:underline underline-offset-2"
                >
                  • {req.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
