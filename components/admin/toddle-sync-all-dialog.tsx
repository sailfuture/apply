"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatNoteTimestamp } from "@/lib/format-note-time";
import { formatToddleFieldList } from "@/lib/toddle-fields";
import type { ToddleReadiness } from "@/lib/toddle-readiness";
import type { ToddleSyncPreview } from "@/lib/toddle-sync";

type PreflightRow = ToddleReadiness & { preview?: ToddleSyncPreview };

/** What the admin said about a student the preview flagged as a
 *  possible duplicate: point them at the record Toddle already has,
 *  or confirm this really is a different child. */
type Decision =
  | { kind: "link"; toddleId: string; name: string }
  | { kind: "create" };
import type {
  BulkToddleSyncResponse,
  BulkToddleSyncRow,
} from "@/app/api/admin/students/toddle-sync-all/route";

/**
 * "Sync All to Toddle" button + modal for the Enrolled Students page.
 * Runs the full per-student Toddle sync (profile fields, photo,
 * family members + contacts, crew class) for every enrolled student
 * via `/api/admin/students/toddle-sync-all`, then shows the
 * per-student results. Idempotent — students already in Toddle are
 * matched and updated, never duplicated — so re-running is safe.
 *
 * `lastSyncedAt` / `neverSyncedCount` (derived by the host from the
 * roster's `toddle_synced_at` stamps) render under the trigger as the
 * roster-wide answer to "when did we last push to Toddle?", so that
 * question doesn't require running a sync to find out.
 */
