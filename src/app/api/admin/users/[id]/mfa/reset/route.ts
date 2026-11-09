import { NextRequest, NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { getServerSession } from "@/lib/auth";
import { resetMfa } from "@/lib/mfa";
import { prisma } from "@/lib/prisma";
import { withHiddenAssignmentCheck } from "@/lib/withAssignmentCheck";

/**
 * POST /api/admin/users/[id]/mfa/reset { reason? } (pks-pemenuhan/03): another
 * Admin removes a person's second factor, e.g. a lost phone, so they enrol
 * again. Recorded in MfaAuditEntry with who acted. Never one's own factor, and
 * only reachable with a satisfied session, since the guard reads the effective
 * assignments, which are empty until the Admin has passed their own factor.
 */
export const POST = withHiddenAssignmentCheck(Assignment.ADMIN, async (req: NextRequest, context?: { params: Promise<{ id: string }> }) => {
  const { id } = await context!.params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason : undefined;

  const session = await getServerSession();
  const result = await resetMfa(prisma, { userId: id, actedById: session!.user.id, reason });
  if (result.ok) return NextResponse.json({ userId: id, action: "RESET" });
  if (result.reason === "self") {
    return NextResponse.json({ error: "Anda tidak dapat mereset faktor kedua Anda sendiri." }, { status: 400 });
  }
  return NextResponse.json({ error: "Pengguna ini tidak memiliki faktor kedua." }, { status: 409 });
});
