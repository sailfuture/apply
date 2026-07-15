"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Loader2, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
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

/** The slice of `/api/admin/families` rows the picker needs. */
interface FamilyRow {
  id: number;
  family_name: string;
  primary_name: string;
  primary_email: string;
}

/**
 * "New message" — searchable family picker for the global SMS inbox.
 * The inbox's conversation list only shows families with message
 * history, so without this there was no way to START a thread from the
 * messages page (staff had to go find the family's record). Picking a
 * family opens its (possibly empty) thread in the inbox's right pane;
 * the thread composer handles the first send, opt-out state, and
 * missing-phone state, so this component only needs to resolve
 * "which family?".
 */
export function NewMessageDialog({
  onPick,
}: {
  /** Open this family's thread in the host inbox. */
  onPick: (family: { id: number; name: string }) => void;
}) {
  const [open, setOpen] = useState(false);

  // Fetch only while the dialog is open — the families list is
  // irrelevant to the inbox until staff reach for the picker.
  const { data, isLoading } = useSWR(
    open ? "/api/admin/families" : null,
    adminFetcher
  );
  const families = useMemo<FamilyRow[]>(
    () => (Array.isArray(data) ? (data as FamilyRow[]) : []),
    [data]
  );

  function pick(f: FamilyRow) {
    setOpen(false);
    onPick({ id: f.id, name: f.family_name });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <MessageSquarePlus className="size-4 mr-1.5" />
        New message
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-0 sm:max-w-md">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle>New message</DialogTitle>
            <DialogDescription>
              Pick a family to open their text thread.
            </DialogDescription>
          </DialogHeader>
          {/* cmdk filters items by their `value`; family + parent name
              in the value means staff can search by either. */}
          <Command className="border-t">
            <CommandInput placeholder="Search by family or parent name…" />
            <CommandList className="max-h-72">
              {isLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <CommandEmpty>No families found.</CommandEmpty>
                  {families.map((f) => (
                    <CommandItem
                      key={f.id}
                      value={`${f.family_name} ${f.primary_name} ${f.id}`}
                      onSelect={() => pick(f)}
                      className="flex flex-col items-start gap-0.5 px-4 py-2"
                    >
                      <span className="text-sm font-medium">
                        {f.family_name}
                      </span>
                      {f.primary_name ? (
                        <span className="text-xs text-muted-foreground">
                          {f.primary_name}
                        </span>
                      ) : null}
                    </CommandItem>
                  ))}
                </>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
