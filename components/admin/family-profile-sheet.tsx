"use client";

import Link from "next/link";
import useSWR from "swr";
import { ExternalLink, Loader2, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactRow } from "@/components/admin/lead-triage";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { adminFetcher } from "@/lib/admin-fetcher";
import { formatUSPhone } from "@/lib/phone";
import type { FamilyProfileResponse } from "@/app/api/admin/families/[id]/profile/route";

/**
 * Compact family profile in a sheet — who's in the household and how
 * to reach them, without leaving the page you're on (the Messages
 * inbox uses this for its "Family details" button). Links out to the
 * full family record for everything else (billing, docs, notes).
 * Lazy: nothing fetches until the sheet opens.
 */
export function FamilyProfileSheet({
  familyId,
  open,
  onOpenChange,
}: {
  familyId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading } = useSWR<FamilyProfileResponse>(
    open && familyId ? `/api/admin/families/${familyId}/profile` : null,
    adminFetcher
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-base">
            {data?.family_name || "Family"}
            {data?.is_residential ? (
              <span className="ml-2 inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground align-middle">
                Residential
              </span>
            ) : null}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Family profile — parents, students, and contact info.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
          {isLoading || !data ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Flat label-over-value layout matching the lead
                  triage sheet (user request: no bordered contact
                  cards) — same ContactRow with copy + call/email
                  actions, parents separated by hairlines. */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Parents
                </p>
                {data.parents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No parents on file.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {data.parents.map((p) => (
                      <div
                        key={p.id}
                        className="space-y-2 border-b pb-4 last:border-b-0 last:pb-0"
                      >
                        <p className="text-sm font-medium">
                          {p.name || `Parent #${p.id}`}
                          {p.relationship ? (
                            <span className="ml-1.5 font-normal text-muted-foreground">
                              · {p.relationship}
                            </span>
                          ) : null}
                        </p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                          <ContactRow
                            label="Phone"
                            value={
                              formatUSPhone(p.phone ?? "") || (p.phone ?? "")
                            }
                            copyValue={p.phone ?? ""}
                            href={p.phone ? `tel:${p.phone}` : null}
                            actionLabel="Call"
                            actionIcon={<Phone className="size-3.5" />}
                          />
                          <ContactRow
                            label="Email"
                            value={p.email ?? ""}
                            copyValue={p.email ?? ""}
                            href={p.email ? `mailto:${p.email}` : null}
                            actionLabel="Email"
                            actionIcon={<Mail className="size-3.5" />}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Students
                </p>
                {data.students.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No students on file.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {data.students.map((s) => (
                      <p key={s.id} className="text-sm">
                        {s.name || `Student #${s.id}`}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Everything deeper (billing, docs, notes, registration) lives
            on the full record — one explicit jump-off. */}
        <div className="border-t bg-muted/20 px-4 py-3">
          <Button asChild variant="outline" className="w-full bg-white">
            <Link href={`/admin/families/${familyId}`}>
              Open full family record
              <ExternalLink className="size-3.5 ml-1.5" />
            </Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
