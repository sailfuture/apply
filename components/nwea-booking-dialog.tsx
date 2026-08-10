"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Canonical Google Calendar appointment-schedule URL for NWEA testing.
 *
 * This is deliberately NOT the `calendar.app.google/FsBaobZrsRToxuGq9`
 * short link the two booking dialogs used to frame. That short link is
 * a redirector (Google's `DurableDeepLinkUi`) which `Vary`s on
 * `Sec-Fetch-Dest` and answers iframe requests with
 * `X-Frame-Options: SAMEORIGIN` — the exact same URL fetched as a
 * top-level document gets no such header. So the redirect hop is an
 * explicit refusal to be framed, and whether the dialog rendered came
 * down to whether the browser evaluates XFO on redirect responses or
 * only on the committed one. Chrome checks the committed response and
 * let it through; other engines and privacy modes blanked the frame.
 * That's the intermittent failure.
 *
 * The redirect *target* below answers a cross-site iframe request with
 * 200 and no `X-Frame-Options` / no `frame-ancestors`, so it frames
 * cleanly with no redirect hop to trip over. `?gv=true` is the flag
 * Google's own "Embed" share option appends.
 *
 * If the booking page is ever rebuilt in Google Calendar this ID
 * changes — grab the replacement from Calendar's Share → Embed option,
 * not from the "Copy link" button (that yields the short link again).
 */
const NWEA_BOOKING_URL =
  "https://calendar.google.com/calendar/appointments/schedules/AcZssZ0gErnrfDd4IPbZR6ozatnlf6MSegsJ1B6UfKQ7d7JozwjQVabcOinvh5LzxYGq4lJZmWHLmGSl?gv=true";

/** How long to wait for the frame before offering the new-tab escape. */
const LOAD_TIMEOUT_MS = 8000;

/**
 * NWEA testing booking dialog — embeds the Google Calendar appointment
 * schedule.
 *
 * Framing a third-party booking flow can't be made reliable for every
 * parent no matter which URL we point at: Safari blocks third-party
 * cookies outright and Chrome/Firefox partition them, which can leave
 * the frame rendered but the time-slot grid empty or the final submit
 * failing. So the new-tab escape hatch is always visible rather than
 * only appearing after a detected failure — a parent who sees an empty
 * grid has a way out without knowing why.
 */
export function NweaBookingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[95vw] w-[95vw] h-[90vh] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0 pr-14">
          <DialogTitle>Schedule NWEA Testing</DialogTitle>
          <DialogDescription>
            Select a date and time to complete NWEA testing at SailFuture
            Academy.
          </DialogDescription>
        </DialogHeader>

        {/* Escape hatch. Always visible — see the component note: a
            blocked or cookie-starved frame can look loaded, so we
            can't reliably detect the failure and reveal this only
            when it happens. */}
        <div className="px-6 pb-2 shrink-0">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="bg-white h-8 text-xs"
          >
            <a
              href={NWEA_BOOKING_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="size-3.5 mr-1.5 shrink-0" />
              Calendar not loading? Open booking page in a new tab
            </a>
          </Button>
        </div>

        <BookingFrame />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The frame itself, split out so the load watchdog is tied to mount.
 * Radix unmounts dialog content on close, so every open remounts this
 * and restarts the timer — no `open`-keyed effect needed.
 */
function BookingFrame() {
  const [status, setStatus] = useState<"loading" | "loaded" | "timeout">(
    "loading"
  );

  useEffect(() => {
    // Functional update so a load that already landed wins the race —
    // otherwise the timer would drop the overlay over a working
    // calendar.
    const t = setTimeout(
      () => setStatus((s) => (s === "loading" ? "timeout" : s)),
      LOAD_TIMEOUT_MS
    );
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="relative flex-1 m-6 mt-0 overflow-hidden rounded-lg border">
      <iframe
        src={NWEA_BOOKING_URL}
        className="h-full w-full border-0"
        title="Schedule NWEA Testing"
        onLoad={() => setStatus("loaded")}
      />
      {status === "timeout" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 p-6 text-center">
          <p className="text-sm font-medium">
            The booking calendar is taking longer than expected to load.
          </p>
          <p className="text-sm text-muted-foreground max-w-md">
            Your browser&apos;s privacy settings may be blocking it. Open the
            booking page in a new tab to schedule — it works the same way
            there.
          </p>
          <Button asChild size="sm">
            <a href={NWEA_BOOKING_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4 mr-1.5 shrink-0" />
              Open booking page
            </a>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
