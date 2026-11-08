"use client";

import { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

/**
 * Sign-out button for the /student-account explanation page. Lands on
 * /sign-in so a parent who used a student's Google account by mistake
 * can go straight back in with their own email.
 */
export function StudentAccountSignOut() {
  const { signOut } = useClerk();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await signOut({ redirectUrl: "/sign-in" });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </Button>
  );
}
