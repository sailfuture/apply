"use client";

import Link from "next/link";
import useSWR from "swr";
import { adminFetcher } from "@/lib/admin-fetcher";
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
