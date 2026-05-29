"use client";

import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmailParentButtonProps {
  /** Primary parent's email — the `To:` recipient. When blank the
   *  button renders disabled (a mailto with an empty `To` opens a
   *  confusing blank draft). */
  primaryEmail?: string | null;
  /** Secondary parent's email — added as `Cc:` when present. */
  secondaryEmail?: string | null;
  /** Pre-filled subject line. */
  subject: string;
  /** Button label. Defaults to "Email parent". */
  label?: string;
  /** Forwarded to the underlying Button (header neighbors use
   *  `bg-white`, so callers pass that for a matching look). */
  className?: string;
}

/**
 * Header action that drafts an email to a family's parents.
 *
 * Opens the admin's default mail client via a `mailto:` link with the
 * primary parent as `To`, the secondary parent (if any) as `Cc`, and a
 * pre-filled subject. Nothing is sent automatically — the admin writes
 * the body and sends from their own client. Matches the existing
 * `mailto:` links elsewhere in the admin (inquiries, family overview).
 */
export function EmailParentButton({
  primaryEmail,
  secondaryEmail,
  subject,
  label = "Email parent",
  className,
}: EmailParentButtonProps) {
  const to = (primaryEmail ?? "").trim();
  const cc = (secondaryEmail ?? "").trim();

  if (!to) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className}
        disabled
        title="No parent email on file"
      >
        <Mail className="size-3.5 mr-1.5" aria-hidden="true" />
        {label}
      </Button>
    );
  }

  // Build the query manually so spaces encode as %20 (mailto clients
  // mishandle the `+` that URLSearchParams would emit in the subject).
  // The `To` address stays raw to match the app's other mailto links.
  const query = [
    cc ? `cc=${encodeURIComponent(cc)}` : null,
    `subject=${encodeURIComponent(subject)}`,
  ]
    .filter(Boolean)
    .join("&");
  const href = `mailto:${to}?${query}`;

  return (
    <Button asChild variant="outline" size="sm" className={className}>
      <a href={href}>
        <Mail className="size-3.5 mr-1.5" aria-hidden="true" />
        {label}
      </a>
    </Button>
  );
}
