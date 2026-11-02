import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revokeInvitation, teamErrorToHttp } from "@/lib/organisation-team";

/**
 * DELETE /api/organisation/team/invitations/[id]: the primary Fundraiser
 * revokes a pending invitation of its own organisation (ticket E4). An id from
 * another organisation, a spent one, or any other caller: a literal 404.
 */
export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  const { id } = await context.params;
  try {
    await revokeInvitation(prisma, session?.user?.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const refusal = teamErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
}
