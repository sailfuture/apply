"use client";

import { useState } from "react";
import useSWR from "swr";
import { MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { formatUSPhone } from "@/lib/phone";
import {
  FamilyMessageThread,
  messagesFetcher,
  messagesKey,
  type MessagesResponse,
} from "@/components/admin/family-message-thread";

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
  // Shared SWR key with the thread — this fetch drives the trigger
  // badge count + header subtitle; the thread reads the same cache.
  // Default focus revalidation keeps the badge fresh; the thread adds
  // its own poll interval while the sheet is open.
  const { data } = useSWR<MessagesResponse>(
    messagesKey(familyId),
    messagesFetcher
  );

  const totalMessages = data?.messages.length ?? 0;
  const recipient = data?.recipient ?? null;
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
          <FamilyMessageThread
            className="flex-1 min-h-0"
            familyId={familyId}
            defaultStudentId={defaultStudentId}
            defaultYearId={defaultYearId}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
