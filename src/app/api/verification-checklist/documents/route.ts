import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { KINDS, type CampaignKind } from '@/lib/campaign-kind';
import { documentChecklistItems } from '@/lib/documents';

/**
 * The documents a Campaign of `?kind=` must carry (PRD §7.1, ticket 64): the
 * active checklist items that need an upload, general ones first by
 * position. Read by the create-Campaign form so it can ask for them. Labels
 * only, which the PRD publishes anyway; signed in, since only a signed-in user
 * can create a Campaign.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const kind = request.nextUrl.searchParams.get('kind');
  if (!kind || !(KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: 'Kind tidak dikenal.' }, { status: 400 });
  }
  const items = await documentChecklistItems(prisma, kind as CampaignKind);
  return NextResponse.json({ items });
}
