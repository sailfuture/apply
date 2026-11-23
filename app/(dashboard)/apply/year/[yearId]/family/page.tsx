"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useApplicationFlow } from "@/contexts/application-flow-context";
import { Button } from "@/components/ui/button";
import { InviteStatusBadge, ResendInviteButton } from "@/components/invite-status";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
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
import { toast } from "sonner";
import { ConfirmEmailChangeDialog } from "@/components/confirm-email-change-dialog";
import { useSWRConfig } from "swr";
import { GlobalSaveStatusPill } from "@/components/save-status-pill";
import { SmsConsentFields } from "@/components/sms-consent-fields";
import { useFamilyProgress } from "@/hooks/use-family-progress";
import {
  apiFetch,
  stepSavesSettled,
  trackStepSave,
  useApiCacheReader,
} from "@/hooks/use-api";
import { useLazyRef } from "@/hooks/use-lazy-ref";
import { ServiceUnavailable } from "@/components/service-unavailable";
import { hasAffirmativeSmsConsent } from "@/lib/sms/consent";
import { US_STATES } from "@/lib/us-states";

interface Parent {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  relationship: string;
  invite_status: string;
  /** Set once this guardian has an account of their own. */
  clerk_user_id?: string | null;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  zipcode: string;
  /** SMS consent bookkeeping — see lib/sms/consent.ts. Optional
   *  because Xano's embedded relation expansion can return partial
   *  rows; absent just renders the consent box unchecked. */
  sms_consent_source?: string | null;
  sms_opted_out_at?: number | null;
}

interface SchoolYear {
  id: number;
  year_name: string;
}

function getInitials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

// The parent columns this step saves. Leaving a field saves that
// field; "Complete" then sends only what is still unsaved from this
// list (see `handleSaveAll`).
const PARENT_SAVE_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "relationship",
  "address_line_1",
  "address_line_2",
  "city",
  "state",
  "zipcode",
] as const;
type ParentSaveField = (typeof PARENT_SAVE_FIELDS)[number];

// What "Complete" needs on every parent besides an email (see
// `isParentComplete`), and so what gets a red outline once missed.
const REQUIRED_PARENT_FIELDS = [
  "first_name",
  "last_name",
  "phone",
  "relationship",
  "address_line_1",
  "city",
  "state",
  "zipcode",
] as const;
type RequiredParentField = (typeof REQUIRED_PARENT_FIELDS)[number];

/** Key of one parent's field in the page's set of flagged fields. */
const parentFieldKey = (parentId: number, field: ParentSaveField) =>
  `${parentId}:${field}`;
const FAMILY_NAME_KEY = "family_name";

/** `/api/families` as the SWR hooks cache it. */
interface CachedFamily {
  family_name?: string | null;
  parents?: Parent[] | null;
}

/** What ticking or clearing the consent box makes of the parent's row
 *  on screen, ahead of the save (the API does the real mapping from the
 *  virtual `sms_consent` field — see lib/sms/consent.ts). */
