import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const familyId = user.publicMetadata.registration_families_id as
    | number
    | undefined;

  if (!familyId) {
    return NextResponse.json([], { status: 200 });
  }

  const students = await xano.students.getByFamilyId(familyId);
  // Strip large photo data from list response to reduce payload size.
  // Keep only the URL if photo is a Xano file object, otherwise null.
  const trimmed = students.map((s) => {
    let photo: string | { url: string } | null = null;
    if (s.photo && typeof s.photo === "object" && (s.photo as { url?: string }).url) {
      photo = { url: (s.photo as { url: string }).url };
    } else if (typeof s.photo === "string" && s.photo.startsWith("http")) {
      photo = s.photo;
    }
    // Drop base64 photo strings — too large for list responses
    return { ...s, photo };
  });
  return NextResponse.json(trimmed, { status: 200 });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const familyId = user.publicMetadata.registration_families_id as
    | number
    | undefined;

  if (!familyId) {
    return NextResponse.json(
      { error: "You must create a family first" },
      { status: 400 }
    );
  }

  const { first_name, last_name, date_of_birth, gender, ethnicity } =
    await req.json();

  if (!first_name || !last_name) {
    return NextResponse.json(
      { error: "first_name and last_name are required" },
      { status: 400 }
    );
  }

  const student = await xano.students.create({
    first_name,
    last_name,
    date_of_birth: date_of_birth || null,
    gender: gender || "",
    ethnicity: ethnicity || "",
    photo: null,
    registration_families_id: familyId,
    registration_school_years_id: [],
    isArchived: false,
  });

  const family = await xano.families.getById(familyId);
  const existingStudentIds = xano.families.getStudentIds(family);
  await xano.families.update(familyId, {
    registration_students_id: [...existingStudentIds, student.id],
  });

  return NextResponse.json(student, { status: 201 });
}
