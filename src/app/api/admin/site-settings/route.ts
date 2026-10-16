import { NextRequest, NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { hasAssignment } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import { setSiteSetting, siteSettingErrorToHttp } from '@/lib/site-settings';

/**
 * POST /api/admin/site-settings: an Admin replaces one section of the public
 * pages' content (contact, social, footer, hero, pages). Body is
 * `{ key, value }`; `value` is validated against the section's own shape in
 * src/lib/site-settings.ts. Public content only: never a payment or secret
 * setting.
 *
 * ADMIN only, and anyone else -- signed in or not -- gets the same 404 as a
 * route that does not exist (owner's decision, ticket 90), so the setting's
 * existence is not revealed.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user || !hasAssignment(session.user.assignments, Assignment.ADMIN)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const actorId = session.user.id as string;

  const parsed = await req.json().catch(() => undefined);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'Body permintaan harus berupa objek JSON.' }, { status: 400 });
  }

  const { key, value } = parsed as Record<string, unknown>;
  try {
    const setting = await setSiteSetting(prisma, { key, value, actorId });
    return NextResponse.json({ setting }, { status: 200 });
  } catch (error) {
    const refusal = siteSettingErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
}
