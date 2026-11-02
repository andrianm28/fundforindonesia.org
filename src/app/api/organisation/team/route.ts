import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listTeam, teamErrorToHttp } from "@/lib/organisation-team";

/**
 * GET /api/organisation/team: the organisation's members and pending
 * invitations (ticket E4). Only the organisation's primary Fundraiser account
 * may read it; a team member, a stranger and an anonymous visitor all get a
 * literal 404. The organisation is always the caller's own, never a parameter.
 */
export async function GET() {
  const session = await getServerSession();
  try {
    return NextResponse.json(await listTeam(prisma, session?.user?.id));
  } catch (error) {
    const refusal = teamErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
}
