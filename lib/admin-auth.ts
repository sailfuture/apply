import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { xano, type XanoAdmin } from "@/lib/xano";

export async function requireAdmin(): Promise<{
  userId: string;
  admin: XanoAdmin;
}> {
  const { userId } = await auth();
  if (!userId) {
    throw new AdminAuthError("Unauthorized", 401);
  }

  const admin = await xano.admins.getByClerkId(userId);
  if (!admin) {
    throw new AdminAuthError("Forbidden — not an admin", 403);
  }

  return { userId, admin };
}

export class AdminAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function handleAdminError(err: unknown) {
  if (err instanceof AdminAuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("Admin API error:", err);
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "Internal error" },
    { status: 500 }
  );
}
