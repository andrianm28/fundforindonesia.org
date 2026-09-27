import { NextRequest, NextResponse } from 'next/server';
import { Assignment, AbuseThresholdKind } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import { abuseThresholdErrorToHttp, setAbuseThreshold } from '@/lib/abuse-thresholds';

/**
 * POST /api/admin/abuse-thresholds: an Admin sets one of the four limits the
 * platform watches itself against (prd-compliance 38, PRD §"Anti penyalahgunaan":
 * cumulative Gross for the Verifikasi Tambahan and the audit marker, one
 * Donation for the Admin's marker, and how many Active Campaigns a Fundraiser
 * may run). Body is `{ kind, value }`, where `value` is rupiah for the three
 * money limits and a plain count for ACTIVE_CAMPAIGNS_PER_FUNDRAISER.
 *
 * An insert (src/lib/abuse-thresholds.ts), never an edit: the limit a Donation
 * was judged under stays readable after a later change, and the row carries
 * the Admin and the time.
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

  const { kind, value } = parsed as Record<string, unknown>;
  try {
    const threshold = await setAbuseThreshold(prisma, {
      kind: kind as AbuseThresholdKind,
      value: value as number,
      actorId,
    });
    return NextResponse.json({ threshold }, { status: 201 });
  } catch (error) {
    const refusal = abuseThresholdErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
});
