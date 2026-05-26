"use client";

import { useEffect, useState } from "react";
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
  // `mounted` defers the sessionStorage read to the client. The
  // server-rendered HTML is just the spinner; the text fades in once
  // we've reconciled with whatever progress earlier loading screens
  // logged this session. Avoids a hydration mismatch on the text
  // node.
  const [mounted, setMounted] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const now = Date.now();
    const session = readSession();
    let startedAt: number;
    if (!session || now - session.lastTick > HEARTBEAT_STALE_MS) {
      startedAt = now;
    } else {
      startedAt = session.startedAt;
    }
    const initial = computeIndex(now - startedAt, intervalMs, messages.length);
    writeSession({ startedAt, lastTick: now });
    setIndex(initial);
    setMounted(true);
  }, [intervalMs, messages.length]);

  useEffect(() => {
    if (!mounted) return;
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
  }, [mounted, intervalMs, messages.length]);

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
      {mounted && (
        <AnimatePresence mode="wait">
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
  );
}
