"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shared invite-status affordances for parent / guardian rows.
 *
 * A contact counts as "accepted" once it carries a Clerk linkage —
 * either `clerk_user_id` is set (the row was claimed on sign-up) or
 * `invite_status` reads "active" (the webhook stamped it). Everything
 * else is treated as still-pending, which is the state the resend
 * button acts on.
 */
export function isInviteAccepted(p: {
  invite_status?: string | null;
  clerk_user_id?: string | null;
}): boolean {
  return (p.clerk_user_id ?? "") !== "" || (p.invite_status ?? "") === "active";
}

/** Green "Active" / amber "Invite pending" pill. Colors match the
 *  existing badge on the standalone family page so the states read the
 *  same everywhere. */
export function InviteStatusBadge({
  status,
  clerkUserId,
  className,
}: {
  status?: string | null;
  clerkUserId?: string | null;
  className?: string;
}) {
  const accepted = isInviteAccepted({
    invite_status: status,
    clerk_user_id: clerkUserId,
  });
  return (
    <Badge
      variant="secondary"
      className={cn(
        accepted
          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
          : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
        className
      )}
    >
      {accepted ? "Active" : "Invite pending"}
    </Badge>
  );
}

/**
 * "Resend invite" button. Renders nothing once the contact has
 * accepted — the badge carries that state and there's nothing left to
 * send, which is the client-side half of the "can't invite an
 * already-active contact" guard. While pending it POSTs to the resend
 * endpoint (admin or parent-facing), which is idempotent: it can't
 * create a duplicate parent or a second live Clerk invite no matter
 * how many times it's clicked.
 */
export function ResendInviteButton({
  parentId,
  admin = false,
  status,
  clerkUserId,
  onResent,
  size = "sm",
  variant = "outline",
  className,
}: {
  parentId: number;
  /** Hit the admin endpoint (`requireAdmin`) instead of the
   *  ownership-checked parent-facing one. */
  admin?: boolean;
  status?: string | null;
  clerkUserId?: string | null;
  /** Called after a successful send so the caller can refetch — used
   *  to flip a self-healed row to its Active state. */
  onResent?: (result: { status: "active" | "pending" }) => void;
  size?: "xs" | "sm" | "default";
  variant?: "outline" | "ghost" | "secondary";
  className?: string;
}) {
  const [sending, setSending] = useState(false);

  // Auto-hide once accepted — mirrors the server guard.
  if (isInviteAccepted({ invite_status: status, clerk_user_id: clerkUserId })) {
    return null;
  }

  async function run() {
    setSending(true);
    try {
      const endpoint = admin
        ? `/api/admin/parents/${parentId}/invite`
        : `/api/parents/${parentId}/invite`;
      const res = await fetch(endpoint, { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { status?: "active" | "pending"; message?: string; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(body?.error ?? `Couldn't send invite (${res.status})`);
      }
      toast.success(body?.message ?? "Invitation sent.");
      onResent?.({ status: body?.status ?? "pending" });
    } catch (err) {
      console.error("[ResendInviteButton]", err);
      toast.error(err instanceof Error ? err.message : "Couldn't send invite.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={sending}
      onClick={() => void run()}
      className={className}
      aria-label="Resend invitation to this contact"
    >
      {sending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Mail className="size-3.5" />
      )}
      <span className="ml-1.5">Resend invite</span>
    </Button>
  );
}
