"use client";

import Link from "next/link";
import {
  ChevronDown,
  ClipboardList,
  FileText,
  GraduationCap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Cross-surface stage navigation — one consistent button set for
 * jumping between a family's three admissions surfaces:
 *
 *   Application  → /admin/families/[familyId]
 *   Registration → /admin/registrations/[familyId]
 *   Enrollment   → /admin/enrolled/[studentId]  (per student)
 *
 * Renders a button for every stage EXCEPT the one you're on
 * (`current`), in funnel order. Enrollment is per-student: one
 * student links directly, multiple render a dropdown, none hides
 * the button. Enrollment links carry `from=<current stage>` so the
 * student page's back button returns HERE instead of the enrolled
 * roster.
 */
export type AdmissionStage = "application" | "registration" | "enrollment";

export function StageNav({
  current,
  familyId,
  yearId,
  students = [],
}: {
  current: AdmissionStage;
  familyId: number;
  /** Selected school year — propagated on every link. */
  yearId: number | string | null | undefined;
  /** The year's students, for the per-student Enrollment jump. */
  students?: Array<{ id: number; name: string }>;
}) {
  if (!familyId) return null;
  const year = yearId ? `?yearId=${yearId}` : "";

  return (
    <>
      {current !== "application" ? (
        <Button asChild variant="outline" size="sm" className="bg-white">
          <Link href={`/admin/families/${familyId}${year}`}>
            <FileText className="size-3.5 mr-1.5" />
            Application
          </Link>
        </Button>
      ) : null}
      {current !== "registration" ? (
        <Button asChild variant="outline" size="sm" className="bg-white">
          <Link href={`/admin/registrations/${familyId}${year}`}>
            <ClipboardList className="size-3.5 mr-1.5" />
            Registration
          </Link>
        </Button>
      ) : null}
      {current !== "enrollment" && students.length === 1 ? (
        <Button asChild variant="outline" size="sm" className="bg-white">
          <Link
            href={`/admin/enrolled/${students[0].id}${year}${
              year ? "&" : "?"
            }from=${current}`}
          >
            <GraduationCap className="size-3.5 mr-1.5" />
            Enrollment
          </Link>
        </Button>
      ) : current !== "enrollment" && students.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="bg-white">
              <GraduationCap className="size-3.5 mr-1.5" />
              Enrollment
              <ChevronDown className="size-3.5 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {students.map((s) => (
              <DropdownMenuItem key={s.id} asChild>
                <Link
                  href={`/admin/enrolled/${s.id}${year}${
                    year ? "&" : "?"
                  }from=${current}`}
                >
                  {s.name}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}
