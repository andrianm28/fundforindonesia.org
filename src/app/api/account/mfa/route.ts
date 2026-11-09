import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";
import { getMfaStatus } from "@/lib/mfa";

/** GET /api/account/mfa: the signed-in person's own second-factor status. */
export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const status = await getMfaStatus(prisma, session.user.id);
  return NextResponse.json({
    state: session.user.mfaState ?? "none",
    enrolled: status.enrolled,
    pending: status.pending,
    backupCodesRemaining: status.backupCodesRemaining,
  });
}