function smsConsentChange(consented: boolean): Partial<Parent> {
  return {
    sms_consent_source: consented
      ? "registration_checkbox"
      : "declined_registration_checkbox",
    sms_opted_out_at: consented ? 0 : Date.now(),
  };
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

  // The family as SWR already holds it — the header and the side nav
  // keep `/api/families` loaded, and this page's own saves are written
  // into that entry (see `patchParent`). Moving here from another step
  // starts from it instead of a skeleton; `fetchData` still runs behind
  // it and replaces it with what the server says. Null when there is
  // nothing cached yet (the step was opened by URL).
  const readCached = useApiCacheReader();
  const [seed] = useState(() => {
    const cached = readCached<CachedFamily | null>("/api/families");
    return cached && Array.isArray(cached.parents)
      ? { parents: cached.parents, familyName: cached.family_name ?? "" }
      : null;
  });

  const [parents, setParents] = useState<Parent[]>(() => seed?.parents ?? []);
  const [familyName, setFamilyName] = useState(() => seed?.familyName ?? "");
  const [yearName, setYearName] = useState("");
  const [loading, setLoading] = useState(seed === null);
  // Set only when the FIRST load fails. A refetch that fails after the
  // family is on screen (after an invite, say) keeps the data — same
  // rule as the SWR-driven pages: only an error with nothing behind it
  // blocks the page.
  const [loadFailed, setLoadFailed] = useState(false);
  const loadedOnceRef = useRef(seed !== null);

  // What the server has for each parent as far as this page knows: the
  // row as loaded, then patched by every save that went through.
  // "Complete" compares against it and sends only what is not saved.
  const savedParentsRef = useLazyRef(
    () => new Map<number, Parent>((seed?.parents ?? []).map((p) => [p.id, p]))
  );
  // Counts local changes (typing, the consent box, removing a guardian).
  // A background refresh that started before the latest one is not
  // applied — it would put the old values back over what was just typed.
  const localChangesRef = useRef(0);
  // Only the newest load may apply its result.
  const loadSeqRef = useRef(0);

  // Required fields the parent has been in and left, or that a failed
  // "Complete" pointed at. A field is outlined in red only when it is in
  // here AND still empty: a brand-new parent used to open this step to a
  // red "Relationship" box before typing anything.
  const [flagged, setFlagged] = useState<ReadonlySet<string>>(() => new Set());
  function flagFields(keys: string[]) {
    setFlagged((prev) => {
      if (keys.every((k) => prev.has(k))) return prev;
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }
  function isMissing(parent: Parent, field: RequiredParentField): boolean {
    return flagged.has(parentFieldKey(parent.id, field)) && !parent[field];
  }

  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFirstName, setInviteFirstName] = useState("");
  const [inviteLastName, setInviteLastName] = useState("");
  const [inviteRelationship, setInviteRelationship] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");

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

  // `background` is the load that runs behind a page already on screen
  // (the one on arrival). It must not undo what the parent has typed
  // since it started; the loads the parent asks for (after an invite,
  // "Try again") always apply, as they always have.
  const fetchData = useCallback(async (opts?: { background?: boolean }) => {
    const seq = ++loadSeqRef.current;
    const changesAtStart = localChangesRef.current;
    try {
      // A save from a moment ago (a field left on the way out of this
      // step, last visit) has to land first, or this read can come back
      // without it and show the old value.
      await stepSavesSettled();
      // `apiFetch` retries a 401 once after refreshing the Clerk token
      // (a cold load can race that refresh). Any other non-2xx used to
      // be skipped silently, which rendered an empty family — it now
      // throws so the catch below can decide whether to block the page.
      const [familyRes, yearsRes] = await Promise.all([
        apiFetch("/api/families"),
        apiFetch("/api/school-years"),
      ]);
      if (!familyRes.ok) throw new Error(`API error ${familyRes.status}`);
      if (!yearsRes.ok) throw new Error(`API error ${yearsRes.status}`);
      const fam: CachedFamily | null = await familyRes.json();
      const years: SchoolYear[] = await yearsRes.json();
      // A newer load started while this one was out; it decides.
      if (seq !== loadSeqRef.current) return;
      const found = years.find((y) => y.id === Number(yearId));
      if (found) setYearName(found.year_name);
      const keepLocal =
        opts?.background === true &&
        loadedOnceRef.current &&
        localChangesRef.current !== changesAtStart;
      if (!keepLocal) {
        const loaded = fam?.parents ?? [];
        setParents(loaded);
        if (fam?.family_name) setFamilyName(fam.family_name);
        savedParentsRef.current = new Map(loaded.map((p) => [p.id, p]));
        // Hand the fresh copy to SWR too: it is what this step, the
        // Students step and the header start from next time.
        if (fam) void mutate("/api/families", fam, { revalidate: false });
      }
      loadedOnceRef.current = true;
      setLoadFailed(false);
    } catch (err) {
      console.error("Failed to fetch:", err);
      if (seq === loadSeqRef.current && !loadedOnceRef.current) {
        setLoadFailed(true);
      }
    } finally {
      // An overtaken load leaves the skeleton to the one that replaced it.
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [yearId, mutate, savedParentsRef]);

  useEffect(() => {
    fetchData({ background: true });
  }, [fetchData]);

  function updateParentLocal(parentId: number, field: string, value: string) {
    localChangesRef.current += 1;
    setParents((prev) =>
      prev.map((p) => (p.id === parentId ? { ...p, [field]: value } : p))
    );
  }

  /** Apply a change to the cached `/api/families` parents, so the
   *  header, the Students step and the next visit here all see it. */
  function updateCachedParents(update: (parents: Parent[]) => Parent[]) {
    void mutate(
      "/api/families",
      (curr: CachedFamily | null | undefined) =>
        curr && Array.isArray(curr.parents)
          ? { ...curr, parents: update(curr.parents) }
          : curr,
      { revalidate: false }
    );
  }

  /**
   * Every parent PATCH from this page goes through here, so one place
   * keeps three things true:
   *   - `savedParentsRef` knows what the server has, which is how
   *     "Complete" avoids sending a field a blur already saved;
   *   - `trackStepSave` lets "Complete" and the next load (here or on
   *     another step) wait for a save that is still on the wire;
   *   - the cached `/api/families` carries the change straight away, so
   *     leaving the step and coming back shows it. A save that fails
   *     refetches that entry, putting back what the server has.
   * `body` is what is sent; `local` is what it makes of the row (they
   * differ only for the consent box, whose field is virtual).
   */
  function patchParent(
    parentId: number,
    body: object,
    local: Partial<Parent>,
    failure = "Save failed"
  ): Promise<void> {
    const applyToCache = () =>
      updateCachedParents((list) =>
        list.map((p) => (p.id === parentId ? { ...p, ...local } : p))
      );
    applyToCache();
    const request = fetch(`/api/parents/${parentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${failure} (${res.status}) ${text}`);
      }
      const saved = savedParentsRef.current.get(parentId);
      if (saved) savedParentsRef.current.set(parentId, { ...saved, ...local });
      // Once more now that it is saved: a refetch of the family that
      // overlapped the save may have put the old row back.
      applyToCache();
    });
    request.catch(() => void mutate("/api/families"));
    return trackStepSave(request);
  }

  const [saving, setSaving] = useState(false);

  // Is this card the signed-in parent's own? By account id, so the
  // answer doesn't flip while they are typing in their email field (the
  // old test compared the field's text to the sign-in email). Falls
  // back to the email for a row that arrived without its account id.
  function isMyCard(parent: Parent): boolean {
    if (parent.clerk_user_id) return parent.clerk_user_id === clerkUser?.id;
    return parent.email === currentUserEmail;
  }

  // A change to the signed-in parent's OWN email is also a change to
  // what they sign in with. Leaving the field only proposes it; the
  // dialog commits it (see ConfirmEmailChangeDialog).
  const [pendingEmail, setPendingEmail] = useState<{
    parentId: number;
    email: string;
  } | null>(null);
  const [changingEmail, setChangingEmail] = useState(false);

  function handleEmailBlur(parent: Parent, value: string) {
    if (!isMyCard(parent)) {
      // An invited parent who hasn't signed up yet: a plain contact
      // field. (A guardian WITH an account has this field disabled.)
      void saveParentField(parent.id, "email", value);
      return;
    }
    const next = value.trim();
    if (!next) {
      updateParentLocal(parent.id, "email", currentUserEmail);
      return;
    }
    if (next.toLowerCase() === currentUserEmail.trim().toLowerCase()) return;
    setPendingEmail({ parentId: parent.id, email: next });
  }

  async function confirmEmailChange() {
    if (!pendingEmail) return;
    setChangingEmail(true);
    try {
      const res = await fetch(`/api/parents/${pendingEmail.parentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: pendingEmail.email,
          confirm_email_change: true,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "");
      }
      // The cached family this step opens from next time has the old
      // address until it is refetched; give it the new one now.
      const changed = pendingEmail;
      updateCachedParents((list) =>
        list.map((p) =>
          p.id === changed.parentId ? { ...p, email: changed.email } : p
        )
      );
      // Pick up the new sign-in email so this card still reads as "mine"
      // and the header shows the right address.
      await clerkUser?.reload();
      toast.success("Your sign-in email was changed.");
      setPendingEmail(null);
    } catch (err) {
      toast.error(
        (err instanceof Error && err.message) ||
          "We couldn't change your email. Please try again."
      );
    } finally {
      setChangingEmail(false);
    }
  }

  function cancelEmailChange() {
    if (pendingEmail) {
      updateParentLocal(pendingEmail.parentId, "email", currentUserEmail);
    }
    setPendingEmail(null);
  }

  async function saveParentField(
    parentId: number,
    field: ParentSaveField,
    value: string
  ) {
    // Per-field onBlur auto-save — drives the global SaveStatusPill badge
    // shown in the apply-flow layout so users see "Saving… → Saved Xs ago".
    const change: Partial<Parent> = {};
    change[field] = value;
    try {
      await trackAutosave(patchParent(parentId, change, change));
    } catch (err) {
      console.error("Failed to save parent field:", err);
    }
  }

  /** Leaving a field: from here on it may show as missing, and it saves. */
  function handleFieldBlur(
    parentId: number,
    field: ParentSaveField,
    value: string
  ) {
    flagFields([parentFieldKey(parentId, field)]);
    void saveParentField(parentId, field, value);
  }

  /**
   * Consent-checkbox toggle on the signed-in parent's own card. Saves
   * through the same autosave channel as the other fields (SaveStatusPill
   * feedback); the API maps the virtual `sms_consent` boolean onto the
   * real consent columns and refuses it for anyone else's row. Local
   * state updates optimistically with the same mapping so the checkbox
   * doesn't lag the click.
   */
  async function saveSmsConsent(parentId: number, consented: boolean) {
    const change = smsConsentChange(consented);
    localChangesRef.current += 1;
    setParents((prev) =>
      prev.map((p) => (p.id === parentId ? { ...p, ...change } : p))
    );
    try {
      await trackAutosave(
        patchParent(parentId, { sms_consent: consented }, change)
      );
    } catch (err) {
      console.error("Failed to save SMS consent:", err);
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

  /** The fields of `p` the server does not have yet: typed (or filled
   *  in by the browser) but never saved by a blur, or whose save failed. */
  function unsavedParentFields(p: Parent): Partial<Parent> {
    const saved = savedParentsRef.current.get(p.id);
    const unsaved: Partial<Parent> = {};
    for (const field of PARENT_SAVE_FIELDS) {
      // A sign-in email changes only through its own confirmation
      // dialog (this parent's card), and never from someone else's card.
      if (field === "email" && (p.clerk_user_id || isMyCard(p))) continue;
      const value = p[field] ?? "";
      if (!saved || value !== (saved[field] ?? "")) unsaved[field] = value;
    }
    return unsaved;
  }

  async function handleSaveAll() {
    setSaving(true);
    try {
      await trackAutosave(
        (async () => {
          // The field the parent was in when they pressed Complete has
          // just started its own save on blur. Wait for it, then send
          // only what is still unsaved. This used to PATCH every parent
          // with every field regardless, so each Complete sent that
          // parent's save twice.
          await stepSavesSettled();
          await Promise.all(
            parents.map((p) => {
              const unsaved = unsavedParentFields(p);
              if (Object.keys(unsaved).length === 0) return undefined;
              return patchParent(
                p.id,
                unsaved,
                unsaved,
                `Failed to save ${p.first_name}`
              );
            })
          );
        })()
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

  // Single progress source: apply + reapply share the same
  // `registration_family_application_progress` row, distinguished by
  // its `type` field. The reapply-side branching (a parallel
  // `useReapplyFamilyProgress` hook + `isFamilyDetails` bool) is
  // gone — re-enrollment families write to `family_completed` like
  // everyone else.
  const yearIdNum = Number(yearId);
  const applyProgress = useFamilyProgress(yearIdNum);
  const familyLocked = !!applyProgress.progress?.family_completed;
  // Stabilize the lock setter via a ref. The progress hook returns
  // a fresh object literal each render, so naming it in a useCallback
  // dep list gives every render a new function identity — which
  // feeds into the `updateSaveOptions` useEffect below and creates
  // an infinite loop. The ref keeps callback identity stable.
  const flowRef = useRef({ applyProgress });
  flowRef.current = { applyProgress };
  const setProgressSectionLocked = useCallback((value: boolean) => {
    return flowRef.current.applyProgress.setSection("family_completed", value);
  }, []);

  const handleCompleteRef = useRef<() => Promise<void>>(() => Promise.resolve());
  handleCompleteRef.current = async () => {
    const allComplete = parents.length > 0 && parents.every((p) => isParentComplete(p));
    if (!allComplete) {
      // Show which ones: every required field still empty turns red.
      flagFields(
        parents.flatMap((p) =>
          REQUIRED_PARENT_FIELDS.map((f) => parentFieldKey(p.id, f))
        )
      );
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
    localChangesRef.current += 1;
    setParents((prev) => prev.filter((p) => p.id !== parentId));
    updateCachedParents((list) => list.filter((p) => p.id !== parentId));
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

  // The first load gave up (`apiFetch` threw, or an endpoint answered
  // non-2xx) with nothing on screen to keep. Render the retry card
  // instead of an empty family; "Try again" re-runs this page's load
  // and refetches every parent-API SWR key (the progress row behind
  // the Complete button lives there).
  if (loadFailed) {
    return (
      <ServiceUnavailable
        onRetry={() => {
          setLoadFailed(false);
          setLoading(true);
          void fetchData();
          void mutate(
            (key) => typeof key === "string" && key.startsWith("/api/")
          );
        }}
      />
    );
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
                onChange={(e) => {
                  localChangesRef.current += 1;
                  setFamilyName(e.target.value);
                }}
                onBlur={(e) => {
                  flagFields([FAMILY_NAME_KEY]);
                  saveFamilyName(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className={
                  flagged.has(FAMILY_NAME_KEY) && !familyName.trim()
                    ? "border-2 border-red-400"
                    : ""
                }
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
                <CardHeader className="border-b py-3 !pb-3">
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
                      <InviteStatusBadge status={parent.invite_status} />
                      <ResendInviteButton
                        parentId={parent.id}
                        status={parent.invite_status}
                        size="xs"
                      />
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
                      {!isMyCard(parent) && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-red-600"
                          onClick={() => setPendingDeleteParent({ id: parent.id, name: `${parent.first_name} ${parent.last_name}` })}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
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
                        <FieldLabel className="text-xs">First Name <span className="text-red-400">*</span></FieldLabel>
                        <Input
                          className={isMissing(parent, "first_name") ? "border-2 border-red-400" : ""}
                          placeholder="Jane"
                          value={parent.first_name || ""}
                          autoComplete="given-name"
                          onChange={(e) =>
                            updateParentLocal(parent.id, "first_name", e.target.value)
                          }
                          onBlur={(e) =>
                            handleFieldBlur(parent.id, "first_name", e.target.value)
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel className="text-xs">Last Name <span className="text-red-400">*</span></FieldLabel>
                        <Input
                          className={isMissing(parent, "last_name") ? "border-2 border-red-400" : ""}
                          placeholder="Walsh"
                          value={parent.last_name || ""}
                          autoComplete="family-name"
                          onChange={(e) =>
                            updateParentLocal(parent.id, "last_name", e.target.value)
                          }
                          onBlur={(e) =>
                            handleFieldBlur(parent.id, "last_name", e.target.value)
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
                          // Another guardian's sign-in email is theirs
                          // alone to change (the API enforces it too).
                          disabled={
                            !!parent.clerk_user_id &&
                            parent.clerk_user_id !== clerkUser?.id
                          }
                          onChange={(e) =>
                            updateParentLocal(parent.id, "email", e.target.value)
                          }
                          onBlur={(e) => handleEmailBlur(parent, e.target.value)}
                        />
                        {!!parent.clerk_user_id &&
                          parent.clerk_user_id !== clerkUser?.id && (
                            <p className="text-xs text-muted-foreground">
                              Only {parent.first_name || "this guardian"} can
                              change their sign-in email.
                            </p>
                          )}
                      </Field>
                      <Field>
                        <FieldLabel className="text-xs">
                          Phone <span className="text-red-400">*</span></FieldLabel>
                        <PhoneInput
                          className={isMissing(parent, "phone") ? "border-2 border-red-400" : ""}
                          value={parent.phone || ""}
                          autoComplete="tel"
                          onChange={(d) =>
                            updateParentLocal(parent.id, "phone", d)
                          }
                          onValidate={(result) => {
                            // Fires when the field is left, empty or not.
                            flagFields([parentFieldKey(parent.id, "phone")]);
                            // Only persist valid (or empty) values so we
                            // don't write a partially-typed number back
                            // to Xano on blur. Invalid input stays in
                            // the local UI state with the inline error
                            // caption rendered under the input.
                            if (result.valid) {
                              saveParentField(parent.id, "phone", result.digits);
                            }
                          }}
                        />
                      </Field>
                      <Field>
                        <FieldLabel className="text-xs">
                          Relationship <span className="text-red-400">*</span></FieldLabel>
                        <Input
                          className={isMissing(parent, "relationship") ? "border-2 border-red-400" : ""}
                          placeholder="e.g. Mother"
                          value={parent.relationship || ""}
                          onChange={(e) =>
                            updateParentLocal(parent.id, "relationship", e.target.value)
                          }
                          onBlur={(e) =>
                            handleFieldBlur(parent.id, "relationship", e.target.value)
                          }
                        />
                      </Field>
                    </div>

                    {/* SMS opt-in — rendered ONLY on the signed-in
                        parent's own card, directly under the phone
                        field it applies to: express consent is
                        personal, so one parent can't check the box
                        for another adult's number. Checkbox reflects
                        the stored decision (checked = affirmative
                        consent on file, incl. from the welcome page)
                        and toggling auto-saves like every other field
                        on this card. */}
                    {isMyCard(parent) ? (
                      <div className="mt-4 rounded-lg border bg-muted/30 p-4">
                        <SmsConsentFields
                          showPhone={false}
                          consented={hasAffirmativeSmsConsent(parent)}
                          onConsentChange={(v) =>
                            saveSmsConsent(parent.id, v)
                          }
                        />
                      </div>
                    ) : null}
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
                            Street Address <span className="text-red-400">*</span></FieldLabel>
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
                            className={isMissing(parent, "address_line_1") ? "border-2 border-red-400" : ""}
                            placeholder="123 Main Street"
                            value={parent.address_line_1 || ""}
                            autoComplete="address-line1"
                            onChange={(e) =>
                              updateParentLocal(parent.id, "address_line_1", e.target.value)
                            }
                            onBlur={(e) =>
                              handleFieldBlur(parent.id, "address_line_1", e.target.value)
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
                            City <span className="text-red-400">*</span></FieldLabel>
                          <Input
                            className={isMissing(parent, "city") ? "border-2 border-red-400" : ""}
                            placeholder="St. Petersburg"
                            value={parent.city || ""}
                            autoComplete="address-level2"
                            onChange={(e) =>
                              updateParentLocal(parent.id, "city", e.target.value)
                            }
                            onBlur={(e) =>
                              handleFieldBlur(parent.id, "city", e.target.value)
                            }
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">
                            State <span className="text-red-400">*</span></FieldLabel>
                          <StateSelect
                            value={parent.state || ""}
                            // No "left the field" moment on this picker:
                            // it turns red after a failed Complete.
                            invalid={isMissing(parent, "state")}
                            onChange={(v) => {
                              updateParentLocal(parent.id, "state", v);
                              saveParentField(parent.id, "state", v);
                            }}
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">
                            Zip Code <span className="text-red-400">*</span></FieldLabel>
                          <Input
                            className={isMissing(parent, "zipcode") ? "border-2 border-red-400" : ""}
                            placeholder="33701"
                            value={parent.zipcode || ""}
                            autoComplete="postal-code"
                            onChange={(e) =>
                              updateParentLocal(parent.id, "zipcode", e.target.value)
                            }
                            onBlur={(e) =>
                              handleFieldBlur(parent.id, "zipcode", e.target.value)
                            }
                          />
                        </Field>
                      </div>
                    </div>
                  </section>
                </CardContent>
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

      <ConfirmEmailChangeDialog
        from={currentUserEmail}
        to={pendingEmail?.email ?? null}
        busy={changingEmail}
        onConfirm={() => void confirmEmailChange()}
        onCancel={cancelEmailChange}
      />
    </>
  );
}

