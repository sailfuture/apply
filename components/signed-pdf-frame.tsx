"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The first check plus nine more, 2s apart at first and backing off to
 *  8s: about a minute of waiting before "Try again" is offered. */
const MAX_CHECKS = 10;
const FIRST_RETRY_MS = 2000;
const MAX_RETRY_MS = 8000;

type Availability = "checking" | "preparing" | "ready" | "unavailable";

/** True once the download route answers with the PDF itself. Anything
 *  else (a JSON error of any status, a dropped connection) is "not yet". */
async function signedPdfIsReady(src: string): Promise<boolean> {
  try {
    const res = await fetch(src);
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.toLowerCase().startsWith("application/pdf")) {
      return false;
    }
    // Read the file through rather than drop it after the headers. The
    // route marks a signed PDF cacheable for an hour; a response that
    // was read to the end is one the browser can keep, so a return
    // visit can pass this check without going back to PandaDoc.
    await res.blob();
    return true;
  } catch {
    return false;
  }
}

/**
 * The signed copy of a PandaDoc document, shown inline, with its
 * Download button underneath.
 *
 * `/api/pandadoc/download` can't always hand over the PDF the moment a
 * document reads as signed: PandaDoc takes a little while to produce the
 * file, and a page that latches "signed" optimistically can ask before
 * the row says so. In that window the route answers with a JSON error.
 * An <iframe> pointed straight at the route showed that JSON to the
 * parent as raw text and kept showing it until a reload, and the
 * Download link led to the same error.
 *
 * So the URL is checked with `fetch` first, and the frame and the
 * download link only exist once it answers with a PDF. Until then the
 * parent sees a plain waiting state, and after about a minute a
 * "Try again" instead of a spinner that never ends.
 */
export function SignedPdfFrame({
  src,
  title,
  downloadName,
  loadingLabel = "Loading signed document...",
}: {
  /** The `/api/pandadoc/download?...` URL of a document the page holds
   *  to be signed. */
  src: string;
  /** Accessible name of the frame. */
  title: string;
  /** File name the Download button saves under. */
  downloadName: string;
  /** Shown during the first check and while the frame itself loads. */
  loadingLabel?: string;
}) {
  // "Try again" starts a fresh round of checks for the same URL.
  const [round, setRound] = useState(0);
  const checkKey = `${round}:${src}`;
  // What the checks found, and whether the frame has loaded, each tagged
  // with the round it belongs to. A value left over from another URL or
  // an earlier round simply doesn't match, so nothing needs resetting
  // when either changes.
  const [found, setFound] = useState<{
    key: string;
    availability: Exclude<Availability, "checking">;
  } | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const availability: Availability =
    found?.key === checkKey ? found.availability : "checking";
  const frameLoaded = loadedKey === checkKey;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let checks = 0;
    let delay = FIRST_RETRY_MS;

    async function check() {
      timer = null;
      checks += 1;
      const ready = await signedPdfIsReady(src);
      if (cancelled) return;
      if (ready) {
        setFound({ key: checkKey, availability: "ready" });
        return;
      }
      if (checks >= MAX_CHECKS) {
        setFound({ key: checkKey, availability: "unavailable" });
        return;
      }
      setFound({ key: checkKey, availability: "preparing" });
      timer = setTimeout(check, delay);
      delay = Math.min(delay * 1.5, MAX_RETRY_MS);
    }

    // Deferred a tick, so a re-run of this effect (StrictMode, or the
    // URL settling) cancels the pending check instead of sending a
    // second request.
    timer = setTimeout(check, 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [src, checkKey]);

  return (
    <>
      <div
        className="relative rounded-lg border overflow-hidden"
        style={{ height: "70vh" }}
      >
        {availability === "unavailable" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-muted/30 px-6 text-center">
            <p className="max-w-sm text-sm text-muted-foreground">
              Your signed copy isn&apos;t ready to view yet. Please try again
              in a minute, or contact the school if it keeps happening.
            </p>
            <Button
              variant="outline"
              className="bg-white"
              onClick={() => setRound((r) => r + 1)}
            >
              Try again
            </Button>
          </div>
        ) : (
          <>
            {!frameLoaded && (
              <div
                className="absolute inset-0 flex items-center justify-center bg-muted/30 px-6"
                role="status"
              >
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-5 shrink-0 animate-spin" />
                  <span className="text-sm">
                    {availability === "preparing"
                      ? "Your signed copy is being prepared…"
                      : loadingLabel}
                  </span>
                </div>
              </div>
            )}
            {availability === "ready" && (
              <iframe
                src={src}
                onLoad={() => setLoadedKey(checkKey)}
                className={`w-full h-full border-none transition-opacity duration-300 ${
                  frameLoaded ? "opacity-100" : "opacity-0"
                }`}
                title={title}
              />
            )}
          </>
        )}
      </div>

      {/* A link once the PDF is there (a native `<a download>`, so the
          browser saves the file instead of opening a tab over the
          preview). Before that, the same button switched off, so the
          page doesn't jump when it becomes available. */}
      <div className="border-t pt-6 pb-6">
        {availability === "ready" ? (
          <Button asChild variant="outline" className="w-full bg-white">
            <a href={src} download={downloadName}>
              Download Document
            </a>
          </Button>
        ) : (
          <Button variant="outline" className="w-full bg-white" disabled>
            Download Document
          </Button>
        )}
      </div>
    </>
  );
}
