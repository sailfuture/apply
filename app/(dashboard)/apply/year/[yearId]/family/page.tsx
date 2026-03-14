"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
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
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";
import { Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
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

  const {
    setPageTitle,
    registerSaveHandler,
    unregisterSaveHandler,
    updateSaveOptions,
  } = useApplicationFlow();

  const [parents, setParents] = useState<Parent[]>([]);
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

  // Auto-collapse complete parents on initial load, open incomplete ones
  useEffect(() => {
    if (loading || initialCollapseRef.current || parents.length === 0) return;
    initialCollapseRef.current = true;
    const openIds = new Set<number>();
    parents.forEach((p) => {
      if (!isParentComplete(p)) openIds.add(p.id);
    });
    // If all are complete, open the first one
    if (openIds.size === 0 && parents.length > 0) openIds.add(parents[0].id);
    setOpenParents(openIds);
  }, [loading, parents]);

  function updateParentLocal(parentId: number, field: string, value: string) {
    setParents((prev) =>
      prev.map((p) => (p.id === parentId ? { ...p, [field]: value } : p))
    );
  }

  const [saving, setSaving] = useState(false);

  async function saveParentField(parentId: number, field: string, value: string) {
    try {
      await fetch(`/api/parents/${parentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
    } catch (err) {
      console.error("Failed to save parent field:", err);
    }
  }

  async function handleSaveAll() {
    setSaving(true);
    try {
      await Promise.all(
        parents.map((p) =>
          fetch(`/api/parents/${p.id}`, {
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
          })
        )
      );
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  }

  const handleSaveAllRef = useRef(handleSaveAll);
  handleSaveAllRef.current = handleSaveAll;

  useEffect(() => {
    setPageTitle("Family Information");
    registerSaveHandler(() => handleSaveAllRef.current(), { label: "Save" });
    return () => unregisterSaveHandler();
  }, [setPageTitle, registerSaveHandler, unregisterSaveHandler]);

  useEffect(() => {
    updateSaveOptions({ saving });
  }, [saving, updateSaveOptions]);

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
        {/* Parent card skeleton */}
        <div className="rounded-lg border p-6">
          <Skeleton className="h-5 w-40 mb-4" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>
            ))}
          </div>
        </div>
        {/* Second parent card skeleton */}
        <div className="rounded-lg border p-6">
          <Skeleton className="h-5 w-40 mb-4" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-6 p-6 mx-auto w-full max-w-4xl">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Family Information</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage contact information and addresses for all parents and
            guardians.
          </p>
        </div>

        {parents.length === 0 ? (
          <div className="flex min-h-[20vh] items-center justify-center rounded-lg border">
            <p className="text-muted-foreground text-sm">
              No parents found. Add a parent or guardian to continue.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {parents.map((parent, idx) => (
              <Card key={parent.id} className="overflow-hidden gap-0 py-0 ring-0 border">
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
                      {idx === parents.length - 1 && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setInviteError("");
                            setInviteSheetOpen(true);
                          }}
                        >
                          Add Parent/Guardian
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-red-600"
                        onClick={(e) => { e.stopPropagation(); setPendingDeleteParent({ id: parent.id, name: `${parent.first_name} ${parent.last_name}` }); }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
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
                <CardContent className="space-y-6 py-5 bg-gray-50 dark:bg-muted/50">
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
                          className={!parent.phone ? "border-red-400" : ""}
                          placeholder="(555) 555-5555"
                          value={parent.phone || ""}
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
                          className={!parent.relationship ? "border-red-400" : ""}
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
                          <Input
                            className={!parent.address_line_1 ? "border-red-400" : ""}
                            placeholder="123 Main Street"
                            value={parent.address_line_1 || ""}
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
                            className={!parent.city ? "border-red-400" : ""}
                            placeholder="St. Petersburg"
                            value={parent.city || ""}
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
                          <Combobox
                            value={parent.state || ""}
                            onValueChange={(v) => {
                              updateParentLocal(parent.id, "state", v as string);
                              saveParentField(parent.id, "state", v as string);
                            }}
                          >
                            <ComboboxInput
                              placeholder="Search state..."
                              className={`w-full ${!parent.state ? "border-red-400" : ""}`}
                            />
                            <ComboboxContent>
                              <ComboboxList>
                                {US_STATES.map((s) => (
                                  <ComboboxItem key={s.value} value={s.value}>
                                    {s.label}
                                  </ComboboxItem>
                                ))}
                              </ComboboxList>
                              <ComboboxEmpty>No state found</ComboboxEmpty>
                            </ComboboxContent>
                          </Combobox>
                        </Field>
                        <Field>
                          <FieldLabel className="text-xs">
                            Zip Code{" "}
                                                     </FieldLabel>
                          <Input
                            className={!parent.zipcode ? "border-red-400" : ""}
                            placeholder="33701"
                            value={parent.zipcode || ""}
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
            <AlertDialogAction onClick={() => pendingDeleteParent && handleDeleteParent(pendingDeleteParent.id)}>
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

