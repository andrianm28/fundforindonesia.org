import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { removeMember, teamErrorToHttp } from "@/lib/organisation-team";

/**
 * DELETE /api/organisation/team/members/[id]: the primary Fundraiser removes a
 * member of its own organisation (ticket E4); their access ends at once. A
 * member id from another organisation, or any other caller: a literal 404.
 */
export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  const { id } = await context.params;
  try {
    await removeMember(prisma, session?.user?.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const refusal = teamErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
}
