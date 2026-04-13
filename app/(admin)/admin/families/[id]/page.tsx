"use client";

import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  StatusBadge,
  type ApplicationStatus,
} from "@/components/admin/status-badge";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Parent {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_line_1: string;
  city: string;
  state: string;
  zip: string;
  relationship: string;
}

interface Student {
  id: number;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  grade: string;
  school: string;
}

interface ApplicationRecord {
  id: number;
  student_name: string;
  status: ApplicationStatus;
  submitted_at: string | null;
  financial_aid: boolean;
  sufs_type: string;
}

interface FamilyDetail {
  id: number;
  name: string;
  parents: Parent[];
  students: Student[];
  applications: ApplicationRecord[];
}

export default function FamilyDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const yearId = searchParams.get("yearId");
  const familyId = params.id;

  const { data, isLoading } = useSWR<FamilyDetail>(
    familyId ? `/api/admin/families/${familyId}` : null,
    fetcher
  );

  const backHref = yearId
    ? `/admin/applications?yearId=${yearId}`
    : "/admin/applications";

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-[200px]" />
          <Skeleton className="h-[200px]" />
        </div>
        <Skeleton className="h-[300px]" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-muted-foreground">Family not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={backHref}>
            <ArrowLeft className="mr-1 size-4" />
            Back
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">{data.name}</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parents / Guardians</CardTitle>
          </CardHeader>
          <CardContent>
            {data.parents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No parents on file.
              </p>
            ) : (
              <div className="space-y-4">
                {data.parents.map((parent) => (
                  <div key={parent.id} className="rounded-md border p-3">
                    <p className="text-sm font-medium">
                      {parent.first_name} {parent.last_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {parent.relationship}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Email: {parent.email}</span>
                      <span>Phone: {parent.phone}</span>
                      {parent.address_line_1 && (
                        <span className="col-span-2">
                          {parent.address_line_1}, {parent.city}, {parent.state}{" "}
                          {parent.zip}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Students</CardTitle>
          </CardHeader>
          <CardContent>
            {data.students.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No students on file.
              </p>
            ) : (
              <div className="space-y-4">
                {data.students.map((student) => (
                  <div key={student.id} className="rounded-md border p-3">
                    <p className="text-sm font-medium">
                      {student.first_name} {student.last_name}
                    </p>
                    <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Grade: {student.grade || "—"}</span>
                      <span>
                        DOB:{" "}
                        {student.date_of_birth
                          ? new Date(student.date_of_birth).toLocaleDateString()
                          : "—"}
                      </span>
                      <span className="col-span-2">
                        School: {student.school || "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Applications</CardTitle>
        </CardHeader>
        <CardContent>
          {data.applications.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No applications found.
            </p>
          ) : (
            <div className="space-y-3">
              {data.applications.map((app) => (
                <div
                  key={app.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{app.student_name}</p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        Submitted:{" "}
                        {app.submitted_at
                          ? new Date(app.submitted_at).toLocaleDateString()
                          : "Not submitted"}
                      </span>
                      <span>
                        Financial Aid: {app.financial_aid ? "Yes" : "No"}
                      </span>
                      {app.sufs_type && <span>SUFS: {app.sufs_type}</span>}
                    </div>
                  </div>
                  <StatusBadge status={app.status} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
