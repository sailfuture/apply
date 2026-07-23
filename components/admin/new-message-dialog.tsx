"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Loader2, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { adminFetcher } from "@/lib/admin-fetcher";

type ContactType = "family" | "inquiry" | "camp" | "visit";

interface PickedContact {
  type: ContactType;
  id: number;
  name: string;
}

/** The slice of `/api/admin/families` rows the picker needs. */
interface FamilyRow {
  id: number;
  family_name: string;
  primary_name: string;
  /** Parents beyond the primary, comma-joined ("" when none). */
  secondary_name: string;
  /** The family's students, comma-joined ("" when none). */
  student_names: string;
}

/** The slice of `/api/admin/inquiries` rows the picker needs. */
interface InquiryRow {
  id: number;
  primary_first_name: string;
  primary_last_name: string;
  student_first_name: string;
  student_last_name: string;
}

/** The slice of `/api/admin/summer-camp` rows the picker needs. */
interface CampRow {
  id: number;
  primary_parent_first_name: string;
  primary_parent_last_name: string;
  student_first_name: string;
  student_last_name: string;
}

/** The slice of `/api/admin/campus-visits` rows the picker needs —
 *  only opted-in signers are listed. */
interface VisitRow {
  id: number;
  parent_name: string;
  student_name: string;
  marketing_opt_in: boolean;
}

/**
 * "New message" — searchable contact picker for the global SMS inbox,
 * spanning all three textable record types: applying/enrolled
 * families, prospective-family inquiries, and summer-camp parents.
 * Picking one opens its (possibly empty) thread in the inbox's right
 * pane; the thread composer handles the first send, opt-out state, and
 * missing-phone state, so this component only resolves "who?".
 */
