import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { acceptInvitation, teamErrorToHttp } from "@/lib/organisation-team";

/**
 * POST /api/organisation/team/accept: a signed-in person spends an
 * invitation link (ticket E4). 401 when not signed in (they must sign in
 * first, and the link stays good). A link that is unknown, spent, revoked,
 * expired or issued for another address is the same literal 404; the invited
 * address must be verified on the account (403 otherwise).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await req.json().catch(() => undefined);
  const body = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  try {
    const membership = await acceptInvitation(prisma, session.user.id, body?.token);
    return NextResponse.json({ membership });
  } catch (error) {
    const refusal = teamErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
}
