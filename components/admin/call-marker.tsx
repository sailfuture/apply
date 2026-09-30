"use client";

import { useState } from "react";
import { ChevronDown, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Voicemail } from "lucide-react";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { callDuration, callHasAudio, callLabel, stringList } from "@/lib/calls";
import { cn } from "@/lib/utils";
import type { XanoCall } from "@/lib/xano";

/**
 * A phone call in a timeline: one marker line ("Incoming call · 4 min
 * · answered by Jane · 2:14 PM"), Quo's summary and next steps under
 * it, a voicemail's transcript, and a Play link that opens the
 * recording through the admin route (Quo's audio links expire, so
 * nothing is copied). Long transcripts stay behind a toggle.
 */
export function CallMarker({ call }: { call: XanoCall }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const label = callLabel(call);
  const missed = label === "Missed call" || call.status === "no-answer";
  const Icon =
    label === "Voicemail"
      ? Voicemail
      : missed
        ? PhoneMissed
        : call.direction === "outgoing"
          ? PhoneOutgoing
          : call.direction === "incoming"
            ? PhoneIncoming
            : Phone;
  const summary = stringList(call.summary);
  const nextSteps = stringList(call.next_steps);
  const transcript = Array.isArray(call.transcript)
    ? (call.transcript as Array<{ who?: string; text?: string; at?: number }>)
    : [];
  const voicemail = (call.voicemail_transcript ?? "").trim();
  const time = new Date(call.started_at || call.created_at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="space-y-1.5">
      <Marker className="text-muted-foreground">
        <MarkerIcon>
          <Icon className={cn(missed && "text-destructive")} />
        </MarkerIcon>
        <MarkerContent>
          <span className={cn("font-medium", missed ? "text-destructive" : "text-foreground/80")}>
            {label}
          </span>
          {callDuration(call.duration_seconds) ? <> · {callDuration(call.duration_seconds)}</> : null}
          {call.staff_name ? (
            <> · {call.direction === "outgoing" ? "by" : "answered by"} {call.staff_name}</>
          ) : null}
          {" · "}
          <span title={new Date(call.started_at || call.created_at).toLocaleString()}>{time}</span>
          {callHasAudio(call) ? (
            <>
              {" · "}
              <a
                href={`/api/admin/calls/${call.id}/recording`}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Play
              </a>
            </>
          ) : null}
        </MarkerContent>
      </Marker>
      {summary.length || nextSteps.length || voicemail ? (
        <div className="mx-auto max-w-prose rounded-md border bg-muted/30 px-3 py-2 text-sm">
          {voicemail ? (
            <p className="whitespace-pre-wrap">
              <span className="font-medium">Voicemail: </span>
              {voicemail}
            </p>
          ) : null}
          {summary.length ? (
            <ul className="list-disc space-y-0.5 pl-4">
              {summary.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : null}
          {nextSteps.length ? (
            <p className="mt-1.5 text-muted-foreground">
              <span className="font-medium text-foreground">Next steps: </span>
              {nextSteps.join(" ")}
            </p>
          ) : null}
        </div>
      ) : null}
      {transcript.length ? (
        <div className="mx-auto max-w-prose text-xs">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setShowTranscript((v) => !v)}
          >
            <ChevronDown className={cn("size-3 transition-transform", showTranscript && "rotate-180")} />
            {showTranscript ? "Hide transcript" : `Transcript (${transcript.length} lines)`}
          </button>
          {showTranscript ? (
            <div className="mt-1 space-y-0.5 rounded-md border bg-white px-3 py-2">
              {transcript.map((line, i) => (
                <p key={i}>
                  <span className="font-medium">{line.who || "—"}: </span>
                  {line.text}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
