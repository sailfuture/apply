import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { xano } from "@/lib/xano";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const studentId = Number(id);
  if (isNaN(studentId)) {
    return NextResponse.json({ error: "Invalid student ID" }, { status: 400 });
  }

  const body = await req.json();

  try {
    // Bump `last_edited_time` on every write — parent edits land
    // here from the apply-flow students page and the registration
    // packet, and the enrolled detail page's last-edited captions
    // need to reflect those changes. Mirrors the admin students
    // route's same bump.
    const patch = { ...body, last_edited_time: Date.now() };
    const updated = await xano.students.update(studentId, patch);
    return NextResponse.json(updated);
  } catch (err) {
    console.error("Failed to update student:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 }
    );
  }
}
