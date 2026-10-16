import { NextRequest, NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import { setSiteSetting, siteSettingErrorToHttp } from '@/lib/site-settings';

/**
 * POST /api/admin/site-settings: an Admin replaces one section of the public
 * pages' content (contact, social, footer, hero, pages). Body is
 * `{ key, value }`; `value` is validated against the section's own shape in
 * src/lib/site-settings.ts. Public content only: never a payment or secret
 * setting.
 *
 * ADMIN only.
 */
export const POST = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest) => {
  const session = await getServerSession();
  const actorId = session!.user.id as string;

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
});
