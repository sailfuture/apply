"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { MessageSquareText, Send, Loader2, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
import { formatUSPhone } from "@/lib/phone";
import type { XanoSmsMessage } from "@/lib/xano";

/** Recipient summary the messages API returns alongside the thread —
 *  kept in sync with `FamilyRecipient` in `lib/sms/send.ts` (declared
 *  locally so this client module doesn't import the server send path). */
interface Recipient {
  parentId: number | null;
  name: string;
  phone: string;
  e164: string | null;
  optedOut: boolean;
}

interface MessagesResponse {
  messages: XanoSmsMessage[];
  recipient: Recipient | null;
}

const fetcher = async (url: string): Promise<MessagesResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load messages (${res.status})`);
  return res.json();
};

interface Props {
  familyId: number;
  defaultStudentId?: number | null;
  defaultYearId?: number | null;
  /** `"inline"` docks the trigger beside other header action buttons
   *  (default, matches `FamilyNotesSheet`); `"floating"` pins it
   *  bottom-right as a chat pill. */
  variant?: "floating" | "inline";
  triggerLabel?: string;
  disabled?: boolean;
}

export function FamilyMessagesSheet({
  familyId,
  defaultStudentId,
  defaultYearId,
  variant = "inline",
  triggerLabel,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const swrKey = `/api/admin/messages?familyId=${familyId}`;
  const { data, isLoading, mutate } = useSWR<MessagesResponse>(swrKey, fetcher, {
    revalidateOnFocus: false,
  });

  // Memoized so the `items` useMemo below keeps a stable dependency —
  // `data?.messages ?? []` would otherwise mint a fresh array each render.
  const messages = useMemo(() => data?.messages ?? [], [data]);
  const recipient = data?.recipient ?? null;
  const totalMessages = messages.length;

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  // A text can go out only when there's a valid number and the family
  // hasn't opted out. The composer disables + explains itself otherwise.
  const canSend = Boolean(recipient?.e164) && !recipient?.optedOut;

  // 160 GSM-7 chars per segment — a rough count so staff see when a
  // message will split (and cost more). Good enough without pulling in
  // full encoding detection.
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
          familyId,
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
      toast.success("Text sent.");
    } catch (err) {
      console.error("Failed to send text:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't send text.");
    } finally {
      setSending(false);
    }
  }

  // Interleave date separators between messages so the thread reads like
  // a phone conversation (Today / Yesterday / Mar 3).
  const items = useMemo(() => buildThreadItems(messages), [messages]);

  const subtitle = recipient
    ? recipient.phone
      ? `To ${recipient.name || "family"} · ${formatUSPhone(recipient.phone)}`
      : `${recipient.name || "Family"} · no number on file`
    : "No recipient on file";

  return (
    <>
      {variant === "floating" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full border bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Open text messages"
        >
          <MessageSquareText className="size-4" />
          {triggerLabel ?? "Messages"}
          {totalMessages > 0 ? (
            <span className="ml-1 rounded-full bg-background/20 px-1.5 py-0.5 text-[10px] tabular-nums">
              {totalMessages}
            </span>
          ) : null}
        </button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={disabled}
          className="bg-white"
          aria-label="Open text messages"
        >
          <MessageSquareText className="size-4 mr-1.5" />
          {triggerLabel ?? "Messages"}
          {totalMessages > 0 ? (
            <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {totalMessages}
            </span>
          ) : null}
        </Button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md flex flex-col p-0 gap-0"
        >
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>Text messages</SheetTitle>
            <SheetDescription>{subtitle}</SheetDescription>
          </SheetHeader>

          {/* Thread. MessageScroller fills this flex-1 region; min-h-0
              lets it shrink so the composer stays pinned below. */}
          <div className="flex-1 min-h-0">
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
                          <MessageScrollerItem
                            key={item.id}
                            messageId={item.id}
                          >
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

          {/* Composer — pinned at the bottom. Disabled (with an inline
              explanation) when there's no number or the family opted out. */}
          <div className="border-t bg-muted/20 px-4 py-3 space-y-2">
            {recipient?.optedOut ? (
              <Marker className="text-amber-600">
                <MarkerIcon>
                  <Ban />
                </MarkerIcon>
                <MarkerContent>
                  This family opted out of texts (replied STOP). You
                  can&rsquo;t message them until they opt back in.
                </MarkerContent>
              </Marker>
            ) : !recipient?.e164 ? (
              <Marker className="text-muted-foreground">
                <MarkerContent>
                  No valid mobile number on file for this family.
                </MarkerContent>
              </Marker>
            ) : null}
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter sends, like most chat composers.
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={3}
              disabled={!canSend || sending}
              placeholder={
                canSend
                  ? `Text ${recipient?.name || "the family"}…`
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
        </SheetContent>
      </Sheet>
    </>
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

/**
 * Outbound bubble variant: red for a failed/undelivered send, a subtle
 * primary tint for automated trigger texts (so they read distinctly
 * from a staff-typed reply), and the strong primary for manual + group
 * messages. Inbound always renders `secondary`.
 */
function outboundVariant(
  m: XanoSmsMessage
): "default" | "tinted" | "destructive" {
  if (m.status === "failed" || m.status === "undelivered") return "destructive";
  if (m.template && m.template !== "manual" && !m.template.startsWith("group")) {
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
  const automated = Boolean(
    msg.template && msg.template !== "manual" && !msg.template.startsWith("group")
  );
  const sender = outbound
    ? msg.author_name || (automated ? "SailFuture (automated)" : "SailFuture")
    : recipientName || "Family";
  const statusText = outbound ? (STATUS_LABEL[msg.status] ?? msg.status) : null;

  return (
    <Message align={align}>
      <MessageContent>
        <MessageHeader>{sender}</MessageHeader>
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
              &nbsp;·&nbsp;{msg.error_code}
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
