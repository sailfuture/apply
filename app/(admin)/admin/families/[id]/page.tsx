"use client";

import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/admin/status-badge";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Parent {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  relationship: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  zipcode: string;
}

interface Student {
  id: number;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  ethnicity: string;
  isAccepted: boolean;
}

interface FamilyResponse {
  id: number;
  family_name: string;
  registration_parents_id: Parent[];
  registration_students_id: Student[];
  registration_emergency_contacts_id: number[];
  isAccepted: boolean;
  isSubmitted: boolean;
}

interface Application {
  id: number;
  registration_students_id: number;
  registration_families_id: number;
  isSubmitted: boolean;
  isOffered: boolean;
  isAccepted: boolean;
  current_previous_school: string;
  current_grade: string;
  sufs_type: string;
}

export default function FamilyDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const familyId = params.id;

  const { data: family, isLoading } = useSWR<FamilyResponse>(
    familyId ? `/api/admin/families/${familyId}` : null,
    fetcher
  );

  const { data: applications } = useSWR<Application[]>(
    yearId ? `/api/admin/applications?yearId=${yearId}` : null,
    fetcher
  );

  const backHref = yearId
    ? `/admin/applications?yearId=${yearId}`
    : "/admin/applications";

  if (isLoading || !family) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  const parents = family.registration_parents_id ?? [];
  const students = family.registration_students_id ?? [];
  const familyApps = (applications ?? []).filter(
    (a) => Number(a.registration_families_id) === family.id
  );

  function getAppStatus(app: Application) {
    if (app.isAccepted) return "accepted" as const;
    if (app.isOffered) return "offered" as const;
    if (app.isSubmitted) return "submitted" as const;
    return "draft" as const;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link href={backHref}>
          <Button variant="outline" size="icon" className="size-8">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">{family.family_name || `Family #${family.id}`}</h1>
          <div className="flex items-center gap-2 mt-1">
            {family.isSubmitted && <StatusBadge status="submitted" />}
            {family.isAccepted && <StatusBadge status="accepted" />}
          </div>
        </div>
      </div>

      {/* Parents / Guardians */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parents / Guardians</CardTitle>
        </CardHeader>
        <CardContent>
          {parents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No parents on file.</p>
          ) : (
            <div className="space-y-3">
              {parents.map((parent) => (
                <div key={parent.id} className="rounded-md border p-3">
                  <p className="text-sm font-medium">
                    {parent.first_name} {parent.last_name}
                    {parent.relationship && (
                      <span className="ml-2 text-xs text-muted-foreground">({parent.relationship})</span>
                    )}
                  </p>
                  <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
                    {parent.email && <p>{parent.email}</p>}
                    {parent.phone && <p>{parent.phone}</p>}
                    {parent.address_line_1 && (
                      <p>
                        {parent.address_line_1}
                        {parent.address_line_2 && `, ${parent.address_line_2}`}
                        {parent.city && `, ${parent.city}`}
                        {parent.state && ` ${parent.state}`}
                        {parent.zipcode && ` ${parent.zipcode}`}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Students */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Students</CardTitle>
        </CardHeader>
        <CardContent>
          {students.length === 0 ? (
            <p className="text-sm text-muted-foreground">No students on file.</p>
          ) : (
            <div className="space-y-3">
              {students.map((student) => (
                <div key={student.id} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">
                      {student.first_name} {student.last_name}
                    </p>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {student.date_of_birth && <span>DOB: {new Date(student.date_of_birth).toLocaleDateString()} &middot; </span>}
                      {student.gender && <span>{student.gender} &middot; </span>}
                      {student.ethnicity && <span>{student.ethnicity}</span>}
                    </div>
                  </div>
                  {student.isAccepted && <StatusBadge status="accepted" />}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Applications */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Applications</CardTitle>
        </CardHeader>
        <CardContent>
          {familyApps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applications for the selected year.</p>
          ) : (
            <div className="space-y-3">
              {familyApps.map((app) => {
                const student = students.find((s) => s.id === app.registration_students_id);
                return (
                  <div key={app.id} className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium">
                        {student ? `${student.first_name} ${student.last_name}` : `Student #${app.registration_students_id}`}
                      </p>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {app.current_previous_school && <span>{app.current_previous_school} &middot; </span>}
                        {app.current_grade && <span>Grade: {app.current_grade} &middot; </span>}
                        {app.sufs_type && <span>SUFS: {app.sufs_type}</span>}
                      </div>
                    </div>
                    <StatusBadge status={getAppStatus(app)} />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
