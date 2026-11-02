"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Paperclip,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatSchoolTime, parseDate } from "@/lib/school-calendar";
import { cn } from "@/lib/utils";
import {
  eventTypeOption,
  formatHours,
  hoursTypeLabel,
  recruitmentFileUrl,
  type RecruitmentEvent,
  type RecruitmentEventFile,
} from "@/lib/recruitment-events";

/** "10:00 AM – 1:00 PM", "10:00 AM", or "" when no time is set. */
export function recruitmentTimeLabel(e: {
  start_time: number;
  end_time: number;
}): string {
  if (!e.start_time) return "";
  const start = formatSchoolTime(e.start_time);
  return e.end_time ? `${start} – ${formatSchoolTime(e.end_time)}` : start;
}

/**
 * One recruitment event in full: when, where, who went, how long,
 * the links, and the files behind it (flyers, vendor applications,
 * photos). Files are added and removed here; everything else is
 * edited through `onEdit`.
 *
 * Takes the live SWR row (null = closed), so a save re-renders it.
 */
export function RecruitmentEventDetailSheet({
  event,
  isPast,
  refreshing,
  onOpenChange,
  onEdit,
  onChanged,
  onDeleted,
}: {
  event: RecruitmentEvent | null;
  isPast: boolean;
  refreshing?: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (event: RecruitmentEvent) => void;
  /** The page's refetch — file saves wait on it before their spinners
   *  stop, so the change is on screen when they do. */
  onChanged: () => Promise<unknown>;
  onDeleted: () => Promise<unknown>;
}) {
  return (
    <Sheet open={event !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        {event ? (
          <Body
            key={event.id}
            event={event}
            isPast={isPast}
            refreshing={refreshing}
            onEdit={onEdit}
            onChanged={onChanged}
            onDeleted={onDeleted}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Body({
  event,
  isPast,
  refreshing,
  onEdit,
  onChanged,
  onDeleted,
}: {
  event: RecruitmentEvent;
  isPast: boolean;
  refreshing?: boolean;
  onEdit: (event: RecruitmentEvent) => void;
  onChanged: () => Promise<unknown>;
  onDeleted: () => Promise<unknown>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removingIndex, setRemovingIndex] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const type = eventTypeOption(event.event_type);
  const longDate = event.event_date
    ? parseDate(event.event_date).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";
  const time = recruitmentTimeLabel(event);

  async function patchFiles(files: RecruitmentEventFile[]) {
    const res = await fetch(`/api/admin/recruitment-events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ?? `Save failed (${res.status})`);
    }
    // Hold the spinner until the list on screen shows the change.
    await onChanged().catch(() => undefined);
  }

  async function uploadFiles(list: FileList | null) {
    if (!list || list.length === 0 || uploading) return;
    const picked = Array.from(list);
    setUploading(true);
    try {
      const added: RecruitmentEventFile[] = [];
      for (const f of picked) {
        const form = new FormData();
        form.append("file", f);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Upload failed (${res.status})`);
        }
        added.push((await res.json()) as RecruitmentEventFile);
      }
      await patchFiles([...event.files, ...added]);
      toast.success(
        added.length === 1 ? "File added." : `${added.length} files added.`
      );
    } catch (err) {
      console.error("Failed to upload recruitment event file:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't upload.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removeFile(index: number) {
    if (removingIndex !== null) return;
    setRemovingIndex(index);
    try {
      await patchFiles(event.files.filter((_, i) => i !== index));
      toast.success("File removed.");
    } catch (err) {
      console.error("Failed to remove recruitment event file:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't remove.");
    } finally {
      setRemovingIndex(null);
    }
  }

  async function deleteEvent() {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/recruitment-events/${event.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Delete failed (${res.status})`);
      }
      await onDeleted().catch(() => undefined);
      toast.success(`“${event.name}” deleted.`);
    } catch (err) {
      console.error("Failed to delete recruitment event:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't delete.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <SheetHeader className="border-b px-5 py-4 pr-12">
        <SheetTitle className="text-lg">{event.name}</SheetTitle>
        <SheetDescription>
          {longDate}
          {time ? ` · ${time}` : ""}
        </SheetDescription>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {type ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                type.chip
              )}
            >
              {type.label}
            </span>
          ) : null}
          {event.hours_type ? (
            <span className="rounded-full border bg-white px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {hoursTypeLabel(event.hours_type)}
            </span>
          ) : null}
          {event.paid ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-emerald-700">
              <CheckCircle2 className="size-3" aria-hidden />
              Paid
            </span>
          ) : null}
          {isPast ? (
            <span className="rounded-full border bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Past
            </span>
          ) : null}
        </div>
      </SheetHeader>

      <div
        aria-busy={refreshing}
        className={cn(
          "min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5 transition-opacity",
          refreshing && "opacity-50 animate-pulse"
        )}
      >
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Details
          </h3>
          <dl className="divide-y rounded-md border text-sm">
            <DetailRow label="Date">{longDate || "—"}</DetailRow>
            <DetailRow label="Time">{time || "—"}</DetailRow>
            <DetailRow label="Hours">
              {event.hours > 0 ? (
                <>
                  <span className="tabular-nums">{formatHours(event.hours)}</span>
                  {event.hours_type ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · {hoursTypeLabel(event.hours_type).toLowerCase()}
                    </span>
                  ) : null}
                </>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Staff">
              {event.staff.length > 0 ? event.staff.join(", ") : "—"}
            </DetailRow>
            <DetailRow label="Type">{type ? type.label : "Not set"}</DetailRow>
            <DetailRow label="Paid">{event.paid ? "Yes" : "No"}</DetailRow>
            <DetailRow label="Location">{event.location || "—"}</DetailRow>
            <DetailRow label="Description">
              {event.description ? (
                <span className="whitespace-pre-wrap">{event.description}</span>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Event link">
              <LinkValue href={event.event_link} />
            </DetailRow>
            <DetailRow label="Application">
              <LinkValue href={event.application_link} />
            </DetailRow>
          </dl>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Files ({event.files.length})
            </h3>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => void uploadFiles(e.target.files)}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 bg-white px-2"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Paperclip className="size-3.5" />
              )}
              {uploading ? "Uploading" : "Add file"}
            </Button>
          </div>
          {event.files.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No files yet — flyers, vendor applications, photos.
            </p>
          ) : (
            <ul className="divide-y rounded-md border text-sm">
              {event.files.map((f, i) => {
                const href = recruitmentFileUrl(f);
                const label =
                  (typeof f.name === "string" && f.name) || `File ${i + 1}`;
                const removing = removingIndex === i;
                return (
                  <li
                    key={`${f.path ?? f.url ?? label}-${i}`}
                    className="flex items-center gap-2 px-3 py-2"
                  >
                    <FileText
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 flex-1 truncate underline-offset-2 hover:underline"
                      >
                        {label}
                      </a>
                    ) : (
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove ${label}`}
                      disabled={removingIndex !== null}
                      onClick={() => void removeFile(i)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                    >
                      {removing ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <X className="size-3.5" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="flex items-center justify-between gap-2 border-t px-5 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-red-600 hover:bg-red-50 hover:text-red-700"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="size-3.5" />
          Delete
        </Button>
        <Button size="sm" onClick={() => onEdit(event)}>
          <Pencil className="size-3.5" />
          Edit event
        </Button>
      </div>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(o) => !deleting && setConfirmDelete(o)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this event?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{event.name}&rdquo; and its {event.files.length}{" "}
              {event.files.length === 1 ? "file" : "files"} will be removed
              from the list. This can&rsquo;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void deleteEvent();
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Deleting
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** A stored link as a short clickable label (host + path start). */
function LinkValue({ href }: { href: string }) {
  if (!href) return <>—</>;
  let label = href;
  try {
    const u = new URL(href);
    label = `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
    if (label.length > 48) label = `${label.slice(0, 45)}…`;
  } catch {
    // Not a parseable URL — show it as typed.
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1 underline-offset-2 hover:underline"
    >
      <span className="truncate">{label}</span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
    </a>
  );
}
