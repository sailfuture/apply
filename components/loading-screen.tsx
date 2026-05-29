"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * Default sequence used by every parent-flow loading boundary
 * (root, dashboard segment, layout hydration gates, page-level SWR
 * spinners). Sized to span ~9 seconds before settling on "Almost
 * there..." so realistic post-sign-in waits stay reassured the whole
 * way through.
 */
export const LOGIN_FLOW_MESSAGES = [
  "Loading your application...",
  "Collecting your details...",
  "Loading student details...",
  "Getting things ready...",
  "Almost there...",
];

const STORAGE_KEY = "loading-screen-session";

/**
 * If no LoadingScreen has heartbeat-pinged sessionStorage in this
 * long, the next mount treats itself as a fresh sequence. Keeps the
 * sequence flowing across the 3 back-to-back spinners of the
 * sign-in chain (each remount happens within ~tens of ms) while
 * resetting to "Loading..." on a navigation that comes minutes later.
 */
const HEARTBEAT_STALE_MS = 1500;

/** No-op subscribe for the client-detection probe in LoadingScreen. The
 *  "are we on the client yet" signal flips exactly once and never again,
 *  so there's no external store to subscribe to. */
const subscribeNoop = () => () => {};

interface SessionState {
  startedAt: number;
  lastTick: number;
}

function readSession(): SessionState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionState;
    if (
      typeof parsed?.startedAt !== "number" ||
      typeof parsed?.lastTick !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(state: SessionState) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function computeIndex(elapsedMs: number, intervalMs: number, count: number) {
  if (count <= 1) return 0;
  return Math.min(Math.floor(elapsedMs / intervalMs), count - 1);
}

interface LoadingScreenProps {
  messages?: string[];
  intervalMs?: number;
  className?: string;
  spinnerClassName?: string;
}

/**
 * Centered spinner with cycling loading text. Persists progress
 * across remounts via sessionStorage — the post-sign-in flow renders
 * three back-to-back loading screens (root segment, dashboard
 * segment, page-level SWR), and without persistence each one would
 * restart from "Loading your application..." while the user keeps
 * waiting on the same underlying work.
 *
 * Sequence stops on the final message — looping back to "Loading..."
 * after "Almost there..." reads as a regression.
 */
export function LoadingScreen({
  messages = LOGIN_FLOW_MESSAGES,
  intervalMs = 2200,
  className,
  spinnerClassName,
}: LoadingScreenProps) {
  // Defer the text to the client for hydration safety: sessionStorage
  // isn't readable on the server, so the index there is always 0 and
  // server-rendering the text would risk a mismatch. `useSyncExternalStore`
  // returns the server snapshot (false) only during the FIRST loader's
  // hydration render — matching the SSR HTML (spinner only) — then flips
  // to true. Every *later* loader in the sign-in chain is a fresh client
  // mount, so it reads true synchronously on its first render and paints
  // its text immediately, never blanking at the handoff.
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const [index, setIndex] = useState(() => {
    if (typeof window === "undefined") return 0;
    const now = Date.now();
    const session = readSession();
    const startedAt =
      !session || now - session.lastTick > HEARTBEAT_STALE_MS
        ? now
        : session.startedAt;
    return computeIndex(now - startedAt, intervalMs, messages.length);
  });

  useEffect(() => {
    // Record this mount in sessionStorage so a sibling LoadingScreen
    // that takes over within HEARTBEAT_STALE_MS picks up the sequence
    // mid-stream instead of restarting.
    const now = Date.now();
    const session = readSession();
    const startedAt =
      !session || now - session.lastTick > HEARTBEAT_STALE_MS
        ? now
        : session.startedAt;
    writeSession({ startedAt, lastTick: now });
  }, [intervalMs, messages.length]);

  useEffect(() => {
    if (!hydrated) return;
    // Heartbeat — keeps the session "live" so a sibling LoadingScreen
    // mounting milliseconds after this one unmounts continues the
    // sequence instead of resetting.
    const heartbeatId = setInterval(() => {
      const session = readSession();
      if (!session) return;
      writeSession({ ...session, lastTick: Date.now() });
    }, 500);

    // Advance — anchored to wall-clock elapsed time so two consumers
    // with mismatched message-count don't drift.
    const advanceId = setInterval(() => {
      const session = readSession();
      const startedAt = session?.startedAt ?? Date.now();
      const next = computeIndex(
        Date.now() - startedAt,
        intervalMs,
        messages.length,
      );
      setIndex(next);
      writeSession({ startedAt, lastTick: Date.now() });
    }, Math.min(intervalMs, 500));

    return () => {
      clearInterval(heartbeatId);
      clearInterval(advanceId);
    };
  }, [hydrated, intervalMs, messages.length]);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Spinner
        className={cn("size-8 text-muted-foreground", spinnerClassName)}
      />
      {/* Reserve the text line's height even before the first message
          renders (and during the single pre-hydration frame of the first
          loader) so the spinner stays put — no vertical jitter as the
          text appears or as one loader hands off to the next. */}
      <div className="flex min-h-5 items-center justify-center">
        {hydrated && (
          // `initial={false}` suppresses the enter animation on an
          // AnimatePresence's first render. So a freshly-mounted loader
          // paints its current message instantly (continuing the
          // sequence the previous loader was on) instead of fading in
          // from zero again — only genuine message *changes* within a
          // single loader's lifetime crossfade.
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={index}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="text-sm text-muted-foreground"
            >
              {messages[index]}
            </motion.p>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
