"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
} from "@/components/ui/file-upload";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import {
  formatNoteTimestamp,
  formatRelativeShort,
} from "@/lib/format-note-time";
import type {
  XanoScholarship,
  XanoScholarshipBenefit,
  XanoScholarshipContributingMember,
} from "@/lib/xano";

/** File metadata shape Xano returns inside the multi-file array
 *  slots. Mirrors the parent-side `XanoFileMetadata`; reproduced
 *  inline so this admin component doesn't import the parent helper. */
interface XanoFileMetadata {
  name?: string;
  path?: string;
  size?: number;
  url?: string;
  [key: string]: unknown;
}

function toFileArray(v: unknown): XanoFileMetadata[] {
  if (!v) return [];
  if (Array.isArray(v)) return v as XanoFileMetadata[];
  if (typeof v === "object") return [v as XanoFileMetadata];
  return [];
}

/** Xano vault base — instance URL (no `/api:*` suffix). The vault
 *  serves uploaded files at `${INSTANCE}/vault/...`, with `path`
 *  on each file metadata object holding the trailing portion.
 *  Falls back to the production hostname when the env var is
 *  missing so dev preview links still resolve. */
const XANO_VAULT_BASE =
  process.env.NEXT_PUBLIC_XANO_BASE ?? "https://xsc3-mvx7-r86m.n7e.xano.io";

/**
 * Resolve a viewable URL for a Xano file. Prefers the explicit
 * `url` Xano sometimes hands back, falls back to constructing one
 * from the `path` (`/vault/...`) so files surface even when the
 * upstream payload doesn't include a signed URL. Returns `null`
 * when neither is usable — caller renders a non-link span.
 */
function fileViewUrl(file: XanoFileMetadata): string | null {
  if (typeof file.url === "string" && file.url.length > 0) return file.url;
  if (typeof file.path === "string" && file.path.startsWith("/")) {
    return `${XANO_VAULT_BASE}${file.path}`;
  }
  return null;
}

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

interface Props {
  scholarship: XanoScholarship;
  /** Family id — kept on the prop signature for backwards
   *  compatibility with earlier callers. Not used by the table
   *  itself anymore (the per-member Notes button was removed); a
   *  future surface that reintroduces section-scoped notes from
   *  this block can wire in `<FamilyNotesSheet>` again. */
  familyId: number;
  /** Bubbles up scholarship-level confirm flips (today the
   *  unemployment letter on the no-contributing-member path) so
   *  the parent re-fetches the scholarship row and the gate flips
   *  immediately. SWR doesn't auto-revalidate the parent's
   *  /family-applications cache on its own. */
  onScholarshipChanged?: () => void;
  /** When the parent fetched contributing members and benefits via
   *  the composite scholarship-details endpoint, pass them in here.
   *  The block skips its own SWR fetches when an override is
   *  provided, eliminating duplicate filtered round-trips against
   *  Xano's child-list endpoints. Both overrides are independent —
   *  passing one without the other is fine (the missing side falls
   *  back to its own SWR fetch). */
  membersOverride?: XanoScholarshipContributingMember[];
  benefitsOverride?: XanoScholarshipBenefit[];
  /** Called after a successful per-slot confirm PATCH so the parent
   *  can refetch the composite endpoint and re-render the table
   *  with updated audit columns. Independent of
   *  `onScholarshipChanged` (which refetches the scholarship row
   *  itself). */
  onChildrenChanged?: () => void;
}

/**
 * Read + verify surface for every file the parent's Opportunity
 * Scholarship form collected. Renders a single flat table:
 *
 *   | Document                  | Files            | Confirmation       |
 *   | Larry Thompson · W-2      | [link] file.png  | [Mark conf.] [Undo]|
 *   | Larry Thompson · Pay 1    | [link] stub.pdf  | ✓ Confirmed [Undo] |
 *   | Government · Soc Sec      | [link] letter.pd | [Mark conf.] [Undo]|
 *   | SNAP benefits award …     | [link] letter.pd | —                  |
 *
 * Confirmation cells render the Mark Confirmed + Undo button pair for
 * any row whose source table has a matching `*_confirm` Xano column.
 * Today that's contributing-member slots and government benefits;
 * SNAP and unemployment still render "—" until those rows gain
 * audit columns.
 *
 * Confirmed rows surface a "Confirmed by Hunter Thompson · 2 hr ago"
 * caption beneath the action buttons — pulled from the matching
 * audit columns (`*_confirm_time`, `*_admin_confirm`) and resolved
 * to a display name via the `/api/admin/admins` lookup.
 *
 * The Confirm Scholarship Award Amount button on each per-student
 * row reads from the same SWR keys used here, so its gate flips
 * automatically as admins check off rows in this table.
 */
