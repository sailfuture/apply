"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
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
  const router = useRouter();
  const yearId = params.yearId as string;

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

  const [pendingDeleteParent, setPendingDeleteParent] = useState<{ id: number; name: string } | null>(null);

  async function handleDeleteParent(parentId: number) {
    try {
      const res = await fetch(`/api/parents/${parentId}`, { method: "DELETE" });
      if (res.ok) {
        setParents((prev) => prev.filter((p) => p.id !== parentId));
      }
    } catch (err) {
      console.error("Failed to delete parent:", err);
    }
    setPendingDeleteParent(null);
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
      <>
        <StepHeader yearId={yearId} yearName="" />
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <StepHeader yearId={yearId} yearName={yearName} />
      <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <div>
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
              <Card key={parent.id} className="overflow-hidden gap-0 py-0">
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
                      <Button
                        variant={idx === parents.length - 1 ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setInviteError("");
                          setInviteSheetOpen(true);
                        }}
                        disabled={idx !== parents.length - 1}
                      >
                        Add Parent/Guardian
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-red-600"
                        onClick={() => setPendingDeleteParent({ id: parent.id, name: `${parent.first_name} ${parent.last_name}` })}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
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
                          Phone <span className="text-destructive">*</span>
                        </FieldLabel>
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
                        <FieldLabel className="text-xs">Relationship</FieldLabel>
                        <Input
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
                            <span className="text-destructive">*</span>
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
                            City <span className="text-destructive">*</span>
                          </FieldLabel>
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
                            State <span className="text-destructive">*</span>
                          </FieldLabel>
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
                            <span className="text-destructive">*</span>
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
              </Card>
            ))}
          </div>
        )}

        <div className="h-20" />
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:left-[var(--sidebar-width)]">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6">
          <Button
            variant="outline"
            onClick={() => router.push(`/apply/year/${yearId}`)}
          >
            &larr; Back to Checklist
          </Button>
          <Button onClick={handleSaveAll} disabled={saving}>
            {saving ? "Saving..." : "Save Section"}
          </Button>
        </div>
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

function StepHeader({
  yearId,
  yearName,
}: {
  yearId: string;
  yearName: string;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2">
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mr-2 data-vertical:h-4 data-vertical:self-auto"
        />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href="/">Dashboard</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href={`/apply/year/${yearId}`}>
                {yearName || "Application"}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>Family</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  );
}
