import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inviteMember, teamErrorToHttp } from "@/lib/organisation-team";

/**
 * POST /api/organisation/team/invitations: the organisation's primary
 * Fundraiser invites an email address to its team (ticket E4). 201 with the
 * invitation, `delivered: false` when the mail could not be sent (the
 * invitation stands; revoke it or invite again). Anyone who is not that
 * account gets a literal 404.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  const parsed = await req.json().catch(() => undefined);
  const body = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  try {
    const invitation = await inviteMember(prisma, session?.user?.id, { email: body?.email });
    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    const refusal = teamErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
}
