"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { LeadSheet } from "@/components/admin/lead-sheet";
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatNoteTimestamp } from "@/lib/format-note-time";
import { formatTimestampUs } from "@/lib/us-date";
import type {
  NurtureOverview,
  NurturePreviewItem,
} from "@/app/api/admin/nurture/route";
import type { LeadSource } from "@/app/api/admin/all-leads/route";
import type { QuoStatus } from "@/app/api/admin/quo/status/route";
import { formatUSPhone } from "@/lib/phone";

const KEY = "/api/admin/nurture";

/** "Tue, 9/29, 9:00 AM" in school time. */
function whenLabel(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function patchSettings(patch: Record<string, unknown>) {
  const res = await fetch(KEY, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "Couldn't save");
  }
}

/**
 * Recruitment → Follow-ups: the automated follow-up texts to leads
 * (lib/nurture). The on/off switch, who signs the personal-style text,
 * the reply copy to the Main Line, and a live preview built by the
 * same planner the cron runs — so what's listed here is exactly what
 * the next run would send.
 */
export default function FollowUpsPage() {
  const { data, error, isLoading, mutate } = useSWR<NurtureOverview>(
    KEY,
    adminFetcher
  );
  const [openLead, setOpenLead] = useState<{
    source: LeadSource;
    id: number;
  } | null>(null);
  const open = (item: { source: string; leadId: number }) =>
    setOpenLead({ source: item.source as LeadSource, id: item.leadId });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Follow-ups</h1>
        <p className="text-sm text-muted-foreground">
          Automated texts that move leads toward a tour and an application,
          sent from the school&rsquo;s texting number (see Phone system below).
          Each one lands in the lead&rsquo;s timeline, and a reply, or a call
          either way, stops the nudges.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">
          Couldn&rsquo;t load follow-ups: {error.message}
        </p>
      ) : isLoading || !data ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading follow-ups…
        </div>
      ) : (
        <>
          <SettingsCard data={data} revalidate={() => mutate()} />
          <PhoneSystemCard />

          <PreviewTable
            title="Due on the next run"
            description={
              !data.settings.enabled
                ? "Follow-ups are off, so none of these send. This is what would go out if you turned them on."
                : data.inWindow
                  ? "These go out on the next run, within half an hour."
                  : "Outside sending hours. These go out at 9 AM."
            }
            items={data.due}
            empty="Nothing is due right now."
            onOpen={open}
          />
          <PreviewTable
            title="Held"
            description="Leads that qualify for a text, but a rule is holding it for now."
            items={data.held}
            empty="Nothing is being held."
            showReason
            onOpen={open}
          />
          <PreviewTable
            title="Coming up in the next 48 hours"
            description="An estimate. A reply, a booked tour, or a status change can still cancel one."
            items={data.upcoming}
            empty="Nothing else comes due in the next 48 hours."
            showWhen
            onOpen={open}
          />
          <RecentCard data={data} onOpen={open} />
          <ExamplesCard data={data} />
        </>
      )}

      <LeadSheet
        lead={openLead}
        onOpenChange={(o) => {
          if (!o) setOpenLead(null);
        }}
        onChanged={() => void mutate()}
      />
    </div>
  );
}

