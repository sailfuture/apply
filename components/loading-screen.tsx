"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const DEFAULT_MESSAGES = [
  "Loading your application...",
  "Collecting your details...",
  "Almost there...",
];

interface LoadingScreenProps {
  messages?: string[];
  intervalMs?: number;
  className?: string;
  spinnerClassName?: string;
}

/**
 * Centered spinner with cycling loading text. Used by the top-level
 * loading boundaries (post-sign-in resolution, dashboard / admin
 * segment transitions, layout hydration gates) where the wait can
 * exceed a couple of seconds and a bare spinner reads as a stall.
 *
 * The text advances on `intervalMs` and stops on the final message —
 * we don't loop, because looping back to "Loading..." after "Almost
 * there..." actively undermines the reassurance.
 */
export function LoadingScreen({
  messages = DEFAULT_MESSAGES,
  intervalMs = 2200,
  className,
  spinnerClassName,
}: LoadingScreenProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (messages.length <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i < messages.length - 1 ? i + 1 : i));
    }, intervalMs);
    return () => clearInterval(id);
  }, [messages.length, intervalMs]);

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
    </div>
  );
}
