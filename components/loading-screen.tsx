"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * Default sequence used by every parent-flow loading boundary
 * (root, dashboard segment, layout hydration gates, page-level SWR
 * spinners). Sized to span ~7 seconds before settling on "Almost
 * there..." so realistic post-sign-in waits stay reassured the whole
 * way through.
 */
export const LOGIN_FLOW_MESSAGES = [
  // Deliberately generic — enrolled parents see this same sequence,
  // and "your application" reads like admissions paperwork to them.
  "Loading...",
  "Collecting your details...",
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

/**
 * How long one continuous loading sequence (shared across the
 * back-to-back loaders via sessionStorage, so the sign-in chain counts
 * as one) may run before the screen admits it and offers a reload.
 * The message sequence settles on "Almost there..." at ~7s; a healthy
 * cold sign-in is done well before this. Past it, the parent is far
 * more likely to be stuck — a fetch that gave up, a wedged client
 * navigation — than waiting on real work, and a reload is exactly what
 * fixes those. Until this existed the spinner gave them no hint.
 */
const SLOW_AFTER_MS = 12000;

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

/** Milliseconds the current loading sequence has been running, per the
 *  sessionStorage session (0 on the server, or when the last loader's
 *  heartbeat is stale enough to count as a fresh sequence). */
function sessionElapsedMs(): number {
  if (typeof window === "undefined") return 0;
  const now = Date.now();
  const session = readSession();
  if (!session || now - session.lastTick > HEARTBEAT_STALE_MS) return 0;
  return now - session.startedAt;
}

/** Full reload, after dropping the shared sequence so the fresh page
 *  starts at "Loading..." instead of inheriting a 12s-old clock (and
 *  the reload offer with it) when the document comes back quickly. */
function reloadPage() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  window.location.reload();
}

interface LoadingScreenProps {
  messages?: string[];
  intervalMs?: number;
  className?: string;
  spinnerClassName?: string;
  /** Milliseconds of continuous loading before the "taking longer than
   *  usual" note + Reload button appear. `null` disables them. */
  slowAfterMs?: number | null;
}

/**
 * Centered spinner with cycling loading text. Persists progress
 * across remounts via sessionStorage — the post-sign-in flow renders
 * three back-to-back loading screens (root segment, dashboard
 * segment, page-level SWR), and without persistence each one would
 * restart from "Loading..." while the user keeps waiting on the
 * same underlying work.
 *
 * Sequence stops on the final message — looping back to "Loading..."
 * after "Almost there..." reads as a regression.
 */
export function LoadingScreen({
  messages = LOGIN_FLOW_MESSAGES,
  intervalMs = 2200,
  className,
  spinnerClassName,
  slowAfterMs = SLOW_AFTER_MS,
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
  const [index, setIndex] = useState(() =>
    computeIndex(sessionElapsedMs(), intervalMs, messages.length),
  );
  // Whether the sequence has run long enough to offer a reload. Seeded
  // from the shared clock like `index`, so a loader that mounts late in
  // an already-long sequence shows the offer at once.
  const [slow, setSlow] = useState(
    () => slowAfterMs !== null && sessionElapsedMs() >= slowAfterMs,
  );

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
      const elapsed = Date.now() - startedAt;
      setIndex(computeIndex(elapsed, intervalMs, messages.length));
      if (slowAfterMs !== null) setSlow(elapsed >= slowAfterMs);
      writeSession({ startedAt, lastTick: Date.now() });
    }, Math.min(intervalMs, 500));

    return () => {
      clearInterval(heartbeatId);
      clearInterval(advanceId);
    };
  }, [hydrated, intervalMs, messages.length, slowAfterMs]);

  return (
    // `relative` anchors the slow-load note below the spinner + text
    // without pushing them: the note is absolutely positioned under the
    // block, so the spinner stays exactly where it was when it appears.
    <div
      className={cn(
        "relative flex flex-col items-center justify-center gap-4",
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
      {hydrated && slow && (
        // The escape hatch for a spinner that never resolves. Whatever
        // wedged the page — a fetch that exhausted its retries without
        // reaching an error state, a client navigation that lost its
        // result — a full document load starts over from a clean
        // slate, which is what parents were doing by hand.
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="absolute top-full mt-3 flex w-max flex-col items-center gap-2 text-center"
        >
          <p className="text-xs text-muted-foreground">
            This is taking longer than usual.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reloadPage}
          >
            Reload page
          </Button>
        </motion.div>
      )}
    </div>
  );
}