export function DocumentsToReviewBlock({
  scholarship,
  familyId: _familyId,
  onScholarshipChanged,
  membersOverride,
  benefitsOverride,
  onChildrenChanged,
}: Props) {
  // Skip the per-table SWR fetch when the parent already handed an
  // override array down — the composite scholarship-details
  // endpoint serves the same data pre-filtered, so a parallel
  // fetch here would just duplicate the work (and re-trigger every
  // time SWR revalidates). Passing `null` to `useSWR` disables it.
  const membersSwrKey =
    membersOverride !== undefined
      ? null
      : `/api/admin/contributing-members?scholarshipId=${scholarship.id}`;
  const { data: membersData, isLoading: membersFetchLoading, mutate: mutateMembersInternal } = useSWR<
    XanoScholarshipContributingMember[]
  >(membersSwrKey, adminFetcher);
  const benefitsSwrKey =
    benefitsOverride !== undefined
      ? null
      : scholarship.government_benefits
        ? `/api/admin/scholarship-benefits?scholarshipId=${scholarship.id}`
        : null;
  const { data: benefitsData, isLoading: benefitsFetchLoading, mutate: mutateBenefitsInternal } = useSWR<
    XanoScholarshipBenefit[]
  >(benefitsSwrKey, adminFetcher);
  // When an override is in play we have data immediately (the
  // parent already fetched it); skip the loading flicker.
  const membersLoading =
    membersOverride !== undefined ? false : membersFetchLoading;
  const benefitsLoading =
    benefitsOverride !== undefined ? false : benefitsFetchLoading;
  // Bubble per-slot confirm flips back to the parent so its
  // composite cache stays in sync. Falls back to no-op when the
  // parent didn't wire the callback (e.g. legacy callers).
  const mutateMembers = async () => {
    if (membersOverride !== undefined) {
      onChildrenChanged?.();
    } else {
      await mutateMembersInternal();
    }
  };
  const mutateBenefits = async () => {
    if (benefitsOverride !== undefined) {
      onChildrenChanged?.();
    } else {
      await mutateBenefitsInternal();
    }
  };

  // Admin lookup — feeds the "Confirmed by Hunter Thompson" captions
  // under each confirmed row. The endpoint just exposes the same
  // `teachers_by_admin` Xano list `requireAdmin` reads, flattened to
  // an id → name map.
  const { data: adminsData } = useSWR<
    Array<{ id: string; teacherId: number; name: string; email: string }>
  >("/api/admin/admins", adminFetcher);
  const adminNameByTeacherId = new Map<number, string>();
  for (const a of adminsData ?? []) {
    if (a.teacherId > 0) adminNameByTeacherId.set(a.teacherId, a.name);
  }

  // Track which per-slot confirm is mid-PATCH so the row's spinner is
  // scoped to that one row rather than blanket-spinning everything.
  const [savingSlot, setSavingSlot] = useState<string | null>(null);

  const members = membersOverride ?? membersData ?? [];
  const benefits = benefitsOverride ?? benefitsData ?? [];

  // Build the flat row list. Each row carries its own confirmation
  // descriptor when applicable (contributing-member slots + government
  // benefits today). Adding new confirm-bearing slots is a matter of
  // pushing additional rows here with their `confirmation` populated.
  const rows = buildRows({
    scholarship,
    members,
    benefits,
    savingSlot,
    mutateMembers,
    mutateBenefits,
    setSavingSlot,
    onScholarshipChanged,
  });

  if (membersLoading || benefitsLoading) {
    return (
      <div className="rounded-md border bg-muted/20 overflow-hidden">
        <div className="px-4 py-2 border-b bg-muted/40">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Documents to Review
          </p>
        </div>
        <div className="p-4 space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      </div>
    );
  }

  // Total / confirmed counters drive the small progress chip in the
  // header strip. Unconfirmable rows (no `confirmation` descriptor)
  // are skipped.
  const confirmableRows = rows.filter((r) => r.confirmation);
  const confirmedCount = confirmableRows.filter(
    (r) => r.confirmation?.confirmed
  ).length;

  return (
    <div className="rounded-md border bg-muted/20 overflow-hidden">
      <div className="px-4 py-2 border-b bg-muted/40 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Documents to Review
        </p>
        {confirmableRows.length > 0 ? (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {confirmedCount}/{confirmableRows.length} confirmed
          </span>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs italic text-muted-foreground px-4 py-3">
          No additional documents required for this family&rsquo;s
          scholarship path.
        </p>
      ) : (
        // `table-fixed` is critical here — without it, the long
        // file names in the File(s) column (e.g. PandaDoc-style
        // screencapture URLs) push the table wider than the
        // container and force horizontal scroll. With fixed
        // layout, every column respects its declared width and
        // the inner truncate styles inside <FileLink> can clip
        // the names with an ellipsis. The non-px columns add up
        // to ~43%, leaving roughly half the row for files.
        <Table className="text-sm table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[28%] text-[10px] uppercase tracking-wider text-muted-foreground">
                Document
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                File(s)
              </TableHead>
              {/* Audit columns — pulled out of the Confirmation cell
                  so the docs table reads as a proper grid instead
                  of stacking a long caption under each button. The
                  Time column gets a fixed narrow width since
                  relative-time strings are short and predictable. */}
              <TableHead className="w-[15%] text-[10px] uppercase tracking-wider text-muted-foreground">
                Confirmed by
              </TableHead>
              <TableHead className="w-[80px] text-[10px] uppercase tracking-wider text-muted-foreground">
                Time
              </TableHead>
              <TableHead className="w-[170px] text-right text-[10px] uppercase tracking-wider text-muted-foreground">
                Confirmation
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <DocRow
                key={row.key}
                row={row}
                adminNameByTeacherId={adminNameByTeacherId}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/* ─────────────────────── Row construction ─────────────────────── */

interface DocRowData {
  key: string;
  label: string;
  /** Optional sub-label rendered under the label in muted small text.
   *  Reserved for future use — the contributing-member income
   *  context that used to render here was removed because it
   *  duplicated information shown elsewhere on the page. */
  sublabel?: string | null;
  files: XanoFileMetadata[];
  /** Empty-files hint when `files` is empty. Encodes "expected but
   *  not uploaded" so admin sees what's missing from this family's
   *  declared path. */
  emptyHint?: string;
  /** Optional upload-on-behalf-of-family affordance. When provided
   *  the row renders an "Upload" / "Add file" button next to the
   *  file list; admin selects local file(s), they POST to /api/upload
   *  to land in the Xano vault, and the callback PATCHes the new
   *  metadata array onto the appropriate Xano column. Returning a
   *  Promise lets the parent revalidate its SWR cache before the
   *  button leaves the spinner state. */
  upload?: {
    /** Called with the user-selected `File[]` after the local
     *  picker resolves. Implementation handles the actual upload +
     *  PATCH; this block only renders the button + tracks the
     *  uploading state via the shared `savingSlot`. */
    onUpload: (newFiles: File[]) => Promise<void>;
    /** MIME / extension list passed to `<FileUpload accept>`. Defaults
     *  match the parent-side upload widgets when omitted. */
    accept?: string;
    /** Max number of files allowed in the picker. Defaults to 5. */
    maxFiles?: number;
  };
  /** When set, the row renders the Mark Confirmed + Undo button
   *  pair. Mark Confirmed flips the slot's `*_confirm` to true,
   *  Undo flips it back to false. Splitting the actions (rather
   *  than a single toggle) makes the confirmation feel intentional
   *  — the Undo button is always visible and just disabled when
   *  there's nothing to undo.
   *
   *  Audit metadata is populated from the matching `*_confirm_time` /
   *  `*_admin_confirm` columns when the boolean is true. The Doc
   *  row uses both to render a "Confirmed by Hunter · 2 hr ago"
   *  caption under the action buttons.
   *
   *  - `confirmedByName` — preferred. New schema stores the admin's
   *    display name directly on the row's `*_admin_confirm` text
   *    column, so the table can render the caption without a
   *    teacher-id → name lookup.
   *  - `confirmedByAdmin` — legacy teacher-id (number). Kept as a
   *    fallback for older sibling tables (e.g. scholarship-level
   *    SNAP / unemployment) whose columns are still typed `int`. */
  confirmation?: {
    confirmed: boolean;
    saving: boolean;
    onConfirm: () => Promise<void> | void;
    onUndo: () => Promise<void> | void;
    confirmedAt?: number | null;
    confirmedByName?: string;
    confirmedByAdmin?: number;
  };
}

function buildRows({
  scholarship,
  members,
  benefits,
  savingSlot,
  mutateMembers,
  mutateBenefits,
  setSavingSlot,
  onScholarshipChanged,
}: {
  scholarship: XanoScholarship;
  members: XanoScholarshipContributingMember[];
  benefits: XanoScholarshipBenefit[];
  savingSlot: string | null;
  mutateMembers: () => void;
  mutateBenefits: () => void;
  setSavingSlot: (s: string | null) => void;
  onScholarshipChanged?: () => void;
}): DocRowData[] {
  const rows: DocRowData[] = [];

  // SNAP path — when the family pre-qualifies via SNAP, the only
  // document on file is the award letter. There are no contributing
  // members, no government benefits, no unemployment letter. Render
  // ONLY the SNAP row and short-circuit — even if other flags
  // (no_contributing_member, government_benefits) drift true on a
  // legacy row, the SNAP path doesn't surface them.
  if (scholarship.isSNAPBenefits) {
    const slotKey = "snap";
    const confirmed = scholarship.is_snap_confirmed === true;
    const confirmedAt = scholarship.snap_confirm_time ?? null;
    const confirmedByAdmin = scholarship.snap_confirm_admin ?? 0;
    const patchSnap = async (next: boolean) => {
      setSavingSlot(slotKey);
      try {
        const res = await fetch(
          `/api/admin/scholarships/${scholarship.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_snap_confirmed: next }),
          }
        );
        if (!res.ok) {
          const errBody = await res.json().catch(() => null);
          throw new Error(errBody?.error ?? `Save failed (${res.status})`);
        }
        onScholarshipChanged?.();
      } catch (err) {
        console.error("Failed to update SNAP confirm:", err);
        toast.error(
          err instanceof Error ? err.message : "Couldn't update."
        );
      } finally {
        setSavingSlot(null);
      }
    };
    // Admin upload-on-behalf-of-family. Posts each file to
    // /api/upload (Xano vault), accumulates the returned metadata
    // onto the existing `snap_benefits` array, then PATCHes the
    // scholarship row. `onScholarshipChanged` revalidates upstream
    // SWR so the table reflects the new file without a refresh.
    const uploadSnap = async (newFiles: File[]) => {
      if (newFiles.length === 0) return;
      setSavingSlot(slotKey);
      try {
        let acc = toFileArray(scholarship.snap_benefits);
        for (const f of newFiles) {
          const formData = new FormData();
          formData.append("file", f);
          const uploadRes = await fetch("/api/upload", {
            method: "POST",
            body: formData,
          });
          if (!uploadRes.ok) {
            const body = await uploadRes.json().catch(() => null);
            throw new Error(
              body?.error ?? `Upload failed (${uploadRes.status})`
            );
          }
          const metadata = (await uploadRes.json()) as Record<string, unknown>;
          acc = [...acc, metadata];
        }
        const patchRes = await fetch(
          `/api/admin/scholarships/${scholarship.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ snap_benefits: acc }),
          }
        );
        if (!patchRes.ok) {
          const body = await patchRes.json().catch(() => null);
          throw new Error(body?.error ?? `Save failed (${patchRes.status})`);
        }
        toast.success(
          newFiles.length === 1
            ? "SNAP award letter uploaded."
            : `${newFiles.length} files uploaded.`
        );
        onScholarshipChanged?.();
      } catch (err) {
        console.error("Failed to upload SNAP letter:", err);
        toast.error(
          err instanceof Error ? err.message : "Couldn't upload file."
        );
      } finally {
        setSavingSlot(null);
      }
    };
    rows.push({
      key: slotKey,
      label: "SNAP benefits award letter",
      files: toFileArray(scholarship.snap_benefits),
      emptyHint: "No award letter uploaded yet.",
      upload: {
        onUpload: uploadSnap,
        accept: ".pdf,.jpg,.jpeg,.png",
        maxFiles: 5,
      },
      confirmation: {
        confirmed,
        saving: savingSlot === slotKey,
        onConfirm: () => patchSnap(true),
        onUndo: () => patchSnap(false),
        confirmedAt: confirmed ? confirmedAt : null,
        confirmedByAdmin: confirmed ? confirmedByAdmin : 0,
      },
    });
    return rows;
  }

  // Tax Return — required on the Opportunity Scholarship path
  // (the family-financial-form route). Lives at the scholarship
  // level (one row per family per year, not per contributing
  // member) because it covers the household's whole return.
  // Renders first in the doc list so admin reviews the umbrella
  // document before drilling into per-member income proof. Excluded
  // on the SNAP path (handled by the early return above) and the
  // Opted-out path (the function never reaches here on that path
  // since the docs block doesn't render).
  if (!scholarship.isNotParticipating) {
    const slotKey = "tax_return";
    const confirmed = scholarship.tax_document_confirm === true;
    const confirmedAt = scholarship.tax_document_confirm_time ?? null;
    // Newer column convention — `*_admin` is text (admin display
    // name) rather than int (teacher id), so the row reads the
    // string directly via `confirmedByName` and skips the teacher
    // lookup map.
    const confirmedByName = (scholarship.tax_document_confirm_admin ?? "").trim();
    const patchTaxConfirm = async (next: boolean) => {
      setSavingSlot(slotKey);
      try {
        const res = await fetch(
          `/api/admin/scholarships/${scholarship.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tax_document_confirm: next }),
          }
        );
        if (!res.ok) {
          const errBody = await res.json().catch(() => null);
          throw new Error(errBody?.error ?? `Save failed (${res.status})`);
        }
        onScholarshipChanged?.();
      } catch (err) {
        console.error("Failed to update tax-return confirm:", err);
        toast.error(
          err instanceof Error ? err.message : "Couldn't update."
        );
      } finally {
        setSavingSlot(null);
      }
    };
    const uploadTaxReturn = async (newFiles: File[]) => {
      if (newFiles.length === 0) return;
      setSavingSlot(slotKey);
      try {
        let acc = toFileArray(scholarship.tax_return);
        for (const f of newFiles) {
          const formData = new FormData();
          formData.append("file", f);
          const uploadRes = await fetch("/api/upload", {
            method: "POST",
            body: formData,
          });
          if (!uploadRes.ok) {
            const body = await uploadRes.json().catch(() => null);
            throw new Error(
              body?.error ?? `Upload failed (${uploadRes.status})`
            );
          }
          const metadata = (await uploadRes.json()) as Record<string, unknown>;
          acc = [...acc, metadata];
        }
        const patchRes = await fetch(
          `/api/admin/scholarships/${scholarship.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tax_return: acc }),
          }
        );
        if (!patchRes.ok) {
          const body = await patchRes.json().catch(() => null);
          throw new Error(body?.error ?? `Save failed (${patchRes.status})`);
        }
        toast.success(
          newFiles.length === 1
            ? "Tax return uploaded."
            : `${newFiles.length} files uploaded.`
        );
        onScholarshipChanged?.();
      } catch (err) {
        console.error("Failed to upload tax return:", err);
        toast.error(
          err instanceof Error ? err.message : "Couldn't upload file."
        );
      } finally {
        setSavingSlot(null);
      }
    };
    rows.push({
      key: slotKey,
      label: "Prior-year tax return",
      sublabel: "Most recent federal 1040 + supporting schedules",
      files: toFileArray(scholarship.tax_return),
      emptyHint: "No tax return uploaded yet.",
      upload: {
        onUpload: uploadTaxReturn,
        accept: ".pdf,.jpg,.jpeg,.png",
        maxFiles: 10,
      },
      confirmation: {
        confirmed,
        saving: savingSlot === slotKey,
        onConfirm: () => patchTaxConfirm(true),
        onUndo: () => patchTaxConfirm(false),
        confirmedAt: confirmed ? confirmedAt : null,
        confirmedByName: confirmed ? confirmedByName : undefined,
      },
    });
  }

  // Unemployment — only when the family declared no contributing
  // member. Now confirmable via `is_unemployment_confirm`
  // (with `unemployment_confirm_time` / `unemployment_confirm_admin`
  // audit columns the scholarships PATCH route auto-stamps).
  if (scholarship.no_contributing_member) {
    const slotKey = "unemployment";
    const confirmed = scholarship.is_unemployment_confirm === true;
    const confirmedAt = scholarship.unemployment_confirm_time ?? null;
    const confirmedByAdmin = scholarship.unemployment_confirm_admin ?? 0;
    const patchUnemployment = async (next: boolean) => {
      setSavingSlot(slotKey);
      try {
        const res = await fetch(
          `/api/admin/scholarships/${scholarship.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_unemployment_confirm: next }),
          }
        );
        if (!res.ok) {
          const errBody = await res.json().catch(() => null);
          throw new Error(errBody?.error ?? `Save failed (${res.status})`);
        }
        onScholarshipChanged?.();
      } catch (err) {
        console.error("Failed to update unemployment confirm:", err);
        toast.error(
          err instanceof Error ? err.message : "Couldn't update."
        );
      } finally {
        setSavingSlot(null);
      }
    };
    rows.push({
      key: slotKey,
      label: "Unemployment / termination letter",
      files: toFileArray(scholarship.unemployment_letter),
      emptyHint: "No unemployment paperwork uploaded yet.",
      confirmation: {
        confirmed,
        saving: savingSlot === slotKey,
        onConfirm: () => patchUnemployment(true),
        onUndo: () => patchUnemployment(false),
        confirmedAt: confirmed ? confirmedAt : null,
        confirmedByAdmin: confirmed ? confirmedByAdmin : 0,
      },
    });
  }

  // Contributing members — one row per non-empty file slot per
  // member. Each row's confirm pair (Mark Confirmed + Undo) flips
  // the matching `*_confirm` boolean on the member.
  if (!scholarship.no_contributing_member) {
    for (const m of members) {
      const memberLabel =
        m.first_name || m.last_name
          ? `${m.first_name} ${m.last_name}`.trim()
          : `Contributing member #${m.id}`;

      // `confirmKey` / `timeKey` / `adminKey` triple ties each
      // file slot to its three Xano columns: the confirm boolean
      // and the two audit columns (timestamp + confirming admin's
      // teacher id). The triple gets bundled onto the row's
      // `confirmation` descriptor so the presenter can render
      // "Confirmed by Hunter · 2 hr ago" without re-deriving the
      // mapping.
      const slotEntries = [
        {
          slotKey: "w2",
          label: "W-2",
          files: toFileArray(m.w2),
          confirmKey: "w2_confirm" as const,
          // Xano named the W-2 timestamp column `w2_confirmation`
          // instead of `w2_confirm_time` — diverges from the
          // paystub convention. Don't normalize away the
          // divergence client-side or the PATCH gets rejected on
          // unknown column. See the matching note on the type
          // and the admin route's CONFIRM_PAIRS.
          timeKey: "w2_confirmation" as const,
          adminKey: "w2_admin_confirm" as const,
        },
        {
          slotKey: "paystub_1",
          label: "Pay stub 1",
          files: toFileArray(m.paystub_1),
          confirmKey: "paystub_1_confirm" as const,
          timeKey: "paystub_1_confirm_time" as const,
          adminKey: "paystub_1_admin_confirm" as const,
        },
        {
          slotKey: "paystub_2",
          label: "Pay stub 2",
          files: toFileArray(m.paystub_2),
          confirmKey: "paystub_2_confirm" as const,
          timeKey: "paystub_2_confirm_time" as const,
          adminKey: "paystub_2_admin_confirm" as const,
        },
        {
          slotKey: "paystub_3",
          label: "Pay stub 3",
          files: toFileArray(m.paystub_3),
          confirmKey: "paystub_3_confirm" as const,
          timeKey: "paystub_3_confirm_time" as const,
          adminKey: "paystub_3_admin_confirm" as const,
        },
        {
          slotKey: "paystub_4",
          label: "Pay stub 4",
          files: toFileArray(m.paystub_4),
          confirmKey: "paystub_4_confirm" as const,
          timeKey: "paystub_4_confirm_time" as const,
          adminKey: "paystub_4_admin_confirm" as const,
        },
      ].filter((s) => s.files.length > 0);

      // No files uploaded for this member at all → render a single
      // "missing income docs" row so admin sees the gap.
      if (slotEntries.length === 0) {
        rows.push({
          key: `member-${m.id}-missing`,
          label: memberLabel,
          files: [],
          emptyHint: "No income documents uploaded.",
        });
        continue;
      }

      slotEntries.forEach((slot) => {
        const slotPathKey = `member-${m.id}-${slot.slotKey}`;
        const mr = m as unknown as Record<string, unknown>;
        const confirmed = mr[slot.confirmKey] === true;
        // Shared PATCH helper for this slot — `next` is the value we
        // want the `*_confirm` column to land on. Used by both
        // Mark Confirmed (next=true) and Undo (next=false), keyed
        // on the same `slotPathKey` so the row's saving state
        // covers either action. The route auto-stamps the matching
        // `*_confirm_time` and `*_admin_confirm` columns; we don't
        // pass them from the client.
        const patchSlot = async (next: boolean) => {
          setSavingSlot(slotPathKey);
          try {
            const res = await fetch(
              `/api/admin/contributing-members/${m.id}`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  [slot.confirmKey]: next,
                }),
              }
            );
            if (!res.ok) {
              const errBody = await res.json().catch(() => null);
              throw new Error(
                errBody?.error ?? `Save failed (${res.status})`
              );
            }
            mutateMembers();
          } catch (err) {
            console.error("Failed to update confirm:", err);
            toast.error(
              err instanceof Error ? err.message : "Couldn't update."
            );
          } finally {
            setSavingSlot(null);
          }
        };
        // Upload-on-behalf-of-family for this slot. Uploads each
        // file through `/api/upload`, concatenates the returned
        // metadata onto the slot's existing array, then PATCHes the
        // whole array back onto the member row. Same shape the
        // tax-return upload uses on the scholarship row above.
        const uploadSlot = async (newFiles: File[]) => {
          if (newFiles.length === 0) return;
          setSavingSlot(slotPathKey);
          try {
            let acc = [...slot.files];
            for (const f of newFiles) {
              const formData = new FormData();
              formData.append("file", f);
              const uploadRes = await fetch("/api/upload", {
                method: "POST",
                body: formData,
              });
              if (!uploadRes.ok) {
                const body = await uploadRes.json().catch(() => null);
                throw new Error(
                  body?.error ?? `Upload failed (${uploadRes.status})`
                );
              }
              const metadata =
                (await uploadRes.json()) as Record<string, unknown>;
              acc = [...acc, metadata];
            }
            const patchRes = await fetch(
              `/api/admin/contributing-members/${m.id}`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [slot.slotKey]: acc }),
              }
            );
            if (!patchRes.ok) {
              const body = await patchRes.json().catch(() => null);
              throw new Error(
                body?.error ?? `Save failed (${patchRes.status})`
              );
            }
            toast.success(
              newFiles.length === 1
                ? `${slot.label} uploaded.`
                : `${newFiles.length} files uploaded.`
            );
            mutateMembers();
          } catch (err) {
            console.error("Failed to upload slot:", err);
            toast.error(
              err instanceof Error ? err.message : "Couldn't upload file."
            );
          } finally {
            setSavingSlot(null);
          }
        };
        // Audit metadata — only meaningful when the slot is
        // currently confirmed. Cleared columns return null / empty
        // string; pass them through anyway and let the row presenter
        // decide whether to render the caption.
        //
        // The `*_admin_confirm` columns on contributing members are
        // typed as text on Xano now (admin display name), so we
        // read them as a string and pass through `confirmedByName`.
        // Legacy rows that still carry a numeric teacher id will
        // come through as a stringified number — harmless, just
        // renders the number until the row is re-confirmed.
        const confirmedAt = mr[slot.timeKey] as number | null | undefined;
        const confirmedByName = mr[slot.adminKey] as string | undefined;
        rows.push({
          key: slotPathKey,
          label: `${memberLabel} · ${slot.label}`,
          files: slot.files,
          upload: {
            onUpload: uploadSlot,
            accept: ".pdf,.jpg,.jpeg,.png",
            maxFiles: 10,
          },
          confirmation: {
            confirmed,
            saving: savingSlot === slotPathKey,
            onConfirm: () => patchSlot(true),
            onUndo: () => patchSlot(false),
            confirmedAt: confirmed ? confirmedAt ?? null : null,
            confirmedByName: confirmed ? confirmedByName ?? "" : "",
          },
        });
      });
    }
  }

  // Government benefits — one row per benefit. Now confirmable via
  // `benefit_is_confirmed` (with `benefit_confirm_time` /
  // `benefit_confirm_admin` audit columns the PATCH route stamps
  // automatically). SNAP / unemployment still render "—" until
  // those Xano rows gain matching audit columns.
  if (scholarship.government_benefits) {
    for (const b of benefits) {
      const monthly = CURRENCY.format(b.amount_monthly ?? 0);
      const slotPathKey = `benefit-${b.id}`;
      const confirmed = b.benefit_is_confirmed === true;
      const patchBenefit = async (next: boolean) => {
        setSavingSlot(slotPathKey);
        try {
          const res = await fetch(
            `/api/admin/scholarship-benefits/${b.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                benefit_is_confirmed: next,
              }),
            }
          );
          if (!res.ok) {
            const errBody = await res.json().catch(() => null);
            throw new Error(
              errBody?.error ?? `Save failed (${res.status})`
            );
          }
          mutateBenefits();
        } catch (err) {
          console.error("Failed to update benefit confirm:", err);
          toast.error(
            err instanceof Error ? err.message : "Couldn't update."
          );
        } finally {
          setSavingSlot(null);
        }
      };
      rows.push({
        key: slotPathKey,
        label: `${b.type || "Government benefit"}`,
        sublabel: `${monthly}/mo`,
        files: toFileArray(b.benefit_documentation),
        emptyHint: "No documentation uploaded.",
        confirmation: {
          confirmed,
          saving: savingSlot === slotPathKey,
          onConfirm: () => patchBenefit(true),
          onUndo: () => patchBenefit(false),
          confirmedAt: confirmed ? b.benefit_confirm_time ?? null : null,
          confirmedByAdmin: confirmed ? b.benefit_confirm_admin ?? 0 : 0,
        },
      });
    }
  }

  return rows;
}

/* ─────────────────────── Row presenter ─────────────────────── */

function DocRow({
  row,
  adminNameByTeacherId,
}: {
  row: DocRowData;
  adminNameByTeacherId: Map<number, string>;
}) {
  // Local pending state for the upload widget — keeps the just-
  // picked files visible as chips inside the file cell until the
  // POST + PATCH cycle lands and the parent's SWR refresh flips
  // `row.files` to include them. Mirrors the AdminDocumentUpload
  // pattern used on the registration packet page.
  const [pending, setPending] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  async function handleFilesChange(newFiles: File[]) {
    setPending(newFiles);
    if (!row.upload || newFiles.length === 0) return;
    setUploading(true);
    try {
      await row.upload.onUpload(newFiles);
      setPending([]);
    } catch {
      // The onUpload implementation toasts its own errors; we just
      // leave `pending` populated so admin can retry without
      // re-picking the files.
    } finally {
      setUploading(false);
    }
  }
  // Audit columns — only populated when the row is currently
  // confirmed AND has a timestamp. Confirmed By prefers the
  // string `confirmedByName` (admin display name written directly
  // by the contributing-members PATCH route now that the
  // `*_admin_confirm` column is typed as text). Falls back to the
  // legacy teacher-id lookup for sibling tables whose audit
  // columns are still int (SNAP / unemployment on the
  // scholarship row, government benefits).
  //
  // Xano left the original int default behind when the column type
  // flipped to text, so rows that pre-date the rename come back as
  // the literal string `"0"` rather than `""`. Treat `"0"` as the
  // unset sentinel alongside empty/whitespace so we don't end up
  // rendering "Confirmed by 0" on legacy data.
  const confirmedBy = (() => {
    if (!row.confirmation?.confirmed) return null;
    if (!row.confirmation.confirmedAt) return null;
    const name = row.confirmation.confirmedByName?.trim();
    if (name && name !== "0") return name;
    const adminId = row.confirmation.confirmedByAdmin ?? 0;
    return adminId > 0
      ? adminNameByTeacherId.get(adminId) ?? "an admin"
      : "an admin";
  })();
  // Short relative form for the column body ("24m", "2h", "3d",
  // "May 2") so the column stays narrow; the long form
  // ("Sun · 24 min ago") rides on the `title` attribute for hover
  // detail without forcing the column wider.
  const confirmedWhen = (() => {
    if (!row.confirmation?.confirmed) return null;
    if (!row.confirmation.confirmedAt) return null;
    return formatRelativeShort(row.confirmation.confirmedAt);
  })();
  const confirmedWhenLong = (() => {
    if (!row.confirmation?.confirmed) return null;
    if (!row.confirmation.confirmedAt) return null;
    return formatNoteTimestamp(row.confirmation.confirmedAt);
  })();
  return (
    <TableRow
      className={cn(
        row.confirmation?.confirmed
          ? "bg-emerald-50/40 hover:bg-emerald-50/60"
          : ""
      )}
    >
      <TableCell className="align-middle">
        <p className="text-sm font-medium truncate" title={row.label}>
          {row.label}
        </p>
        {row.sublabel ? (
          <p
            className="text-[11px] text-muted-foreground mt-0.5 truncate"
            title={row.sublabel}
          >
            {row.sublabel}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="align-middle">
        {/* Files column + inline "+" upload trigger laid out as a
            single horizontal row so a row with one file + one upload
            affordance reads as a single line. `min-w-0` on the files
            container lets the long filenames truncate inside their
            `<FileLink>` instead of pushing the "+" button off-screen.
            Pending upload chips render BELOW the row so they don't
            squash the inline line height. */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex-1 min-w-0">
              {row.files.length === 0 ? (
                <p
                  className="text-[11px] italic text-muted-foreground truncate"
                  title={row.emptyHint ?? "No file uploaded."}
                >
                  {row.emptyHint ?? "No file uploaded."}
                </p>
              ) : (
                <ul className="space-y-1">
                  {row.files.map((f, i) => (
                    <FileLink
                      key={`${row.key}-${f.name ?? f.path ?? i}-${i}`}
                      file={f}
                      fallbackIndex={i}
                    />
                  ))}
                </ul>
              )}
            </div>
            {/* Upload-on-behalf-of-family affordance — only renders
                when the row was built with an `upload` config (today:
                the SNAP path's award-letter row). Admin picks file(s)
                from their local disk; the row's `onUpload` POSTs them
                to /api/upload + PATCHes the appropriate Xano column.
                Renders as an inline "+" icon button so it doesn't push
                anything to a second line. */}
            {row.upload ? (
              <FileUpload
                maxFiles={row.upload.maxFiles ?? 5}
                maxSize={10 * 1024 * 1024}
                accept={row.upload.accept ?? ".pdf,.jpg,.jpeg,.png"}
                value={pending}
                onValueChange={handleFilesChange}
                disabled={uploading}
              >
                <FileUploadDropzone className="border-0 p-0 cursor-pointer hover:bg-transparent w-fit min-h-0 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-7 bg-white shrink-0"
                    disabled={uploading}
                    aria-label={
                      uploading
                        ? "Uploading"
                        : row.files.length === 0
                          ? "Upload file"
                          : "Add another file"
                    }
                    title={
                      uploading
                        ? "Uploading…"
                        : row.files.length === 0
                          ? "Upload file"
                          : "Add another file"
                    }
                    asChild
                  >
                    <span>
                      {uploading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Plus className="size-3.5" />
                      )}
                    </span>
                  </Button>
                </FileUploadDropzone>
                {/* Pending chips render below the inline row — keeps
                    the file/upload line tight while still showing
                    in-flight uploads with progress + cancel. */}
                <FileUploadList>
                  {pending.map((f, i) => (
                    <FileUploadItem key={i} value={f}>
                      <FileUploadItemPreview />
                      <FileUploadItemMetadata />
                      <FileUploadItemDelete asChild>
                        <Button variant="ghost" size="icon" className="size-7">
                          <X className="size-4" />
                        </Button>
                      </FileUploadItemDelete>
                    </FileUploadItem>
                  ))}
                </FileUploadList>
              </FileUpload>
            ) : null}
          </div>
        </div>
      </TableCell>
      {/* Confirmed By + Time — own columns (rather than stacked
          under the buttons) so the audit trail reads as a proper
          grid. Both truncate with hover-full to avoid horizontal
          scroll on long names. */}
      <TableCell className="align-middle">
        {confirmedBy ? (
          <p
            className="text-sm text-muted-foreground truncate"
            title={confirmedBy}
          >
            {confirmedBy}
          </p>
        ) : (
          <span className="text-xs text-muted-foreground/70">—</span>
        )}
      </TableCell>
      <TableCell className="align-middle">
        {confirmedWhen ? (
          <p
            className="text-sm text-muted-foreground truncate tabular-nums"
            title={confirmedWhenLong ?? confirmedWhen}
          >
            {confirmedWhen}
          </p>
        ) : (
          <span className="text-xs text-muted-foreground/70">—</span>
        )}
      </TableCell>
      <TableCell className="text-right align-middle">
        {row.confirmation ? (
          // Mark Confirmed (primary) + Undo (icon, always visible)
          // — splitting the actions makes confirmation feel
          // intentional. Mark Confirmed is disabled once the slot
          // is already confirmed; Undo is disabled until there's
          // something to undo. The shared `saving` state covers
          // either action so the row's spinner reflects whichever
          // is in flight.
          <div className="inline-flex items-center gap-1">
            <Button
              type="button"
              variant={row.confirmation.confirmed ? "default" : "outline"}
              size="sm"
              disabled={
                row.confirmation.saving || row.confirmation.confirmed
              }
              onClick={() => void row.confirmation!.onConfirm()}
              className={cn(
                // `leading-none` keeps the icon + label sharing one
                // optical baseline; without it the chip + lowercase
                // text drift apart on the small height variant.
                "h-7 text-xs leading-none",
                row.confirmation.confirmed &&
                  "bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-100",
                !row.confirmation.confirmed && "bg-white"
              )}
              title={
                row.confirmation.confirmed
                  ? "Already confirmed — use the Undo button to clear"
                  : "Mark this document as reviewed and correct"
              }
            >
              {row.confirmation.saving && !row.confirmation.confirmed ? (
                <Loader2 className="size-3 animate-spin" />
              ) : row.confirmation.confirmed ? (
                <CheckCircle2 className="size-3" />
              ) : (
                <Circle className="size-3" />
              )}
              <span>
                {row.confirmation.confirmed ? "Confirmed" : "Mark confirmed"}
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-7 bg-white"
              disabled={
                row.confirmation.saving || !row.confirmation.confirmed
              }
              onClick={() => void row.confirmation!.onUndo()}
              title={
                row.confirmation.confirmed
                  ? "Undo this confirmation"
                  : "Nothing to undo"
              }
              aria-label={
                row.confirmation.confirmed
                  ? "Undo confirmation"
                  : "Undo (disabled — nothing to undo)"
              }
            >
              {row.confirmation.saving && row.confirmation.confirmed ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RotateCcw className="size-3.5" />
              )}
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/70">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

/**
 * Renders one file as a clickable list item with the Xano-served URL
 * + filename + size. Always shows the external-link icon when a
 * URL is available so the "click to view" affordance is obvious.
 */
function FileLink({
  file,
  fallbackIndex,
}: {
  file: XanoFileMetadata;
  fallbackIndex: number;
}) {
  const name = file.name ?? file.path ?? `File ${fallbackIndex + 1}`;
  const sizeKb =
    typeof file.size === "number"
      ? `${(file.size / 1024).toFixed(0)} KB`
      : null;
  // Resolve a usable URL — `file.url` first, fall back to building
  // one from `file.path` so files surface even when Xano didn't
  // return a signed URL on this read.
  const href = fileViewUrl(file);
  return (
    // Match the Document column's body text size — both `text-sm`
    // — so a row's left and middle cells read as one unit instead
    // of competing fonts.
    //
    // `min-w-0` is threaded through every flex level (li, a, the
    // file-name span) because flex items default to
    // `min-width: auto` which lets long text overflow the parent.
    // Without min-w-0 the truncate classes are no-ops — the link
    // expands the table cell instead of clipping. The size suffix
    // is `shrink-0 whitespace-nowrap` so it stays readable while
    // the filename does the truncating.
    <li className="flex items-center gap-2 text-sm min-w-0">
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={name}
          className="text-foreground underline-offset-2 hover:underline inline-flex items-center gap-1 min-w-0 flex-1"
        >
          <span className="truncate min-w-0">{name}</span>
          <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
        </a>
      ) : (
        <span className="truncate min-w-0 flex-1" title={name}>
          {name}
        </span>
      )}
      {sizeKb ? (
        <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
          · {sizeKb}
        </span>
      ) : null}
    </li>
  );
}
