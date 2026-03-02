"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
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

interface Parent {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: number;
  relationship: string;
  invite_status: string;
}

interface Family {
  id: number;
  family_name: string;
  registration_parents_id: number[];
  registration_students_id: number[];
  parents: Parent[];
}

export default function RegisterPage() {
  const [family, setFamily] = useState<Family | null>(null);
  const [loading, setLoading] = useState(true);
  const [familyName, setFamilyName] = useState("");
  const [creating, setCreating] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFirstName, setInviteFirstName] = useState("");
  const [inviteLastName, setInviteLastName] = useState("");
  const [inviteRelationship, setInviteRelationship] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [inviteError, setInviteError] = useState("");

  const fetchFamily = useCallback(async () => {
    try {
      const res = await fetch("/api/families");
      if (res.ok) {
        const data = await res.json();
        setFamily(data);
      }
    } catch (err) {
      console.error("Failed to fetch family:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFamily();
  }, [fetchFamily]);

  async function handleCreateFamily(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/api/families", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_name: familyName }),
      });
      if (res.ok) {
        await fetchFamily();
        setFamilyName("");
      }
    } catch (err) {
      console.error("Failed to create family:", err);
    } finally {
      setCreating(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteSuccess("");
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
        setInviteSuccess(`Invitation sent to ${inviteEmail}`);
        setInviteEmail("");
        setInviteFirstName("");
        setInviteLastName("");
        setInviteRelationship("");
        await fetchFamily();
      } else {
        const body = await res.json().catch(() => null);
        setInviteError(body?.error ?? "Failed to send invitation");
      }
    } catch (err) {
      console.error("Failed to send invite:", err);
      setInviteError("Network error — please try again");
    } finally {
      setInviting(false);
    }
  }

  const pageHeader = (
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
            <BreadcrumbItem>
              <BreadcrumbPage>Family</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  );

  if (loading) {
    return (
      <>
        {pageHeader}
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </>
    );
  }

  if (!family) {
    return (
      <>
        {pageHeader}
        <div className="mx-auto max-w-lg px-4 py-12">
          <Card>
          <CardHeader>
            <CardTitle>Create Your Family</CardTitle>
            <CardDescription>
              Set up your family to start the registration process.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleCreateFamily}>
            <CardContent>
              <div className="grid gap-2">
                <Label htmlFor="family_name">Family Name</Label>
                <Input
                  id="family_name"
                  placeholder='e.g. "The Walsh Family"'
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  required
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" disabled={creating}>
                {creating ? "Creating..." : "Create Family"}
              </Button>
            </CardFooter>
          </form>
        </Card>
        </div>
      </>
    );
  }

  return (
    <>
      {pageHeader}
      <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">{family.family_name}</h1>
        <p className="text-muted-foreground mt-1">
          Manage your family contacts below.
        </p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Family Members</CardTitle>
            <CardDescription>
              Parents and guardians linked to this family.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {family.parents && family.parents.length > 0 ? (
              <div className="grid gap-3">
                {family.parents.map((parent) => (
                  <div
                    key={parent.id}
                    className="bg-muted/50 flex items-center justify-between rounded-lg border px-4 py-3"
                  >
                    <div>
                      <p className="font-medium">
                        {parent.first_name} {parent.last_name}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {parent.email}
                        {parent.relationship && ` · ${parent.relationship}`}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        parent.invite_status === "active"
                          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                      }`}
                    >
                      {parent.invite_status === "active" ? "Active" : "Pending"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                No family members yet.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invite a Parent or Guardian</CardTitle>
            <CardDescription>
              They&apos;ll receive an email to create their own account and join
              your family.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleInvite}>
            <CardContent>
              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="invite_first_name">First Name</Label>
                    <Input
                      id="invite_first_name"
                      value={inviteFirstName}
                      onChange={(e) => setInviteFirstName(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="invite_last_name">Last Name</Label>
                    <Input
                      id="invite_last_name"
                      value={inviteLastName}
                      onChange={(e) => setInviteLastName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="invite_email">Email</Label>
                  <Input
                    id="invite_email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="invite_relationship">Relationship</Label>
                  <Input
                    id="invite_relationship"
                    placeholder="e.g. Mother, Father, Guardian"
                    value={inviteRelationship}
                    onChange={(e) => setInviteRelationship(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex items-center gap-3">
              <Button type="submit" disabled={inviting}>
                {inviting ? "Sending..." : "Send Invitation"}
              </Button>
              {inviteSuccess && (
                <p className="text-sm text-green-600 dark:text-green-400">
                  {inviteSuccess}
                </p>
              )}
              {inviteError && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {inviteError}
                </p>
              )}
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
    </>
  );
}
