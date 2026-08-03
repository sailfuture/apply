"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Send, Loader2, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  Message,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { cn } from "@/lib/utils";
import type { XanoSmsMessage } from "@/lib/xano";

/** Recipient summary the messages API returns alongside the thread —
 *  kept in sync with `FamilyRecipient` in `lib/sms/send.ts`. */
export interface MessageRecipient {
  parentId: number | null;
  name: string;
  phone: string;
  e164: string | null;
  optedOut: boolean;
}

export interface MessagesResponse {
  messages: XanoSmsMessage[];
  recipient: MessageRecipient | null;
}

export const messagesFetcher = async (
  url: string
): Promise<MessagesResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load messages (${res.status})`);
  return res.json();
};

export type ThreadContactType =
  | "family"
  | "inquiry"
  | "camp"
  | "visit"
  | "tasco"
  /** A bare phone number with no record — the id IS the 10-digit
   *  number (see `adhocIdFromPhone` in lib/sms/contacts.ts). */
  | "adhoc";

export function contactMessagesKey(
  type: ThreadContactType,
  id: number
): string {
  return `/api/admin/messages?contactType=${type}&contactId=${id}`;
}

/** Legacy key helper — family threads only. Delegates to
 *  `contactMessagesKey` so older callers (the family-record drawer)
 *  share the same SWR cache entry as the generic path. */
export function messagesKey(familyId: number): string {
  return contactMessagesKey("family", familyId);
}

/**
 * The two-way SMS thread + composer for one contact — a family, an
 * inquiry, or a summer-camp parent. Self-fetches via SWR (keyed on the
 * contact) and fills its parent's height — so it drops into both the
 * per-family drawer (`FamilyMessagesSheet`) and the global inbox's
 * right pane. The parent supplies a height-constrained flex container;
 * this renders `[scrollable thread][pinned composer]`.
 *
 * Pass either `contact` (any type) or the legacy `familyId` prop.
 */
export function FamilyMessageThread({
  familyId,
  contact,
  defaultStudentId,
  defaultYearId,
  onSent,
  className,
}: {
  /** Legacy family-thread prop — equivalent to
   *  `contact: { type: "family", id: familyId }`. */
  familyId?: number;
  /** Generic contact — takes precedence over `familyId`. */
  contact?: { type: ThreadContactType; id: number };
  defaultStudentId?: number | null;
  defaultYearId?: number | null;
  /** Fired after a successful send — lets a host (e.g. the inbox)
   *  refresh its conversation list. The shared SWR cache already
   *  refreshes the thread itself. */
  onSent?: () => void;
  /** The host supplies the height sizing (typically `flex-1 min-h-0`)
   *  since this renders inside different flex containers. */
  className?: string;
}) {
  const contactType = contact?.type ?? "family";
  const contactId = contact?.id ?? familyId ?? 0;

  // Poll while mounted — inbound replies arrive via the Twilio webhook
  // writing to Xano, so without a refresh interval an open thread would
  // never show them (the inbox's conversation list polls separately and
  // would flag a reply the open thread can't display). Focus
  // revalidation stays on (SWR default) so alt-tabbing back is instant.
  const { data, isLoading, mutate } = useSWR<MessagesResponse>(
    contactId ? contactMessagesKey(contactType, contactId) : null,
    messagesFetcher,
    { refreshInterval: 15_000 }
  );

  const messages = useMemo(() => data?.messages ?? [], [data]);
  const recipient = data?.recipient ?? null;

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const canSend = Boolean(recipient?.e164) && !recipient?.optedOut;
  const segments = body.length === 0 ? 0 : Math.ceil(body.length / 160);

  async function send() {
    const text = body.trim();
    if (!text || sending || !canSend) return;
    setSending(true);
    try {
      const res = await fetch("/api/admin/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactType,
          contactId,
          body: text,
          studentId: defaultStudentId ?? null,
          yearId: defaultYearId ?? null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `Send failed (${res.status})`);
      }
      setBody("");
      await mutate();
      onSent?.();
      toast.success("Text sent.");
    } catch (err) {
      console.error("Failed to send text:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't send text.");
    } finally {
      setSending(false);
    }
  }

  const items = useMemo(() => buildThreadItems(messages), [messages]);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <p className="text-sm text-muted-foreground">
              No texts yet. Send the first message below — it&rsquo;ll
              appear here as a thread.
            </p>
          </div>
        ) : (
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent className="px-4 py-4">
                  {items.map((item) =>
                    item.type === "separator" ? (
                      <MessageScrollerItem key={item.id} messageId={item.id}>
                        <Marker variant="separator">
                          <MarkerContent>{item.label}</MarkerContent>
                        </Marker>
                      </MessageScrollerItem>
                    ) : (
                      <MessageScrollerItem
                        key={item.id}
                        messageId={item.id}
                        scrollAnchor={item.msg.direction === "outbound"}
                      >
                        <MessageRow
                          msg={item.msg}
                          recipientName={recipient?.name}
                        />
                      </MessageScrollerItem>
                    )
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
        )}
      </div>

      <div className="space-y-2 border-t bg-muted/20 px-4 py-3">
        {recipient?.optedOut ? (
          <Marker className="text-amber-600">
            <MarkerIcon>
              <Ban />
            </MarkerIcon>
            <MarkerContent>
              This contact opted out of text messages. You can&rsquo;t
              message them until they opt back in.
            </MarkerContent>
          </Marker>
        ) : !recipient?.e164 ? (
          <Marker className="text-muted-foreground">
            <MarkerContent>
              No valid mobile number on file for this contact.
            </MarkerContent>
          </Marker>
        ) : null}
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            // Shift+Enter (and Cmd/Ctrl+Enter) sends; a bare Enter
            // keeps inserting a newline so multi-line texts stay easy
            // to compose.
            if (
              e.key === "Enter" &&
              (e.shiftKey || e.metaKey || e.ctrlKey)
            ) {
              e.preventDefault();
              void send();
            }
          }}
          rows={3}
          disabled={!canSend || sending}
          placeholder={
            canSend
              ? `Text ${recipient?.name || "this contact"}…`
              : "Messaging unavailable"
          }
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {body.length} chars
            {segments > 0
              ? ` · ${segments} segment${segments === 1 ? "" : "s"}`
              : ""}
          </span>
          <Button
            size="sm"
            onClick={() => void send()}
            disabled={!canSend || sending || !body.trim()}
          >
            {sending ? (
              <>
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
                Sending
              </>
            ) : (
              <>
                <Send className="size-3.5 mr-1.5" />
                Send
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Human status label for the message footer. */
const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  undelivered: "Undelivered",
  failed: "Failed",
  received: "Received",
};

/** Human text for the Twilio error codes we actually see — shown in
 *  the footer beside the code so staff know what went wrong without
 *  looking it up. Unknown codes fall back to "Delivery error". */
const ERROR_TEXT: Record<string, string> = {
  "21211": "Invalid phone number",
  "21610": "Recipient has opted out",
  "30003": "Phone unreachable or off",
  "30004": "Blocked by the recipient",
  "30005": "Unknown or inactive number",
  "30006": "Landline — can't receive texts",
  "30007": "Filtered by the carrier",
  "30034": "Number not A2P-registered",
};

/**
 * Outbound bubble variant: red for a failed/undelivered send, a subtle
 * primary tint for automated trigger texts AND group blasts (so both
 * read distinctly from a staff-typed 1:1 reply), and the strong
 * primary only for manual messages. Inbound always renders
 * `secondary`.
 */
function outboundVariant(
  m: XanoSmsMessage
): "default" | "tinted" | "destructive" {
  if (m.status === "failed" || m.status === "undelivered") return "destructive";
  if (m.template && m.template !== "manual") {
    return "tinted";
  }
  return "default";
}

function MessageRow({
  msg,
  recipientName,
}: {
  msg: XanoSmsMessage;
  recipientName?: string;
}) {
  const outbound = msg.direction === "outbound";
  const align = outbound ? "end" : "start";
  const isGroup = Boolean(msg.template?.startsWith("group"));
  const automated = Boolean(
    msg.template && msg.template !== "manual" && !isGroup
  );
  const sender = outbound
    ? msg.author_name || (automated ? "SailFuture (automated)" : "SailFuture")
    : recipientName || "Family";
  const statusText = outbound ? (STATUS_LABEL[msg.status] ?? msg.status) : null;

  return (
    <Message align={align}>
      <MessageContent>
        <MessageHeader>
          {sender}
          {isGroup ? " · Group text" : ""}
        </MessageHeader>
        <Bubble variant={outbound ? outboundVariant(msg) : "secondary"}>
          <BubbleContent className="whitespace-pre-wrap">
            {msg.body}
          </BubbleContent>
        </Bubble>
        <MessageFooter title={new Date(msg.created_at).toLocaleString()}>
          {statusText ? <span>{statusText}&nbsp;·&nbsp;</span> : null}
          <span>{timeLabel(msg.created_at)}</span>
          {msg.error_code ? (
            <span className={cn("text-destructive")}>
              &nbsp;·&nbsp;
              {ERROR_TEXT[msg.error_code] ?? "Delivery error"} (
              {msg.error_code})
            </span>
          ) : null}
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}

type ThreadItem =
  | { type: "separator"; id: string; label: string }
  | { type: "message"; id: string; msg: XanoSmsMessage };

/** Flatten the message list into render items, inserting a day
 *  separator whenever the calendar day changes. */
function buildThreadItems(messages: XanoSmsMessage[]): ThreadItem[] {
  const out: ThreadItem[] = [];
  let lastDay = "";
  for (const m of messages) {
    const key = dayKey(m.created_at);
    if (key !== lastDay) {
      out.push({
        type: "separator",
        id: `sep-${key}`,
        label: dayLabel(m.created_at),
      });
      lastDay = key;
    }
    out.push({ type: "message", id: `msg-${m.id}`, msg: m });
  }
  return out;
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