export function NewMessageDialog({
  onPick,
}: {
  /** Open this contact's thread in the host inbox. */
  onPick: (contact: PickedContact) => void;
}) {
  const [open, setOpen] = useState(false);

  // Fetch only while the dialog is open — the contact lists are
  // irrelevant to the inbox until staff reach for the picker.
  const { data: familiesData, isLoading: loadingFamilies } = useSWR(
    open ? "/api/admin/families" : null,
    adminFetcher
  );
  const { data: inquiriesData, isLoading: loadingInquiries } = useSWR(
    open ? "/api/admin/inquiries" : null,
    adminFetcher
  );
  const { data: campData, isLoading: loadingCamp } = useSWR(
    open ? "/api/admin/summer-camp" : null,
    adminFetcher
  );
  const { data: visitsData, isLoading: loadingVisits } = useSWR(
    open ? "/api/admin/campus-visits" : null,
    adminFetcher
  );

  const families = useMemo<FamilyRow[]>(
    () => (Array.isArray(familiesData) ? (familiesData as FamilyRow[]) : []),
    [familiesData]
  );
  const inquiries = useMemo<InquiryRow[]>(
    () =>
      Array.isArray(inquiriesData) ? (inquiriesData as InquiryRow[]) : [],
    [inquiriesData]
  );
  const campRows = useMemo<CampRow[]>(
    () => (Array.isArray(campData) ? (campData as CampRow[]) : []),
    [campData]
  );
  // Campus-visit waiver signers — opted-in only (the marketing
  // checkbox on the public form is the texting consent).
  const visitRows = useMemo<VisitRow[]>(
    () =>
      (Array.isArray(visitsData) ? (visitsData as VisitRow[]) : []).filter(
        (v) => v.marketing_opt_in === true
      ),
    [visitsData]
  );

  const loading =
    loadingFamilies || loadingInquiries || loadingCamp || loadingVisits;

  function pick(contact: PickedContact) {
    setOpen(false);
    onPick(contact);
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <MessageSquarePlus className="size-4 mr-1.5" />
        New message
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* Large fixed-frame panel matching the group-message composer
            — the dialog claims most of the viewport and the result
            list flexes to fill it, so filtering changes what scrolls,
            never the frame. */}
        <DialogContent className="flex h-[85vh] max-h-[820px] flex-col gap-0 p-0 sm:max-w-4xl">
          {/* `pr-14` clears the dialog's absolutely-positioned close
              button (top-4 right-4) — with the content's default
              padding stripped (`p-0`), the description would otherwise
              run underneath the X. */}
          <DialogHeader className="shrink-0 px-4 pt-4 pb-3 pr-14">
            <DialogTitle>New message</DialogTitle>
            <DialogDescription>
              Pick a family, inquiry, or camp parent to open their text
              thread.
            </DialogDescription>
          </DialogHeader>
          {/* cmdk filters items by their `value`; parent + student +
              record names in the value means staff can search by any. */}
          <Command className="min-h-0 flex-1 border-t">
            <CommandInput placeholder="Search by family, parent, or student name…" />
            <CommandList className="h-full max-h-none flex-1">
              {loading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <CommandEmpty>No contacts found.</CommandEmpty>
                  <CommandGroup heading="Families">
                    {families.map((f) => {
                      // Primary + secondary contacts on one line; the
                      // search value carries BOTH plus every student
                      // name, so staff can find the family through
                      // whichever person they know. (Texts still open
                      // the family thread, which resolves to the
                      // primary contact's number.)
                      const parents = [f.primary_name, f.secondary_name]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <CommandItem
                          key={`family-${f.id}`}
                          value={`family ${f.family_name} ${f.primary_name} ${f.secondary_name} ${f.student_names} ${f.id}`}
                          onSelect={() =>
                            pick({
                              type: "family",
                              id: f.id,
                              name: f.family_name,
                            })
                          }
                          className="px-4 py-1.5"
                        >
                          {/* Single-line row (user request): family ·
                              parents · students, truncating right. */}
                          <span className="block w-full truncate text-sm">
                            <span className="font-medium">
                              {f.family_name}
                            </span>
                            {parents ? (
                              <span className="text-muted-foreground">
                                {" "}
                                · {parents}
                              </span>
                            ) : null}
                            {f.student_names ? (
                              <span className="text-muted-foreground">
                                {" "}
                                · {f.student_names}
                              </span>
                            ) : null}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                  <CommandGroup heading="Inquiries">
                    {inquiries.map((i) => {
                      const name =
                        `${i.primary_first_name ?? ""} ${i.primary_last_name ?? ""}`.trim() ||
                        `Inquiry #${i.id}`;
                      const student =
                        `${i.student_first_name ?? ""} ${i.student_last_name ?? ""}`.trim();
                      return (
                        <CommandItem
                          key={`inquiry-${i.id}`}
                          value={`inquiry ${name} ${student} ${i.id}`}
                          onSelect={() =>
                            pick({ type: "inquiry", id: i.id, name })
                          }
                          className="px-4 py-1.5"
                        >
                          <span className="block w-full truncate text-sm">
                            <span className="font-medium">{name}</span>
                            {student ? (
                              <span className="text-muted-foreground">
                                {" "}
                                · {student}
                              </span>
                            ) : null}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                  <CommandGroup heading="Summer camp">
                    {campRows.map((c) => {
                      const name =
                        `${c.primary_parent_first_name ?? ""} ${c.primary_parent_last_name ?? ""}`.trim() ||
                        `Camp #${c.id}`;
                      const student =
                        `${c.student_first_name ?? ""} ${c.student_last_name ?? ""}`.trim();
                      return (
                        <CommandItem
                          key={`camp-${c.id}`}
                          value={`camp ${name} ${student} ${c.id}`}
                          onSelect={() =>
                            pick({ type: "camp", id: c.id, name })
                          }
                          className="px-4 py-1.5"
                        >
                          <span className="block w-full truncate text-sm">
                            <span className="font-medium">{name}</span>
                            {student ? (
                              <span className="text-muted-foreground">
                                {" "}
                                · {student}
                              </span>
                            ) : null}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                  <CommandGroup heading="Campus visits">
                    {visitRows.map((v) => {
                      const name =
                        (v.parent_name ?? "").trim() || `Visit #${v.id}`;
                      const student = (v.student_name ?? "").trim();
                      return (
                        <CommandItem
                          key={`visit-${v.id}`}
                          value={`visit ${name} ${student} ${v.id}`}
                          onSelect={() =>
                            pick({ type: "visit", id: v.id, name })
                          }
                          className="px-4 py-1.5"
                        >
                          <span className="block w-full truncate text-sm">
                            <span className="font-medium">{name}</span>
                            {student ? (
                              <span className="text-muted-foreground">
                                {" "}
                                · {student}
                              </span>
                            ) : null}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
