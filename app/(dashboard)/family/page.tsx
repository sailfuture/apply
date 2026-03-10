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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

interface Student {
  id: number;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  ethnicity: string;
  registration_families_id: number;
  isArchived: boolean;
}

function getInitials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

const avatarColors = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-indigo-500",
  "bg-teal-500",
];

function getAvatarColor(id: number): string {
  return avatarColors[id % avatarColors.length];
}

function formatDob(dob: string): string {
  return new Date(dob + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatAge(dob: string): string {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return `${age}`;
}

export default function FamilyPage() {
  const [family, setFamily] = useState<Family | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [familyName, setFamilyName] = useState("");
  const [creatingFamily, setCreatingFamily] = useState(false);

  // Invite parent sheet
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFirstName, setInviteFirstName] = useState("");
  const [inviteLastName, setInviteLastName] = useState("");
  const [inviteRelationship, setInviteRelationship] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [inviteError, setInviteError] = useState("");

  // Add student sheet
  const [studentSheetOpen, setStudentSheetOpen] = useState(false);
  const [studentFirstName, setStudentFirstName] = useState("");
  const [studentLastName, setStudentLastName] = useState("");
  const [studentDob, setStudentDob] = useState("");
  const [studentGender, setStudentGender] = useState("");
  const [studentEthnicity, setStudentEthnicity] = useState("");
  const [creatingStudent, setCreatingStudent] = useState(false);
  const [studentError, setStudentError] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [familyRes, studentsRes] = await Promise.all([
        fetch("/api/families"),
        fetch("/api/students"),
      ]);
      if (familyRes.ok) setFamily(await familyRes.json());
      if (studentsRes.ok) setStudents(await studentsRes.json());
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleCreateFamily(e: React.FormEvent) {
    e.preventDefault();
    setCreatingFamily(true);
    try {
      const res = await fetch("/api/families", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ family_name: familyName }),
      });
      if (res.ok) {
        await fetchData();
        setFamilyName("");
      }
    } catch (err) {
      console.error("Failed to create family:", err);
    } finally {
      setCreatingFamily(false);
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
        setInviteSheetOpen(false);
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

  async function handleAddStudent(e: React.FormEvent) {
    e.preventDefault();
    setCreatingStudent(true);
    setStudentError("");
    try {
      const res = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: studentFirstName,
          last_name: studentLastName,
          date_of_birth: studentDob || null,
          gender: studentGender,
          ethnicity: studentEthnicity,
        }),
      });
      if (res.ok) {
        setStudentFirstName("");
        setStudentLastName("");
        setStudentDob("");
        setStudentGender("");
        setStudentEthnicity("");
        setStudentSheetOpen(false);
        await fetchData();
      } else {
        const body = await res.json().catch(() => null);
        setStudentError(body?.error ?? "Failed to add student");
      }
    } catch {
      setStudentError("Network error — please try again");
    } finally {
      setCreatingStudent(false);
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
                <Button type="submit" disabled={creatingFamily}>
                  {creatingFamily ? "Creating..." : "Create Family"}
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
      <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold">{family.family_name}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage your family members and students.
          </p>
        </div>

        {/* Parents & Guardians Table */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Parents & Guardians</h2>
              <p className="text-muted-foreground text-sm">
                Adults linked to this family.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setInviteSuccess("");
                setInviteError("");
                setInviteSheetOpen(true);
              }}
            >
              Invite Member
            </Button>
          </div>
          {family.parents && family.parents.length > 0 ? (
            <div className="rounded-lg border">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-muted-foreground px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                      Member
                    </th>
                    <th className="text-muted-foreground hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider sm:table-cell">
                      Email
                    </th>
                    <th className="text-muted-foreground hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider md:table-cell">
                      Phone
                    </th>
                    <th className="text-muted-foreground hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider lg:table-cell">
                      Relationship
                    </th>
                    <th className="text-muted-foreground px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {family.parents.map((parent) => (
                    <tr
                      key={parent.id}
                      className="hover:bg-muted/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar size="default">
                            <AvatarFallback
                              className={`${getAvatarColor(parent.id)} text-white text-xs font-medium`}
                            >
                              {getInitials(parent.first_name, parent.last_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">
                              {parent.first_name} {parent.last_name}
                            </p>
                            <p className="text-muted-foreground text-xs sm:hidden">
                              {parent.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="text-muted-foreground hidden px-4 py-3 text-sm sm:table-cell">
                        {parent.email || "—"}
                      </td>
                      <td className="text-muted-foreground hidden px-4 py-3 text-sm md:table-cell">
                        {parent.phone || "—"}
                      </td>
                      <td className="text-muted-foreground hidden px-4 py-3 text-sm capitalize lg:table-cell">
                        {parent.relationship || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            parent.invite_status === "active"
                              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                          }`}
                        >
                          {parent.invite_status === "active"
                            ? "Active"
                            : "Pending"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex min-h-[12vh] items-center justify-center rounded-lg border">
              <p className="text-muted-foreground text-sm">
                No family members yet.
              </p>
            </div>
          )}
        </div>

        {/* Students Table */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Students</h2>
              <p className="text-muted-foreground text-sm">
                Children enrolled or applying to SailFuture Academy.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStudentError("");
                setStudentSheetOpen(true);
              }}
            >
              Add Student
            </Button>
          </div>
          {students.length > 0 ? (
            <div className="rounded-lg border">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-muted-foreground px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                      Student
                    </th>
                    <th className="text-muted-foreground hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider md:table-cell">
                      Date of Birth
                    </th>
                    <th className="text-muted-foreground hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider sm:table-cell">
                      Age
                    </th>
                    <th className="text-muted-foreground hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider lg:table-cell">
                      Gender
                    </th>
                    <th className="text-muted-foreground hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider lg:table-cell">
                      Ethnicity
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {students.map((student) => (
                    <tr
                      key={student.id}
                      className="hover:bg-muted/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar size="default">
                            <AvatarFallback
                              className={`${getAvatarColor(student.id + 100)} text-white text-xs font-medium`}
                            >
                              {getInitials(
                                student.first_name,
                                student.last_name
                              )}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">
                              {student.first_name} {student.last_name}
                            </p>
                            <p className="text-muted-foreground text-xs md:hidden">
                              {student.date_of_birth
                                ? formatDob(student.date_of_birth)
                                : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="text-muted-foreground hidden px-4 py-3 text-sm md:table-cell">
                        {student.date_of_birth
                          ? formatDob(student.date_of_birth)
                          : "—"}
                      </td>
                      <td className="text-muted-foreground hidden px-4 py-3 text-sm sm:table-cell">
                        {student.date_of_birth
                          ? formatAge(student.date_of_birth)
                          : "—"}
                      </td>
                      <td className="text-muted-foreground hidden px-4 py-3 text-sm lg:table-cell">
                        {student.gender || "—"}
                      </td>
                      <td className="text-muted-foreground hidden px-4 py-3 text-sm lg:table-cell">
                        {student.ethnicity || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex min-h-[12vh] items-center justify-center rounded-lg border">
              <p className="text-muted-foreground text-sm">
                No students added yet.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Invite Parent/Guardian Sheet */}
      <Sheet open={inviteSheetOpen} onOpenChange={setInviteSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Invite a Parent or Guardian</SheetTitle>
            <SheetDescription>
              They&apos;ll receive an email to create their own account and
              join your family.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={handleInvite} className="flex flex-col gap-4 p-4">
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

            {inviteError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {inviteError}
              </p>
            )}
            {inviteSuccess && (
              <p className="text-sm text-green-600 dark:text-green-400">
                {inviteSuccess}
              </p>
            )}

            <Button type="submit" disabled={inviting} className="mt-2">
              {inviting ? "Sending..." : "Send Invitation"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>

      {/* Add Student Sheet */}
      <Sheet open={studentSheetOpen} onOpenChange={setStudentSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add Student</SheetTitle>
            <SheetDescription>
              Add a student to your family to begin their application.
            </SheetDescription>
          </SheetHeader>
          <form
            onSubmit={handleAddStudent}
            className="flex flex-col gap-4 p-4"
          >
            <div className="grid gap-2">
              <Label htmlFor="student_first_name">First Name</Label>
              <Input
                id="student_first_name"
                value={studentFirstName}
                onChange={(e) => setStudentFirstName(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="student_last_name">Last Name</Label>
              <Input
                id="student_last_name"
                value={studentLastName}
                onChange={(e) => setStudentLastName(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="student_dob">Date of Birth</Label>
              <Input
                id="student_dob"
                type="date"
                value={studentDob}
                onChange={(e) => setStudentDob(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="student_gender">Gender</Label>
              <Select value={studentGender} onValueChange={setStudentGender}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Non-binary">Non-binary</SelectItem>
                  <SelectItem value="Prefer not to say">
                    Prefer not to say
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="student_ethnicity">Ethnicity</Label>
              <Select
                value={studentEthnicity}
                onValueChange={setStudentEthnicity}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select ethnicity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="American Indian or Alaska Native">
                    American Indian or Alaska Native
                  </SelectItem>
                  <SelectItem value="Asian">Asian</SelectItem>
                  <SelectItem value="Black or African American">
                    Black or African American
                  </SelectItem>
                  <SelectItem value="Hispanic or Latino">
                    Hispanic or Latino
                  </SelectItem>
                  <SelectItem value="Native Hawaiian or Pacific Islander">
                    Native Hawaiian or Pacific Islander
                  </SelectItem>
                  <SelectItem value="White">White</SelectItem>
                  <SelectItem value="Two or More Races">
                    Two or More Races
                  </SelectItem>
                  <SelectItem value="Prefer not to say">
                    Prefer not to say
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {studentError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {studentError}
              </p>
            )}

            <Button type="submit" disabled={creatingStudent} className="mt-2">
              {creatingStudent ? "Adding..." : "Add Student"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
