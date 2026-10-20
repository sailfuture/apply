"use client";

import { useState } from "react";
import { Download, FileText, ImageOff, Paperclip } from "lucide-react";
import {
  isImageMedia,
  mediaKindLabel,
  smsMedia,
  smsMediaUrl,
} from "@/lib/sms/media";
import type { SmsMediaItem, XanoSmsMessage } from "@/lib/xano";
import { cn } from "@/lib/utils";

/**
 * The photos and files on a text, under its bubble — shared by the
 * messenger thread, the activity log sheet and the lead notes so a
 * photo looks the same wherever the text is shown.
 *
 * Everything loads through the admin proxy route
 * (`/api/admin/messages/[id]/media/[index]`): images as lazy
 * thumbnails that open full-size in a new tab, anything else as a
 * small chip that downloads. Renders nothing for a text without
 * attachments, so callers can drop it in unconditionally.
 */
export function MessageMedia({
  message,
  align = "start",
  className,
}: {
  message: Pick<XanoSmsMessage, "id" | "media">;
  /** Which side the bubble sits on — thumbnails follow it. */
  align?: "start" | "end";
  className?: string;
}) {
  const items = smsMedia(message);
  if (items.length === 0) return null;
  return (
    <div
      data-slot="message-media"
      className={cn(
        "flex max-w-[80%] flex-wrap gap-1.5",
        align === "end" ? "self-end justify-end" : "self-start",
        className
      )}
    >
      {items.map((item, index) =>
        isImageMedia(item) ? (
          <ImageThumb
            key={index}
            item={item}
            src={smsMediaUrl(message.id, index)}
            index={index}
          />
        ) : (
          <FileChip
            key={index}
            item={item}
            href={smsMediaUrl(message.id, index)}
          />
        )
      )}
    </div>
  );
}

function ImageThumb({
  item,
  src,
  index,
}: {
  item: SmsMediaItem;
  src: string;
  index: number;
}) {
  const [failed, setFailed] = useState(false);
  const label = item.name || `Photo ${index + 1}`;
  if (failed) {
    // The proxy couldn't fetch it (Quo no longer has it, or the
    // network blinked) — say so in place rather than a broken image.
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted"
        title="The photo couldn't be loaded — click to try again"
      >
        <ImageOff className="size-3.5" />
        Photo unavailable
      </a>
    );
  }
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="block overflow-hidden rounded-xl border border-border/60 bg-muted/40 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      title={`Open ${label} full size`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- bytes come from our own proxy route; next/image can't optimise an authenticated stream */}
      <img
        src={src}
        alt={label}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="block h-auto max-h-60 w-auto max-w-[240px] object-cover"
      />
    </a>
  );
}

function FileChip({ item, href }: { item: SmsMediaItem; href: string }) {
  const kind = mediaKindLabel(item);
  const Icon = kind === "PDF" ? FileText : Paperclip;
  return (
    <a
      href={href}
      download={item.name || undefined}
      className="inline-flex max-w-[240px] items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      title={item.name ? `Download ${item.name}` : `Download ${kind.toLowerCase()}`}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{item.name || kind}</span>
      {item.name ? (
        <span className="shrink-0 text-muted-foreground">· {kind}</span>
      ) : null}
      <Download className="size-3 shrink-0 text-muted-foreground" />
    </a>
  );
}