function SettingsCard({
  data,
  revalidate,
}: {
  data: NurtureOverview;
  revalidate: () => Promise<unknown>;
}) {
  const [saving, setSaving] = useState<null | "enabled" | "sender" | "forward">(
    null
  );
  const [confirmOn, setConfirmOn] = useState(false);
  const [sender, setSender] = useState(data.settings.senderName);
  const [prevSender, setPrevSender] = useState(data.settings.senderName);
  // Re-seed the field when the saved value changes underneath it (the
  // sanctioned adjust-state-on-prop-change pattern).
  if (data.settings.senderName !== prevSender) {
    setPrevSender(data.settings.senderName);
    setSender(data.settings.senderName);
  }

  async function save(
    which: "enabled" | "sender" | "forward",
    patch: Record<string, unknown>,
    done: string
  ) {
    setSaving(which);
    try {
      await patchSettings(patch);
      // Spinner holds until the refreshed settings have rendered.
      await revalidate();
      toast.success(done);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(null);
    }
  }

  const { enabled, startedAt } = data.settings;
  return (
    <Card className="bg-white">
      <CardHeader>
        <CardTitle className="text-base">Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start gap-3">
          <Switch
            id="nurture-enabled"
            checked={enabled}
            disabled={saving !== null}
            onCheckedChange={(v) => {
              if (v) setConfirmOn(true);
              else
                void save("enabled", { enabled: false }, "Follow-ups turned off.");
            }}
          />
          <div className="space-y-0.5">
            <Label htmlFor="nurture-enabled" className="font-medium">
              Automated follow-ups{" "}
              {saving === "enabled" ? (
                <Loader2 className="inline size-3.5 animate-spin" />
              ) : null}
            </Label>
            <p className="text-sm text-muted-foreground">
              {enabled
                ? `On${startedAt ? ` since ${formatTimestampUs(startedAt)}` : ""}. Texts go out 9 AM to 7 PM Eastern, at most one a day per family.`
                : "Off. Nothing is sent."}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="nurture-sender">Sign the day-2 text as</Label>
          <div className="flex max-w-md gap-2">
            <Input
              id="nurture-sender"
              value={sender}
              maxLength={40}
              placeholder="the SailFuture Academy admissions team"
              onChange={(e) => setSender(e.target.value)}
              className="bg-white"
            />
            <Button
              type="button"
              variant="outline"
              className="bg-white"
              disabled={saving !== null || sender.trim() === data.settings.senderName}
              onClick={() =>
                void save("sender", { senderName: sender.trim() }, "Saved.")
              }
            >
              {saving === "sender" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A first name reads best (&ldquo;it&rsquo;s Jane from SailFuture
            Academy&rdquo;). Leave it blank to sign as the admissions team.
          </p>
        </div>

        <div className="flex items-start gap-3">
          <Switch
            id="nurture-forward"
            checked={data.forwardReplies}
            disabled={saving !== null}
            onCheckedChange={(v) =>
              void save(
                "forward",
                { forwardReplies: v },
                v ? "Replies will be copied to the Main Line." : "Reply copies turned off."
              )
            }
          />
          <div className="space-y-0.5">
            <Label htmlFor="nurture-forward" className="font-medium">
              Copy parent replies to the Main Line{" "}
              {saving === "forward" ? (
                <Loader2 className="inline size-3.5 animate-spin" />
              ) : null}
            </Label>
            <p className="text-sm text-muted-foreground">
              While texts go out from (727) 604-8321, every reply a parent
              sends there is also texted to the Main Line in Quo, with a link
              to answer in Apply. Texts sent from the Main Line get their
              replies in Quo directly.
            </p>
          </div>
        </div>
      </CardContent>

      <AlertDialog open={confirmOn} onOpenChange={setConfirmOn}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn on automated follow-ups?</AlertDialogTitle>
            <AlertDialogDescription>
              Texts will start going out during sending hours.{" "}
              {startedAt
                ? `${data.due.length} ${data.due.length === 1 ? "text is" : "texts are"} due now.`
                : "Inquiries and tours from before today are left alone. Only new ones get the inquiry and after-tour texts, while upcoming tours still get reminders."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void save("enabled", { enabled: true }, "Follow-ups are on.")
              }
            >
              Turn on
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/**
 * Is Apply hearing from Quo? One line per fact, so a connection that
 * quietly stopped reads as "Off" or an old time instead of nothing.
 */
function PhoneSystemCard() {
  const { data, error, isLoading } = useSWR<QuoStatus>(
    "/api/admin/quo/status",
    adminFetcher,
    { revalidateOnFocus: false }
  );
  const [confirmProvider, setConfirmProvider] = useState<null | "quo" | "twilio">(null);
  const [switching, setSwitching] = useState(false);
  const { mutate: revalidateStatus } = useSWRConfig();

  async function switchProvider(provider: "quo" | "twilio") {
    setSwitching(true);
    try {
      await patchSettings({ smsProvider: provider });
      // Spinner holds until the card shows the new number.
      await revalidateStatus("/api/admin/quo/status");
      toast.success(
        provider === "quo"
          ? "Texts now go out from the Main Line."
          : "Texts now go out from (727) 604-8321."
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't switch");
    } finally {
      setSwitching(false);
      setConfirmProvider(null);
    }
  }

  const rows: Array<{ label: string; value: string; bad?: boolean }> = [];
  if (data) {
    rows.push({
      label: "Main Line",
      value: data.mainLine ? formatUSPhone(data.mainLine.number) : "Not found in Quo",
      bad: !data.mainLine,
    });
    rows.push({
      label: "Texts go out from",
      value:
        data.provider === "quo"
          ? "Main Line (727) 209-7846 via Quo"
          : "(727) 604-8321 via Twilio",
    });
    const live =
      data.webhook?.enabled && data.webhookSecretSet
        ? "On"
        : !data.configured
          ? "Off (QUO_API_KEY isn't set)"
          : !data.webhook
            ? "Off (not registered with Quo yet)"
            : !data.webhookSecretSet
              ? "Off (QUO_WEBHOOK_SECRET isn't set)"
              : "Off (paused in Quo)";
    rows.push({ label: "Live updates", value: live, bad: live !== "On" });
    rows.push({
      label: "Last text received or sent",
      value: data.lastTextAt ? formatNoteTimestamp(data.lastTextAt) : "None yet",
    });
    rows.push({
      label: "Last call",
      value: data.lastCallAt ? formatNoteTimestamp(data.lastCallAt) : "None yet",
    });
  }
  return (
    <Card className="bg-white">
      <CardHeader>
        <CardTitle className="text-base">Phone system</CardTitle>
        <CardDescription>
          Texts and calls on the Main Line are copied from Quo into each
          family&rsquo;s timeline. A check every 15 minutes picks up anything
          live updates missed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">
            Couldn&rsquo;t check the phone system: {error.message}
          </p>
        ) : isLoading || !data ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Checking…
          </div>
        ) : (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[14rem_1fr]">
            {rows.map((r) => (
              <div key={r.label} className="contents">
                <dt className="text-muted-foreground">{r.label}</dt>
                <dd className={r.bad ? "font-medium text-destructive" : "font-medium"}>
                  {r.value}
                </dd>
              </div>
            ))}
            {data.error ? (
              <div className="contents">
                <dt className="text-muted-foreground">Quo</dt>
                <dd className="font-medium text-destructive">{data.error}</dd>
              </div>
            ) : null}
          </dl>
        )}
        {data ? (
          <div className="mt-4">
            <Button
              type="button"
              variant="outline"
              className="bg-white"
              disabled={switching || (data.provider !== "quo" && !data.configured)}
              onClick={() => setConfirmProvider(data.provider === "quo" ? "twilio" : "quo")}
            >
              {switching ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {data.provider === "quo"
                ? "Switch texts back to (727) 604-8321"
                : "Send all texts from the Main Line"}
            </Button>
          </div>
        ) : null}
      </CardContent>

      <AlertDialog open={confirmProvider !== null} onOpenChange={(o) => !o && !switching && setConfirmProvider(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmProvider === "quo"
                ? "Send every text from the Main Line?"
                : "Send every text from (727) 604-8321 again?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmProvider === "quo"
                ? "From now on every text Apply sends — automatic, scheduled, group, and replies from the inbox — goes out from (727) 209-7846 through Quo, and parents' replies land in the office inbox. Texts already sent stay where they are."
                : "Every text Apply sends goes back to the Twilio number. Use this if delivery from the Main Line has a problem."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={switching}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={switching}
              onClick={(e) => {
                e.preventDefault();
                if (confirmProvider) void switchProvider(confirmProvider);
              }}
            >
              {switching ? <Loader2 className="size-3.5 animate-spin" /> : "Switch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function PreviewTable({
  title,
  description,
  items,
  empty,
  showReason = false,
  showWhen = false,
  onOpen,
}: {
  title: string;
  description: string;
  items: NurturePreviewItem[];
  empty: string;
  showReason?: boolean;
  showWhen?: boolean;
  onOpen: (item: NurturePreviewItem) => void;
}) {
  return (
    <Card className="bg-white gap-0 overflow-hidden py-0">
      <CardHeader className="border-b py-4">
        <CardTitle className="text-base">
          {title}{" "}
          <span className="font-normal text-muted-foreground tabular-nums">
            {items.length}
          </span>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <p className="px-6 py-4 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {showWhen ? <TableHead>When</TableHead> : null}
                <TableHead>Parent</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Text</TableHead>
                <TableHead>Message</TableHead>
                {showReason ? <TableHead>Why it&rsquo;s held</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={`${item.key}|${item.template}`}
                  className="cursor-pointer"
                  onClick={() => onOpen(item)}
                >
                  {showWhen ? (
                    <TableCell className="whitespace-nowrap">
                      {item.at ? whenLabel(item.at) : ""}
                    </TableCell>
                  ) : null}
                  <TableCell className="whitespace-nowrap">
                    {item.parentName || "Parent"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {item.studentName}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {item.stepLabel}
                  </TableCell>
                  <TableCell className="max-w-md truncate" title={item.body}>
                    {item.body}
                  </TableCell>
                  {showReason ? (
                    <TableCell className="whitespace-nowrap">
                      {item.reason}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function RecentCard({
  data,
  onOpen,
}: {
  data: NurtureOverview;
  onOpen: (item: { source: string; leadId: number }) => void;
}) {
  return (
    <Card className="bg-white gap-0 overflow-hidden py-0">
      <CardHeader className="border-b py-4">
        <CardTitle className="text-base">
          Sent in the last 14 days{" "}
          <span className="font-normal text-muted-foreground tabular-nums">
            {data.recent.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {data.recent.length === 0 ? (
          <p className="px-6 py-4 text-sm text-muted-foreground">
            No follow-up texts have gone out yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sent</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead>Text</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recent.map((r) => {
                const [source, id] = r.key.split(":");
                return (
                  <TableRow
                    key={`${r.key}|${r.sentAt}`}
                    className="cursor-pointer"
                    onClick={() => onOpen({ source, leadId: Number(id) })}
                  >
                    <TableCell className="whitespace-nowrap">
                      {formatNoteTimestamp(r.sentAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.parentName || "Parent"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.stepLabel}
                    </TableCell>
                    <TableCell className="max-w-md truncate" title={r.body}>
                      {r.body}
                    </TableCell>
                    <TableCell className="whitespace-nowrap capitalize">
                      {r.status}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ExamplesCard({ data }: { data: NurtureOverview }) {
  return (
    <Card className="bg-white">
      <CardHeader>
        <CardTitle className="text-base">The texts</CardTitle>
        <CardDescription>
          Shown with sample names. The first text a family ever gets from us
          also ends with &ldquo;Reply STOP to opt out.&rdquo;
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {data.examples.map((ex) => (
          <div key={ex.step} className="rounded-lg border p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {ex.label}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{ex.body}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
