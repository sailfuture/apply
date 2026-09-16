"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useSmsReadStateWriter,
  useUnreadMessagesFeed,
} from "@/components/admin/messages-unread-badge";
import { cn } from "@/lib/utils";

/**
 * Desktop notifications for inbound parent texts.
 *
 * Fires an OS-level notification whenever a conversation's newest
 * inbound message is one we haven't announced yet. Driven by the same
 * `/api/admin/messages/unread` poll that feeds the nav badge, so it
 * costs no extra requests — the notifier just reads that cache.
 *
 * SCOPE: this delivers while the admin app is open in a browser tab
 * (any tab, any admin page — the notifier is mounted globally in the
 * top nav). It is NOT background push: closing every tab stops
 * delivery. True background push needs a service worker, VAPID keys,
 * and a stored subscription per browser; the email alert the Twilio
 * webhook already sends covers the tabs-closed case meanwhile.
 *
 * Announced messages are remembered on the admin's CLERK USER (the
 * `announced` map in `lib/sms/read-state.ts`), keyed by conversation +
 * timestamp, so a reload, a second tab, or the same admin's phone
 * never re-announces a text one of them already popped. On first mount
 * we SEED that record from whatever is currently unread without
 * notifying — otherwise a brand-new admin would get a burst for every
 * outstanding thread.
 */

/** Notifications older than this are never announced — a stale thread
 *  shouldn't pop days later just because it hasn't been seen here
 *  before. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Permission = "default" | "granted" | "denied" | "unsupported";

/**
 * Shared permission store. An external store (rather than per-component
 * state) for two reasons: it reads the browser value without a
 * setState-in-effect, and granting from the toggle immediately wakes
 * the watcher — with independent state the watcher would stay
 * "default" until it happened to remount.
 */
let permissionCache: Permission | null = null;
let permissionListeners: Array<() => void> = [];

function permissionSnapshot(): Permission {
  if (permissionCache === null) {
    permissionCache = !("Notification" in window)
      ? "unsupported"
      : (Notification.permission as Permission);
  }
  return permissionCache;
}

/** Server render has no `Notification`; treat it as unsupported so
 *  markup matches until the client takes over. */
function permissionServerSnapshot(): Permission {
  return "unsupported";
}

function subscribePermission(cb: () => void) {
  permissionListeners.push(cb);
  return () => {
    permissionListeners = permissionListeners.filter((l) => l !== cb);
  };
}

function publishPermission(p: Permission) {
  permissionCache = p;
  for (const l of permissionListeners) l();
}

function usePermission(): Permission {
  return useSyncExternalStore(
    subscribePermission,
    permissionSnapshot,
    permissionServerSnapshot
  );
}

/**
 * Watches the unread feed and raises a desktop notification per new
 * inbound text. Renders nothing — mount it once, globally.
 */
export function SmsNotificationWatcher() {
  const router = useRouter();
  const permission = usePermission();

  // Same SWR key the nav badge uses, so this costs no extra request —
  // and `announced` comes back in the payload already scoped to this
  // admin.
  const { data } = useUnreadMessagesFeed();
  const { markAnnounced } = useSmsReadStateWriter();

  // Seeded on the first payload so a cold start never fires a burst
  // for threads that were already waiting.
  const seededRef = useRef(false);
  // Keys announced in THIS tab, as a guard against the effect running
  // again before the stamp round-trips (a permission change, a poll
  // landing mid-flight) and popping the same text twice.
  const localRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const conversations = data?.conversations;
    if (!conversations) return;
    if (permission !== "granted") return;

    const announced = data.announced;
    const local = localRef.current;
    const seen = (key: string) =>
      Math.max(announced[key] ?? 0, local.get(key) ?? 0);
    const stamps: Array<{ key: string; at: number }> = [];

    if (!seededRef.current) {
      // First payload this session: record everything as already
      // announced, notify for none of it. On a device this admin has
      // used before the server map already covers these, so the stamp
      // is a no-op and nothing is written.
      seededRef.current = true;
      for (const c of conversations) {
        if (seen(c.key) >= c.lastAt) continue;
        local.set(c.key, c.lastAt);
        stamps.push({ key: c.key, at: c.lastAt });
      }
      markAnnounced(stamps);
      return;
    }

    const now = Date.now();
    for (const c of conversations) {
      if (seen(c.key) >= c.lastAt) continue;
      local.set(c.key, c.lastAt);
      stamps.push({ key: c.key, at: c.lastAt });
      if (now - c.lastAt > MAX_AGE_MS) continue;
      try {
        const n = new Notification(`New text from ${c.name}`, {
          body: c.preview || "Open the inbox to read it.",
          // Tag by conversation so several texts from one parent
          // collapse into a single notification instead of stacking.
          tag: `sms-${c.key}`,
          icon: "/favicon.ico",
        });
        n.onclick = () => {
          window.focus();
          // Deep-link the exact thread — the inbox's cross-page
          // redirect then places it on the enrolled or recruitment
          // page, whichever the contact belongs to. A bare
          // /admin/messages push would strand lead texts on the
          // enrolled-only page.
          router.push(`/admin/messages?open=${encodeURIComponent(c.key)}`);
          n.close();
        };
      } catch (err) {
        console.error("[sms-notifications] failed to notify:", err);
      }
    }
    markAnnounced(stamps);
  }, [data, permission, router, markAnnounced]);

  return null;
}

/**
 * Permission control for the inbox header. The Notification API only
 * grants from a user gesture, so this has to be an explicit button —
 * it can't be requested on page load.
 */
export function SmsNotificationToggle({
  className,
}: {
  className?: string;
}) {
  const permission = usePermission();

  const request = useCallback(async () => {
    if (!("Notification" in window)) return;
    try {
      const result = await Notification.requestPermission();
      publishPermission(result as Permission);
      if (result === "granted") {
        // Immediate confirmation that delivery works — otherwise the
        // admin has no signal until a parent happens to text.
        new Notification("Text alerts are on", {
          body: "You'll get a desktop notification when a parent replies.",
          tag: "sms-enabled",
          icon: "/favicon.ico",
        });
      }
    } catch (err) {
      console.error("[sms-notifications] permission request failed:", err);
    }
  }, []);

  if (permission === "unsupported") return null;

  if (permission === "granted") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
          className
        )}
        title="Desktop alerts are on while this app is open in a tab"
      >
        <BellRing className="size-3.5 text-green-600" />
        Alerts on
      </span>
    );
  }

  if (permission === "denied") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
          className
        )}
        title="Blocked in your browser settings — re-allow notifications for this site to turn them back on"
      >
        <BellOff className="size-3.5" />
        Alerts blocked
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("bg-white", className)}
      onClick={() => void request()}
    >
      <Bell className="size-3.5 mr-1.5" />
      Enable alerts
    </Button>
  );
}
