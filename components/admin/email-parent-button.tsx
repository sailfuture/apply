"use client";

import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { INTERNAL_CC_EMAILS } from "@/lib/emails/recipients";

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
 * primary parent as `To`, a pre-filled subject, and a `Cc` that always
 * includes the internal awareness inboxes (admissions@ + dean@, from
 * `INTERNAL_CC_EMAILS`) plus the secondary parent when present. The
 * internal CCs mirror the default CC the app's automated Resend sends
 * already apply, so admin-drafted parent mail has the same internal
 * visibility. Nothing is sent automatically — the admin writes the
 * body and sends from their own client.
 */
export function EmailParentButton({
  primaryEmail,
  secondaryEmail,
  subject,
  label = "Email parent",
  className,
}: EmailParentButtonProps) {
  const to = (primaryEmail ?? "").trim();
  const secondary = (secondaryEmail ?? "").trim();

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

  // CC list for the draft: always the internal awareness inboxes
  // (admissions + dean), plus the secondary parent when present.
  // Dedupe case-insensitively and drop the To address so the same
  // address never lands in both To and Cc.
  const ccSeen = new Set<string>([to.toLowerCase()]);
  const ccList: string[] = [];
  for (const addr of [secondary, ...INTERNAL_CC_EMAILS]) {
    const cleaned = addr.trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || ccSeen.has(key)) continue;
    ccSeen.add(key);
    ccList.push(cleaned);
  }

  // Build the query manually so spaces encode as %20 (mailto clients
  // mishandle the `+` that URLSearchParams would emit in the subject).
  // Each CC address is encoded individually while the commas between
  // them stay literal — that's mailto's multi-address separator. The
  // `To` address stays raw to match the app's other mailto links.
  const query = [
    ccList.length
      ? `cc=${ccList.map((addr) => encodeURIComponent(addr)).join(",")}`
      : null,
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
