"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Field,
  FieldLabel,
} from "@/components/ui/field";
import { StateSelect } from "@/components/state-select";
import { Trash2, Plus } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { GlobalSaveStatusPill } from "@/components/save-status-pill";
import { useFamilyProgress } from "@/hooks/use-family-progress";
import { useReapplyFamilyProgress } from "@/hooks/use-reapply-family-progress";
import { US_STATES } from "@/lib/us-states";

interface Parent {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  relationship: string;
  invite_status: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  zipcode: string;
}

interface SchoolYear {
  id: number;
  year_name: string;
}

function getInitials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

export default function FamilyStepPage() {
  const params = useParams();
  const yearId = params.yearId as string;
  const { user: clerkUser } = useUser();
  const currentUserEmail = clerkUser?.primaryEmailAddress?.emailAddress ?? "";

  const {
    setPageTitle,
    registerSaveHandler,
    unregisterSaveHandler,
    updateSaveOptions,
    trackAutosave,
  } = useApplicationFlow();
  const { mutate } = useSWRConfig();

  const [parents, setParents] = useState<Parent[]>([]);
  const [familyName, setFamilyName] = useState("");
  const [yearName, setYearName] = useState("");
  const [loading, setLoading] = useState(true);

  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFirstName, setInviteFirstName] = useState("");
  const [inviteLastName, setInviteLastName] = useState("");
  const [inviteRelationship, setInviteRelationship] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [openParents, setOpenParents] = useState<Set<number>>(new Set());
  const initialCollapseRef = useRef(false);

  function isParentComplete(p: Parent): boolean {
    return !!(
      p.first_name &&
      p.last_name &&
      p.email &&
      p.phone &&
      p.relationship &&
      p.address_line_1 &&
      p.city &&
      p.state &&
      p.zipcode
    );
  }

  function toggleParent(id: number) {
    setOpenParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const fetchData = useCallback(async () => {
    try {
      const [familyRes, yearsRes] = await Promise.all([
        fetch("/api/families"),
        fetch("/api/school-years"),
      ]);
      if (familyRes.ok) {
        const fam = await familyRes.json();
        setParents(fam.parents ?? []);
        if (fam.family_name) setFamilyName(fam.family_name);
      }
      if (yearsRes.ok) {
        const years: SchoolYear[] = await yearsRes.json();
        const found = years.find((y) => y.id === Number(yearId));
        if (found) setYearName(found.year_name);
      }
    } catch (err) {
      console.error("Failed to fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [yearId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Default all parents to open on initial load — don't auto-collapse completed
  // ones. Users can manually collapse via the chevron.
  useEffect(() => {
    if (loading || initialCollapseRef.current || parents.length === 0) return;
    initialCollapseRef.current = true;
    setOpenParents(new Set(parents.map((p) => p.id)));
  }, [loading, parents]);

  function updateParentLocal(parentId: number, field: string, value: string) {
    setParents((prev) =>
      prev.map((p) => (p.id === parentId ? { ...p, [field]: value } : p))
    );
  }

  const [saving, setSaving] = useState(false);

  async function saveParentField(parentId: number, field: string, value: string) {
    // Per-field onBlur auto-save — drives the global SaveStatusPill badge
    // shown in the apply-flow layout so users see "Saving… → Saved Xs ago".
    try {
      await trackAutosave(
        fetch(`/api/parents/${parentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value }),
        }).then(async (res) => {
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Save failed (${res.status}) ${body}`);
          }
          return res;
        })
      );
    } catch (err) {
      console.error("Failed to save parent field:", err);
    }
  }

  /**
   * Onblur autosave for the family name. Goes through the same
   * `trackAutosave` channel as the parent fields so the global
   * SaveStatusPill picks it up. We only fire when the trimmed value
   * is non-empty so accidental backspace-to-blank doesn't wipe a
   * previously-saved name.
   */
  async function saveFamilyName(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      await trackAutosave(
        fetch("/api/families", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ family_name: trimmed }),
        }).then(async (res) => {
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Save failed (${res.status}) ${body}`);
          }
          return res;
        })
      );
      // Bump the cached family record so the global header / sidebar
      // pick up the new name without a hard refresh.
      mutate("/api/families");
    } catch (err) {
      console.error("Failed to save family name:", err);
    }
  }

  async function handleSaveAll() {
    setSaving(true);
    try {
      await trackAutosave(
        Promise.all(
          parents.map(async (p) => {
            const res = await fetch(`/api/parents/${p.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: p.email,
                phone: p.phone,
                relationship: p.relationship,
                address_line_1: p.address_line_1,
                address_line_2: p.address_line_2,
                city: p.city,
                state: p.state,
                zipcode: p.zipcode,
              }),
            });
            if (!res.ok) {
              const body = await res.text().catch(() => "");
              throw new Error(`Failed to save ${p.first_name} (${res.status}) ${body}`);
            }
            return res;
          })
        )
      );
      mutate("/api/families");
    } catch (err) {
      console.error("Failed to save:", err);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  const handleSaveAllRef = useRef(handleSaveAll);
  handleSaveAllRef.current = handleSaveAll;

  // Flow-aware progress: this same page renders under both /apply (where
  // we track the apply progress row's `family_completed` bool) and /reapply
  // (where we track the reapply progress row's `isFamilyDetails` bool).
  // Both hooks always mount so the rules of hooks stay happy, but we pass
  // `null` to the inactive one so only the active flow's progress endpoint
  // is hit per page mount (otherwise every render fires both fetches).
  const pathnameForFlow = usePathname();
  const isReapplyFlow = pathnameForFlow.startsWith("/reapply");
  const yearIdNum = Number(yearId);
  const applyProgress = useFamilyProgress(isReapplyFlow ? null : yearIdNum);
  const reapplyProgress = useReapplyFamilyProgress(isReapplyFlow ? yearIdNum : null);
  const familyLocked = isReapplyFlow
    ? !!reapplyProgress.progress?.isFamilyDetails
    : !!applyProgress.progress?.family_completed;
  // Stabilize the lock setter via a ref. The progress hooks return fresh
  // object literals each render, so naming them in a useCallback dep list
  // gives every render a new function identity — which feeds into the
  // `updateSaveOptions` useEffect below and creates an infinite loop.
  // Pulling the latest hook returns through a ref keeps the callback
  // identity stable while still calling whichever flow is active.
  const flowRef = useRef({ isReapplyFlow, applyProgress, reapplyProgress });
  flowRef.current = { isReapplyFlow, applyProgress, reapplyProgress };
  const setProgressSectionLocked = useCallback((value: boolean) => {
    const f = flowRef.current;
    return f.isReapplyFlow
      ? f.reapplyProgress.setSection("isFamilyDetails", value)
      : f.applyProgress.setSection("family_completed", value);
  }, []);

  const handleCompleteRef = useRef<() => Promise<void>>(() => Promise.resolve());
  handleCompleteRef.current = async () => {
    const allComplete = parents.length > 0 && parents.every((p) => isParentComplete(p));
    if (!allComplete) {
      toast.error("Please fill out all required fields for each parent/guardian.");
      throw new Error("Validation failed");
    }
    await handleSaveAllRef.current();
    await setProgressSectionLocked(true);
    toast.success("Family section completed.");
  };

  useEffect(() => {
    setPageTitle("Family Information");
    registerSaveHandler(() => handleCompleteRef.current(), { label: "Complete Family Section" });
    return () => unregisterSaveHandler();
  }, [setPageTitle, registerSaveHandler, unregisterSaveHandler]);

  useEffect(() => {
    if (familyLocked) {
      updateSaveOptions({
        completed: true,
        completedLabel: "Family Section Completed",
        onUnlock: () => void setProgressSectionLocked(false),
        saving: false,
      });
    } else {
      // Explicitly clear `completed` + `onUnlock` — `updateSaveOptions`
      // shallow-merges into the previous state, so without these the
      // stale `completed: true` from the locked branch survives unlock
      // and the layout keeps dimming + click-blocking the page.
      updateSaveOptions({
        completed: false,
        onUnlock: undefined,
        saving,
        label: "Complete Family Section",
      });
    }
  }, [saving, familyLocked, updateSaveOptions, setProgressSectionLocked]);

  // Auto-revoke completion when validation regresses (e.g. a new parent
  // was invited and added with missing phone/relationship/etc., so the
  // section is no longer genuinely complete). Mirrors the same pattern
  // on the Students page.
  const autoRevokedFamilyRef = useRef(false);
  useEffect(() => {
    if (!familyLocked) {
      autoRevokedFamilyRef.current = false;
      return;
    }
    if (loading || parents.length === 0) return;
    const allComplete = parents.every((p) => isParentComplete(p));
    if (allComplete) return;
    if (autoRevokedFamilyRef.current) return;
    autoRevokedFamilyRef.current = true;
    void setProgressSectionLocked(false);
    toast.message(
      "A parent was added or updated — please review and re-complete this section."
    );
    // isParentComplete is a stable function declaration; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parents, familyLocked, loading, setProgressSectionLocked]);

  const [pendingDeleteParent, setPendingDeleteParent] = useState<{ id: number; name: string } | null>(null);

  function handleDeleteParent(parentId: number) {
    // Optimistic: remove from UI immediately, fire API in background
    setParents((prev) => prev.filter((p) => p.id !== parentId));
    setPendingDeleteParent(null);
    fetch(`/api/parents/${parentId}`, { method: "DELETE" }).catch((err) =>
      console.error("Failed to delete parent:", err)
    );
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteError("");
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail,
          first_name: inviteFirstName,
          last_name: inviteLastName,
          relationship: inviteRelationship,
        }),
      });
      if (res.ok) {
        setInviteSheetOpen(false);
        setInviteEmail("");
        setInviteFirstName("");
        setInviteLastName("");
        setInviteRelationship("");
        await fetchData();
      } else {
        const body = await res.json().catch(() => null);
        setInviteError(body?.error ?? "Failed to send invitation");
      }
    } catch {
      setInviteError("Network error — please try again");
    } finally {
      setInviting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div>
          <div className="flex items-center justify-between gap-3 pb-3 border-b">
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-8 w-3/4 mt-4" />
          <Skeleton className="h-4 w-2/3 mt-3" />
        </div>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-6">
            <div className="flex items-center gap-3 mb-5">
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-5 w-44" />
            </div>
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j}>
                  <Skeleton className="h-3 w-24 mb-2" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div>
          <div className="flex items-center justify-between gap-3 pb-3 border-b">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Family
            </p>
            <GlobalSaveStatusPill />
          </div>
          <h1 className="text-2xl font-semibold mt-4">
            Add at least one primary parent or guardian for your family.
          </h1>
        </div>

        {/* Editable family name. Initially seeded from the welcome
            page ("<Last Name> Family") but parents can rewrite it
            here any time during the application — autosaves on blur
            via the global SaveStatusPill. */}
        <Card className="overflow-hidden gap-0 py-0 ring-0 border">
          <CardContent className="py-5 px-6 bg-white dark:bg-background">
            <Field>
              <FieldLabel htmlFor="family-name">Family name</FieldLabel>
              <Input
                id="family-name"
                placeholder="e.g. The Walsh Family"
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                onBlur={(e) => saveFamilyName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className={!familyName.trim() ? "border-2 border-red-400" : ""}
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Shown on the dashboard, in the global header, and on
                anything we send your family. Edits save on blur.
              </p>
            </Field>
          </CardContent>
        </Card>

        {parents.length === 0 ? (
          <div className="flex min-h-[20vh] items-center justify-center rounded-lg border">
            <p className="text-muted-foreground text-sm">
              No parents found. Add a parent or guardian to continue.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {parents.map((parent, idx) => (
              <Card
                key={parent.id}
                id={`parent-${idx}`}
                className="overflow-hidden gap-0 py-0 ring-0 border scroll-mt-20"
              >
                <CardHeader
                  className="border-b py-3 !pb-3 cursor-pointer select-none"
                  onClick={() => toggleParent(parent.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-10">
                        <AvatarFallback className="bg-muted text-muted-foreground text-sm font-medium">
                          {getInitials(parent.first_name, parent.last_name)}
                        </AvatarFallback>
                      </Avatar>
                      <CardTitle className="text-lg">
                        {parent.first_name} {parent.last_name}
                      </CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      {isParentComplete(parent) ? (
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-500 text-white">
                          <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                          </svg>
                        </div>
                      ) : (
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
                          <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
                            <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
                          </svg>
                        </div>
                      )}
                      {parent.email !== currentUserEmail && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-red-600"
                          onClick={(e) => { e.stopPropagation(); setPendingDeleteParent({ id: parent.id, name: `${parent.first_name} ${parent.last_name}` }); }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                      <div
                        className="flex size-8 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-muted/50 transition-colors"
                        onClick={(e) => { e.stopPropagation(); toggleParent(parent.id); }}
                      >
                        <svg className={`size-4 transition-transform duration-200 ${openParents.has(parent.id) ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <AnimatePresence initial={false}>
                {openParents.has(parent.id) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                <CardContent className="space-y-6 py-5 bg-white dark:bg-background">
                  {/* Name — editable for every parent (primary + secondary).
                      Auto-saves on blur via the same per-field pattern the
                      rest of this card uses. The card header above re-reads
                      from the same parent object so it updates as they type. */}
                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Name
                    </h3>
                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                      <Field>
                        <FieldLabel className="text-xs">First Name</FieldLabel>
                        <Input
                          className={!parent.first_name ? "border-2 border-red-400" : ""}
                          placeholder="Jane"
                          value={parent.first_name || ""}
                          autoComplete="given-name"
                          onChange={(e) =>
                            updateParentLocal(parent.id, "first_name", e.target.value)
                          }
                          onBlur={(e) =>
                            saveParentField(parent.id, "first_name", e.target.value)
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel className="text-xs">Last Name</FieldLabel>
                        <Input
                          className={!parent.last_name ? "border-2 border-red-400" : ""}
                          placeholder="Walsh"
                          value={parent.last_name || ""}
                          autoComplete="family-name"
                          onChange={(e) =>
                            updateParentLocal(parent.id, "last_name", e.target.value)
                          }
                          onBlur={(e) =>
                            saveParentField(parent.id, "last_name", e.target.value)
                          }
                        />
                      </Field>
                    </div>
                  </section>

                  {/* Contact Information */}
                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Contact Information
                    </h3>
                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-[1fr_1fr] lg:grid-cols-[2fr_1fr_1fr]">
                      <Field>
                        <FieldLabel className="text-xs">Email</FieldLabel>
                        <Input
                          type="email"
                          placeholder="email@example.com"
                          value={parent.email || ""}
                          autoComplete="email"
                          onChange={(e) =>
                            updateParentLocal(parent.id, "email", e.target.value)
                          }
                          onBlur={(e) =>
                            saveParentField(parent.id, "email", e.target.value)
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel className="text-xs">
                          Phone                        </FieldLabel>
                        <Input
                          className={!parent.phone ? "border-2 border-red-400" : ""}
                          placeholder="(555) 555-5555"
                          value={parent.phone || ""}
                          autoComplete="tel"
                          type="tel"
                          onChange={(e) =>
                            updateParentLocal(parent.id, "phone", e.target.value)
                          }
                          onBlur={(e) =>
                            saveParentField(parent.id, "phone", e.target.value)
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel className="text-xs">
                          Relationship                        </FieldLabel>
                        <Input
                          className={!parent.relationship ? "border-2 border-red-400" : ""}
                          placeholder="e.g. Mother"
                          value={parent.relationship || ""}
                          onChange={(e) =>
                            updateParentLocal(parent.id, "relationship", e.target.value)
                          }
                          onBlur={(e) =>
                            saveParentField(parent.id, "relationship", e.target.value)
                          }
                        />
                      </Field>
                    </div>
                  </section>

                  <Separator />

                  {/* Address */}
                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      Address
                    </h3>
                    <div className="space-y-4">
                      <div className="grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr]">
                        <Field>
                          <FieldLabel className="text-xs">
                            Street Address{" "}
                                                     </FieldLabel>
                          {/* Standard `autoComplete` tokens unlock the
                              browser's saved-address dropdown (and
                              password-manager address autofill). Each
                              field uses the spec'd token for its
                              role: `address-line1` / `address-line2` /
                              `address-level2` (city) / `address-level1`
                              (state) / `postal-code`. Without these,
                              browsers fall back to ad-hoc heuristics
                              and most users see no suggestions. */}
                          <Input
                            className={!parent.address_line_1 ? "border-2 border-red-400" : ""}
                            placeholder="123 Main Street"
                            value={parent.address_line_1 || ""}
                            autoComplete="address-line1"
                            onChange={(e) =>
                              updateParentLocal(parent.id, "address_line_1", e.target.value)
                            }
                            onBlur={(e) =>
                              saveParentField(parent.id, "address_line_1", e.target.value)
                            }
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">
                            Apt, Suite, etc.
                          </FieldLabel>
                          <Input
                            placeholder="Apt 4B"
                            value={parent.address_line_2 || ""}
                            autoComplete="address-line2"
                            onChange={(e) =>
                              updateParentLocal(parent.id, "address_line_2", e.target.value)
                            }
                            onBlur={(e) =>
                              saveParentField(parent.id, "address_line_2", e.target.value)
                            }
                          />
                        </Field>
                      </div>
                      <div className="grid gap-4 grid-cols-1 sm:grid-cols-[2fr_1fr_1fr]">
                        <Field>
                          <FieldLabel className="text-xs">
                            City                          </FieldLabel>
                          <Input
                            className={!parent.city ? "border-2 border-red-400" : ""}
                            placeholder="St. Petersburg"
                            value={parent.city || ""}
                            autoComplete="address-level2"
                            onChange={(e) =>
                              updateParentLocal(parent.id, "city", e.target.value)
                            }
                            onBlur={(e) =>
                              saveParentField(parent.id, "city", e.target.value)
                            }
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">
                            State                          </FieldLabel>
                          <StateSelect
                            value={parent.state || ""}
                            invalid={!parent.state}
                            onChange={(v) => {
                              updateParentLocal(parent.id, "state", v);
                              saveParentField(parent.id, "state", v);
                            }}
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">
                            Zip Code{" "}
                                                     </FieldLabel>
                          <Input
                            className={!parent.zipcode ? "border-2 border-red-400" : ""}
                            placeholder="33701"
                            value={parent.zipcode || ""}
                            autoComplete="postal-code"
                            onChange={(e) =>
                              updateParentLocal(parent.id, "zipcode", e.target.value)
                            }
                            onBlur={(e) =>
                              saveParentField(parent.id, "zipcode", e.target.value)
                            }
                          />
                        </Field>
                      </div>
                    </div>
                  </section>
                </CardContent>
                  </motion.div>
                )}
                </AnimatePresence>
              </Card>
            ))}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setInviteError("");
                setInviteSheetOpen(true);
              }}
            >
              <Plus className="size-4 mr-1.5" />
              Add Parent/Guardian
            </Button>
          </div>
        )}

      </div>

      <AlertDialog open={!!pendingDeleteParent} onOpenChange={(open) => { if (!open) setPendingDeleteParent(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {pendingDeleteParent?.name}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => pendingDeleteParent && handleDeleteParent(pendingDeleteParent.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Parent Sheet */}
      <Sheet open={inviteSheetOpen} onOpenChange={setInviteSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add Parent or Guardian</SheetTitle>
            <SheetDescription>
              They&apos;ll receive an email to create their own account and
              join your family.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={handleInvite} className="flex flex-col gap-4 p-4">
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel>First Name</FieldLabel>
                <Input
                  value={inviteFirstName}
                  onChange={(e) => setInviteFirstName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Last Name</FieldLabel>
                <Input
                  value={inviteLastName}
                  onChange={(e) => setInviteLastName(e.target.value)}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel>Email</FieldLabel>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel>Relationship</FieldLabel>
              <Input
                placeholder="e.g. Mother, Father, Guardian"
                value={inviteRelationship}
                onChange={(e) => setInviteRelationship(e.target.value)}
              />
            </Field>
            {inviteError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {inviteError}
              </p>
            )}
            <Button type="submit" disabled={inviting} className="mt-2">
              {inviting ? "Sending..." : "Send Invitation"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

