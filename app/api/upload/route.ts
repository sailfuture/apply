import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const uploadUrl = process.env.XANO_UPLOAD_URL;
  if (!uploadUrl) {
    return NextResponse.json(
      { error: "XANO_UPLOAD_URL not configured" },
      { status: 500 }
    );
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const filename =
    file instanceof File ? file.name : "upload";

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const blob = new Blob([buffer], { type: file.type || "application/octet-stream" });

  const xanoForm = new FormData();
  xanoForm.append("content", blob, filename);

  const res = await fetch(uploadUrl, {
    method: "POST",
    body: xanoForm,
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `Xano upload failed (${res.status}): ${text}` },
      { status: res.status }
    );
  }

  const metadata = await res.json();
  return NextResponse.json(metadata);
}
