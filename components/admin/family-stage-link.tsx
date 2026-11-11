"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { adminFetcher } from "@/lib/admin-fetcher";
import { cn } from "@/lib/utils";
import { applicationTarget, stageHref } from "@/lib/admin-stage";
import type { FamilyStageResponse } from "@/app/api/admin/families/[id]/stage/route";

/**
 * A link to a family's CURRENT stage page for surfaces that only know
 * the family id (sheets, the lead sheet's conversion row). Resolves
 * the target lazily through `/api/admin/families/[id]/stage` — the
 * same resolver the dashboard search and the list pages use — and
 * renders the application review page until the answer lands, so the
 * link is never dead.
 *
 * `yearId` is the admin's working year when the host page has one.
 */
export function useFamilyStageHref(
  familyId: number,
  yearId?: number | string | null,
  enabled = true
): string {
  const key =
    enabled && familyId > 0
      ? `/api/admin/families/${familyId}/stage${
          yearId ? `?yearId=${yearId}` : ""
        }`
      : null;
  const { data } = useSWR<FamilyStageResponse>(key, adminFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });
  return stageHref(data?.family ?? applicationTarget(familyId, yearId));
}

export function FamilyStageLink({
  familyId,
  yearId,
  className,
  children,
  ...rest
}: {
  familyId: number;
  yearId?: number | string | null;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ComponentProps<typeof Link>, "href" | "className" | "children">) {
  const href = useFamilyStageHref(familyId, yearId);
  return (
    <Link href={href} className={className} {...rest}>
      {children}
    </Link>
  );
}

/**
 * A family or student NAME, in a table or a sheet, as a link to the
 * stage page they are on right now — for rosters that only carry ids
 * (bus stops, volunteer hours, event RSVPs, store orders, laptops).
 *
 * Unlike `FamilyStageLink` this resolves nothing until the pointer
 * or keyboard focus reaches it, so a 60-row roster doesn't fire 60
 * lookups on load. A click that lands before the answer does waits
 * for it, then navigates — the name never opens the wrong page.
 *
 * `studentId` makes it that student's link (an enrolled student opens
 * their own page while a sibling still applying opens the family's
 * application); without it, the family's. Clicks don't bubble, so a
 * row that opens a sheet on click keeps doing that everywhere else.
 */
export function StageNameLink({
  familyId,
  studentId,
  yearId,
  className,
  children,
}: {
  familyId: number;
  studentId?: number | null;
  yearId?: number | string | null;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const key =
    familyId > 0
      ? `/api/admin/families/${familyId}/stage${
          yearId ? `?yearId=${yearId}` : ""
        }`
      : null;
  const { data } = useSWR<FamilyStageResponse>(
    armed ? key : null,
    adminFetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 }
  );
  const targetOf = (d: FamilyStageResponse | undefined) =>
    (studentId ? d?.students[String(studentId)] : undefined) ??
    d?.family ??
    applicationTarget(familyId, yearId);

  if (!key) return <span className={className}>{children}</span>;
  const arm = () => setArmed(true);
  return (
    <Link
      href={stageHref(targetOf(data))}
      prefetch={false}
      className={cn(
        "underline-offset-2 hover:underline focus-visible:underline",
        className
      )}
      onPointerEnter={arm}
      onFocus={arm}
      onTouchStart={arm}
      onClick={(e) => {
        e.stopPropagation();
        // New-tab / modified clicks and already-resolved links go
        // through the browser as-is.
        if (
          data ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        ) {
          return;
        }
        e.preventDefault();
        adminFetcher<FamilyStageResponse>(key)
          .catch(() => undefined)
          .then((d) => router.push(stageHref(targetOf(d))));
      }}
    >
      {children}
    </Link>
  );
}