export function ToddleSyncAllDialog({
  lastSyncedAt,
  neverSyncedCount,
}: {
  /** Most recent successful sync across the shown enrolled students,
   *  or null when none of them has ever been pushed. */
  lastSyncedAt?: number | null;
  /** How many of those students have never been pushed. */
  neverSyncedCount?: number;
} = {}) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BulkToddleSyncResponse | null>(null);
  // Pre-flight: what each student is missing, BEFORE anything is
  // pushed. Xano-only on the server, so opening the dialog costs no
  // Toddle quota.
  const [readiness, setReadiness] = useState<PreflightRow[] | null>(null);
  const [comparedToToddle, setComparedToToddle] = useState(true);
  const [loadingReadiness, setLoadingReadiness] = useState(false);
  // Answers to "Toddle may already have this child" — one per
  // flagged student, kept here rather than re-derived, because the
  // run needs the "create anyway" set and the panel needs to stop
  // asking about the ones already answered.
  const [decisions, setDecisions] = useState<Map<number, Decision>>(new Map());
  const [linkingId, setLinkingId] = useState<number | null>(null);

  useEffect(() => {
    if (!open || readiness || loadingReadiness) return;
    setLoadingReadiness(true);
    fetch("/api/admin/students/toddle-sync-all")
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setReadiness(Array.isArray(data?.rows) ? data.rows : []);
        setComparedToToddle(data?.comparedToToddle !== false);
      })
      .catch((err) => {
        console.error("[ToddleSyncAllDialog] readiness check failed:", err);
        setReadiness([]);
      })
      .finally(() => setLoadingReadiness(false));
  }, [open, readiness, loadingReadiness]);

  /** "Yes, that's him" — store the Toddle id on our student so the
   *  run updates that record instead of creating a second one. The
   *  row resolves locally rather than re-running the whole preview,
   *  which would cost another Toddle roster read per decision. */
  async function link(studentId: number, toddleId: string, name: string) {
    setLinkingId(studentId);
    try {
      const res = await fetch(
        `/api/admin/students/${studentId}/toddle-link`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toddleId }),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Couldn't link (${res.status})`);
      setDecisions((prev) =>
        new Map(prev).set(studentId, { kind: "link", toddleId, name })
      );
      toast.success(`Linked to ${name} in Toddle.`);
    } catch (err) {
      console.error("[ToddleSyncAllDialog.link]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't link that student."
      );
    } finally {
      setLinkingId(null);
    }
  }

  function createAnyway(studentId: number) {
    setDecisions((prev) => new Map(prev).set(studentId, { kind: "create" }));
  }

  function undecide(studentId: number) {
    setDecisions((prev) => {
      const next = new Map(prev);
      next.delete(studentId);
      return next;
    });
  }

  async function run() {
    setRunning(true);
    try {
      const allowCreateStudentIds = [...decisions.entries()]
        .filter(([, d]) => d.kind === "create")
        .map(([id]) => id);
      const res = await fetch("/api/admin/students/toddle-sync-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowCreateStudentIds }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? `Sync failed (${res.status})`);
      }
      const live = data as BulkToddleSyncResponse;
      setResult(live);
      const ok = live.totals.created + live.totals.updated;
      if (ok > 0) {
        toast.success(
          `Synced ${ok} student${ok === 1 ? "" : "s"} to Toddle` +
            (live.totals.created > 0 ? ` (${live.totals.created} created)` : "") +
            "."
        );
      }
      if (live.totals.skipped > 0) {
        toast.warning(
          `${live.totals.skipped} student${
            live.totals.skipped === 1 ? "" : "s"
          } skipped — Toddle may already have them. Nothing was created.`
        );
      }
      if (live.totals.failed > 0) {
        toast.error(
          `${live.totals.failed} student${live.totals.failed === 1 ? "" : "s"} failed — see the list.`
        );
      }
    } catch (err) {
      console.error("[ToddleSyncAllDialog.run]", err);
      toast.error(
        err instanceof Error ? err.message : "Couldn't run the Toddle sync."
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (running) return;
        setOpen(next);
        if (!next) {
          setResult(null);
          // Decisions are answers about a specific preview. Reopening
          // re-reads Toddle, so carrying stale ones over would let a
          // "create anyway" outlive the situation that justified it.
          setDecisions(new Map());
          setReadiness(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="bg-white shrink-0"
          title={
            lastSyncedAt
              ? `Most recent Toddle sync: ${new Date(lastSyncedAt).toLocaleString(
                  "en-US",
                  { dateStyle: "medium", timeStyle: "short" }
                )}${
                  neverSyncedCount
                    ? ` · ${neverSyncedCount} shown student${
                        neverSyncedCount === 1 ? "" : "s"
                      } never synced`
                    : ""
                }`
              : "No shown enrolled student has ever been pushed to Toddle"
          }
        >
          <RefreshCw className="size-3.5 mr-1.5" aria-hidden="true" />
          Sync All to Toddle
          {lastSyncedAt ? (
            <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
              · {formatNoteTimestamp(lastSyncedAt)}
            </span>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl max-h-[88vh] flex flex-col gap-0 overflow-hidden">
        <DialogHeader>
          <DialogTitle>Sync All to Toddle</DialogTitle>
          <DialogDescription>
            Runs the full Toddle sync for every enrolled student — profile
            fields, school email, enrollment date, home address, photo,
            family members with their contact info, and crew class
            placement. Existing Toddle students are matched and updated,
            never duplicated, so this is safe to re-run.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overscroll-contain py-4 pr-1 space-y-4">
          {running ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Syncing every enrolled student — this can take a couple of
              minutes…
            </div>
          ) : result ? (
            <>
              {/* Every outcome gets a chip, including the zeroes: "0
                  new profiles" and "0 failed" are answers, and hiding
                  them makes a clean run look like a partial report. */}
              <div className="flex flex-wrap gap-1.5">
                <TotalChip
                  className="bg-blue-50 text-blue-700 border-blue-200"
                  label={`${result.totals.created} · New in Toddle`}
                />
                <TotalChip
                  className="bg-emerald-50 text-emerald-700 border-emerald-200"
                  label={`${result.totals.updated} · Changed`}
                />
                <TotalChip
                  className="bg-muted text-muted-foreground border-border"
                  label={`${result.totals.unchanged} · Already current`}
                />
                {result.totals.skipped > 0 ? (
                  <TotalChip
                    className="bg-amber-50 text-amber-700 border-amber-200"
                    label={`${result.totals.skipped} · Needs a decision`}
                  />
                ) : null}
                <TotalChip
                  className={cn(
                    result.totals.failed > 0
                      ? "bg-red-50 text-red-700 border-red-200"
                      : "bg-muted text-muted-foreground border-border"
                  )}
                  label={`${result.totals.failed} · Not synced`}
                />
              </div>

              {/* Nothing was written for these — the run stopped short
                  of creating a second record for a child Toddle looks
                  to already have. Reopening the dialog offers the
                  link-or-create choice per student. */}
              {result.totals.skipped > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                    Skipped — Toddle may already have these students
                  </p>
                  <p className="mt-1 text-xs text-amber-800">
                    Nothing was created or changed for them. Close and
                    reopen this dialog to link each one to the record
                    Toddle already holds, or to confirm it&rsquo;s a
                    different child.
                  </p>
                  <ul className="mt-2 space-y-1">
                    {result.rows
                      .filter((r) => r.action === "skipped")
                      .map((r) => (
                        <li key={r.student_id} className="text-sm">
                          <span className="font-medium">{r.student_name}</span>
                          <span className="text-amber-800">
                            {" — looks like "}
                            {(r.candidates ?? [])
                              .map((c) => c.name)
                              .join(", ") || "an existing Toddle record"}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}

              {/* Students Toddle neither matched nor accepted, pulled
                  out of the table so they can't be missed in a
                  75-row scroll. Each carries the reason Toddle gave. */}
              {result.totals.failed > 0 ? (
                <div className="rounded-md border border-red-200 bg-red-50/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-red-700">
                    Not added or found in Toddle
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {result.rows
                      .filter((r) => r.action === "failed")
                      .map((r) => (
                        <li key={r.student_id} className="text-sm">
                          <span className="font-medium">{r.student_name}</span>
                          <span className="text-red-700">
                            {" — "}
                            {r.error ?? "Sync failed."}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}

              {/* Ghost records: synced fine, but an archived Toddle record is
          squatting on the student id, so it couldn't be stamped. */}
      {result.rows.some((r) => r.source_id_blocked) ? (
        <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
            Archived duplicate in Toddle
          </p>
          <p className="mt-1 text-xs text-amber-800">
            These students synced, but an archived Toddle record still
            holds their student ID, so it couldn&rsquo;t be written onto
            their live profile. Delete the archived duplicate in Toddle
            when you get a chance — nothing breaks until then.
          </p>
          <p className="mt-1.5 text-sm">
            {result.rows
              .filter((r) => r.source_id_blocked)
              .map((r) => r.student_name)
              .join(", ")}
          </p>
        </div>
      ) : null}

      {/* Loose matches: the Toddle record didn't carry our
                  sourceId, so it was identified by name alone. Worth
                  eyeballing once — a wrong match writes one student's
                  details onto another's profile. */}
              {result.rows.some((r) => r.matched_by === "name") ? (
                <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                    Matched by name only
                  </p>
                  <p className="mt-1 text-xs text-amber-800">
                    These Toddle records weren&rsquo;t carrying our student
                    ID, so they were matched on name. The sync stamps the
                    ID as it goes, so this should be a one-time notice per
                    student.
                  </p>
                  <p className="mt-1.5 text-sm">
                    {result.rows
                      .filter((r) => r.matched_by === "name")
                      .map((r) => r.student_name)
                      .join(", ")}
                  </p>
                </div>
              ) : null}
              <div className="rounded-md border overflow-hidden">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col className="w-[26%]" />
                    <col className="w-[14%]" />
                    <col className="w-[12%]" />
                    <col className="w-[14%]" />
                    <col className="w-[34%]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Student</th>
                      <th className="px-3 py-2 font-medium">Result</th>
                      <th className="px-3 py-2 font-medium">Photo</th>
                      <th className="px-3 py-2 font-medium">Family</th>
                      <th className="px-3 py-2 font-medium">
                        What changed / notes
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {result.rows.map((row) => (
                      <ResultRow key={row.student_id} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <PreflightPanel
              readiness={readiness}
              loading={loadingReadiness}
              comparedToToddle={comparedToToddle}
              decisions={decisions}
              linkingId={linkingId}
              onLink={link}
              onCreateAnyway={createAnyway}
              onUndecide={undecide}
            />
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            {result
              ? `Done — ${result.totals.created + result.totals.updated} of ${
                  result.rows.length
                } student${result.rows.length === 1 ? "" : "s"} moved; each student's Toddle link is saved on their record.`
              : loadingReadiness
                ? "Comparing only — nothing has been pushed to Toddle yet."
                : ""}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                setResult(null);
              }}
              disabled={running}
            >
              {result ? "Close" : "Cancel"}
            </Button>
            {!result ? (
              <Button
                onClick={() => void run()}
                disabled={running || loadingReadiness}
                title={
                  loadingReadiness
                    ? "Still comparing the roster against Toddle — the review lands first."
                    : undefined
                }
              >
                {running ? (
                  <Loader2
                    className="size-3.5 mr-1.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <RefreshCw className="size-3.5 mr-1.5" aria-hidden="true" />
                )}
                Sync all students
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What the run will do, before it does it.
 *
 * The report leads: which students carry data Toddle doesn't have
 * yet, and exactly which fields move on each. That is the question an
 * admin is standing here to answer — "76 are ready" is not, because
 * the run is safe either way.
 *
 * Below it, in descending order of "you have to act on this": students
 * Toddle will reject, students missing something Toddle requires, and
 * — folded away — the fields we hold no data for, which land blank.
 * That last list is aggregated by field, because "46 students have no
 * phone" is the actionable shape, not 46 rows saying "no phone".
 */
function PreflightPanel({
  readiness,
  loading,
  comparedToToddle,
  decisions,
  linkingId,
  onLink,
  onCreateAnyway,
  onUndecide,
}: {
  readiness: PreflightRow[] | null;
  loading: boolean;
  comparedToToddle: boolean;
  decisions: Map<number, Decision>;
  linkingId: number | null;
  onLink: (studentId: number, toddleId: string, name: string) => void;
  onCreateAnyway: (studentId: number) => void;
  onUndecide: (studentId: number) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Comparing every student against Toddle…
      </div>
    );
  }
  if (!readiness || readiness.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Every enrolled student will be pushed to Toddle. One
        student&rsquo;s problem never stops the rest.
      </p>
    );
  }

  const blocked = readiness.filter((r) => !r.ready);

  const counts = {
    create: 0,
    change: 0,
    current: 0,
    review: 0,
    conflict: 0,
    unknown: 0,
  };
  for (const row of readiness) {
    counts[row.preview?.status ?? "unknown"] += 1;
  }
  // Only the students something would happen to — a 75-row list where
  // 66 say "no change" hides the nine that matter. A flagged student
  // who has been linked joins them: the run will now update the record
  // they were linked to.
  const changing = readiness.filter(
    (r) =>
      r.preview?.status === "create" ||
      r.preview?.status === "change" ||
      (r.preview?.status === "review" &&
        decisions.get(r.student_id) !== undefined)
  );
  const conflicts = readiness.filter((r) => r.preview?.status === "conflict");
  const reviews = readiness.filter((r) => r.preview?.status === "review");
  const undecided = reviews.filter((r) => !decisions.has(r.student_id));
  // Chips follow the decisions, not the raw preview — once a flagged
  // student is linked they'll be updated, and once confirmed as new
  // they'll be created. Leaving them out of the counts would make the
  // table and the chips disagree in front of the admin.
  for (const row of reviews) {
    const d = decisions.get(row.student_id);
    if (d?.kind === "link") counts.change += 1;
    else if (d?.kind === "create") counts.create += 1;
  }

  // Roll the profile-level gaps up by field: label → who's missing it.
  const gaps = new Map<string, { label: string; names: string[] }>();
  for (const row of readiness) {
    for (const f of row.fields) {
      if (f.severity !== "profile" || f.status === "ok") continue;
      const entry = gaps.get(f.key) ?? { label: f.label, names: [] };
      entry.names.push(row.student_name);
      gaps.set(f.key, entry);
    }
  }
  const gapList = [...gaps.values()].sort(
    (a, b) => b.names.length - a.names.length
  );

  return (
    <div className="space-y-4">
      {/* Comes first and can't be collapsed: this is the only thing in
          the dialog that asks the admin for something, and the only
          outcome a re-run can't repair. Undecided students are simply
          skipped — the sync never creates past this point on its own. */}
      {reviews.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50/60 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
            Toddle may already have {reviews.length === 1 ? "this student" : "these students"}
          </p>
          <p className="mt-1 text-xs text-amber-900">
            Their name and school email don&rsquo;t line up with anything
            in Toddle, but something close does — usually a spelling
            difference (a suffix, a compound last name). Creating them
            makes a second record someone has to merge by hand, so
            nothing happens until you say which it is.{" "}
            {undecided.length > 0
              ? `${undecided.length} still ${
                  undecided.length === 1 ? "needs" : "need"
                } an answer and will be skipped.`
              : "All answered."}
          </p>
          <ul className="mt-2.5 space-y-2.5">
            {reviews.map((row) => (
              <ReviewRow
                key={row.student_id}
                row={row}
                decision={decisions.get(row.student_id)}
                linking={linkingId === row.student_id}
                onLink={onLink}
                onCreateAnyway={onCreateAnyway}
                onUndecide={onUndecide}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {/* The report: who moves on this push, and what moves on them.
          Compared against Toddle right now, BEFORE anything is sent. */}
      {comparedToToddle ? (
        <div className="rounded-md border overflow-hidden">
          <div className="border-b bg-muted/40 px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              What this push will change
            </p>
            <p className="mt-1 text-sm">
              {changing.length === 0
                ? `Nothing — all ${readiness.length} enrolled students already match Toddle.`
                : `${changing.length} of ${readiness.length} enrolled students have data Toddle doesn't have yet. The other ${counts.current} already match and won't be touched.`}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <TotalChip
                className="bg-blue-50 text-blue-700 border-blue-200"
                label={`${counts.create} · New in Toddle`}
              />
              <TotalChip
                className="bg-emerald-50 text-emerald-700 border-emerald-200"
                label={`${counts.change} · Updated`}
              />
              <TotalChip
                className="bg-muted text-muted-foreground border-border"
                label={`${counts.current} · Already match`}
              />
              {undecided.length > 0 ? (
                <TotalChip
                  className="bg-amber-50 text-amber-700 border-amber-200"
                  label={`${undecided.length} · Skipped, needs a decision`}
                />
              ) : null}
              {counts.conflict > 0 ? (
                <TotalChip
                  className="bg-red-50 text-red-700 border-red-200"
                  label={`${counts.conflict} · Will be rejected`}
                />
              ) : null}
              {blocked.length > 0 ? (
                <TotalChip
                  className="bg-red-50 text-red-700 border-red-200"
                  label={`${blocked.length} · Can't sync yet`}
                />
              ) : null}
            </div>
          </div>
          {changing.length > 0 ? (
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[70%]" />
              </colgroup>
              <thead>
                <tr className="border-b bg-muted/20 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-1.5 font-medium">Student</th>
                  <th className="px-3 py-1.5 font-medium">
                    What Toddle gets from us
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {changing.map((row) => (
                  <tr key={row.student_id} className="align-top">
                    <td
                      className="px-3 py-1.5 font-medium overflow-hidden text-ellipsis whitespace-nowrap"
                      title={row.student_name}
                    >
                      {row.student_name}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-1.5",
                        row.preview?.status === "create"
                          ? "text-blue-700"
                          : "text-muted-foreground"
                      )}
                    >
                      {previewDetail(row, decisions.get(row.student_id))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : (
        <p className="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-800">
          Couldn&rsquo;t read Toddle just now (it rate-limits after a
          run), so this preview can&rsquo;t say what would change. The
          checks below come from our own records and are still accurate.
        </p>
      )}

      {/* Would be created, but Toddle already holds the school email —
          a create it will refuse. Fixable only on one side or the
          other, so it gets names and the reason in full. */}
      {conflicts.length > 0 ? (
        <div className="rounded-md border border-red-200 bg-red-50/60 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-red-700">
            Toddle will reject these
          </p>
          <ul className="mt-2 space-y-1.5">
            {conflicts.map((row) => (
              <li key={row.student_id} className="text-sm text-red-700">
                <span className="font-medium">{row.student_name}</span> —{" "}
                {row.preview?.note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {blocked.length > 0 ? (
        <div className="rounded-md border border-red-200 bg-red-50/60 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-red-700">
            Missing something Toddle requires
          </p>
          <ul className="mt-2 space-y-1.5">
            {blocked.map((row) => (
              <li key={row.student_id} className="text-sm">
                <span className="font-medium">{row.student_name}</span>
                <span className="text-red-700">
                  {" — "}
                  {row.fields
                    .filter((f) => f.severity === "blocking" && f.status !== "ok")
                    .map((f) => `${f.label} (${f.fixedOn})`)
                    .join("; ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Data quality, not a sync problem — folded away so it can't be
          mistaken for something blocking the run, and labelled in
          plain words so it doesn't need decoding. */}
      {gapList.length > 0 ? (
        <details className="rounded-md border [&[open]_.chev]:rotate-90">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
            <ChevronRight
              className="chev size-3.5 shrink-0 transition-transform"
              aria-hidden="true"
            />
            We have no data for {gapList.length} field
            {gapList.length === 1 ? "" : "s"} — they&rsquo;ll be blank in
            Toddle
          </summary>
          <div className="border-t px-3 py-2.5">
            <p className="text-xs text-muted-foreground">
              These students sync normally. We simply hold nothing for
              these fields, so Toddle receives them empty. Fill them in
              on the student&rsquo;s record and re-run to push them.
            </p>
            <ul className="mt-2 space-y-1">
              {gapList.map((gap) => (
                <li
                  key={gap.label}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="text-muted-foreground">{gap.label}</span>
                  <span
                    className="shrink-0 tabular-nums"
                    title={gap.names.slice(0, 40).join(", ")}
                  >
                    {gap.names.length} student
                    {gap.names.length === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}
    </div>
  );
}

/**
 * One flagged student and the choice about them: point at the record
 * Toddle already has, or confirm this is a different child.
 *
 * The candidate is shown with its email, birthday and creation date
 * because those are what actually settle it — two names can look
 * identical and be different children, and a record created before the
 * integration existed is usually the one to keep.
 */
function ReviewRow({
  row,
  decision,
  linking,
  onLink,
  onCreateAnyway,
  onUndecide,
}: {
  row: PreflightRow;
  decision?: Decision;
  linking: boolean;
  onLink: (studentId: number, toddleId: string, name: string) => void;
  onCreateAnyway: (studentId: number) => void;
  onUndecide: (studentId: number) => void;
}) {
  const candidates = row.preview?.candidates ?? [];
  return (
    <li className="rounded border border-amber-200 bg-white p-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{row.student_name}</span>
        {decision ? (
          <button
            type="button"
            onClick={() => onUndecide(row.student_id)}
            className="shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Change
          </button>
        ) : null}
      </div>

      {decision ? (
        <p className="mt-1 text-xs text-emerald-700">
          {decision.kind === "link"
            ? `Linked to ${decision.name} — this run will update that record.`
            : "Confirmed as a different child — this run will create a new Toddle profile."}
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {candidates.map((c) => (
            <li
              key={c.toddleId}
              className="flex flex-wrap items-baseline justify-between gap-2"
            >
              <span className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{c.name}</span>
                {c.email ? ` · ${c.email}` : ""}
                {c.dob ? ` · born ${c.dob}` : ""}
                {c.createdAt
                  ? ` · added ${new Date(c.createdAt).toLocaleDateString(
                      "en-US",
                      { month: "short", day: "numeric", year: "numeric" }
                    )}`
                  : ""}
                {` — ${c.reason}`}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 text-xs"
                disabled={linking}
                onClick={() => onLink(row.student_id, c.toddleId, c.name)}
              >
                {linking ? (
                  <Loader2 className="size-3 mr-1 animate-spin" aria-hidden="true" />
                ) : null}
                This is the same student
              </Button>
            </li>
          ))}
          <li>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground"
              disabled={linking}
              onClick={() => onCreateAnyway(row.student_id)}
            >
              None of these — create a new Toddle student
            </Button>
          </li>
        </ul>
      )}
    </li>
  );
}

/**
 * What one previewed student will actually send, in words.
 *
 * A `change` carrying no named fields is NOT "nothing differs" — it
 * means Toddle didn't return those fields for us to compare against,
 * so the row is being re-sent blind. Saying so beats an empty cell
 * that reads as a bug.
 */
function previewDetail(row: PreflightRow, decision?: Decision): string {
  if (decision?.kind === "link")
    return `Full profile — onto ${decision.name}, the record Toddle already has`;
  if (decision?.kind === "create" || row.preview?.status === "create")
    return "Full profile — first push";
  const list = formatToddleFieldList(row.preview?.changedFields ?? []);
  if (!list) return "Re-sent — Toddle didn't return these fields to compare";
  return list.charAt(0).toUpperCase() + list.slice(1);
}

function TotalChip({ className, label }: { className: string; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        className
      )}
    >
      {label}
    </span>
  );
}

function ResultRow({ row }: { row: BulkToddleSyncRow }) {
  const resultMeta =
    row.action === "failed"
      ? {
          label: "Not synced",
          className: "bg-red-50 text-red-700 border-red-200",
        }
      : row.action === "skipped"
        ? {
            label: "Skipped",
            className: "bg-amber-50 text-amber-700 border-amber-200",
          }
        : row.action === "created"
        ? {
            label: "Created",
            className: "bg-blue-50 text-blue-700 border-blue-200",
          }
        : row.action === "unchanged"
          ? {
              label: "No change",
              className: "bg-muted text-muted-foreground border-border",
            }
          : {
              label: "Changed",
              className: "bg-emerald-50 text-emerald-700 border-emerald-200",
            };
  const family =
    row.family_synced + row.family_failed === 0
      ? "—"
      : row.family_failed > 0
        ? `${row.family_synced} ok · ${row.family_failed} failed`
        : `${row.family_synced} synced`;
  // What actually moved, most specific first: the failure reason, the
  // named field changes, then the crew placement. A "Changed" row with
  // no field list means the prior record couldn't be read to compare,
  // which is a different thing from nothing having changed.
  const changed =
    row.changed_fields.length > 0
      ? formatToddleFieldList(row.changed_fields)
      : "";
  const notes =
    row.error ?? [changed, row.crew].filter(Boolean).join(" · ");
  return (
    <tr className="align-top">
      <td
        className="px-3 py-2 font-medium overflow-hidden text-ellipsis whitespace-nowrap"
        title={row.student_name}
      >
        {row.student_name}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
            resultMeta.className
          )}
        >
          {resultMeta.label}
        </span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
        {row.photo === "synced" ? "Pushed" : row.photo === "failed" ? "Failed" : "—"}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
        {family}
      </td>
      <td
        className={cn(
          "px-3 py-2 overflow-hidden text-ellipsis whitespace-nowrap",
          row.error ? "text-red-700" : "text-muted-foreground"
        )}
        title={notes || undefined}
      >
        {notes || "—"}
      </td>
    </tr>
  );
}
