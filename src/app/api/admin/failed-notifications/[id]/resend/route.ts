import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { withHiddenAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { refusalResponse } from '@/lib/refusal-response';
import { resendFailedNotification } from '@/lib/failed-notifications';

/**
 * POST /api/admin/failed-notifications/[id]/resend -- an Admin sends one queued
 * email again now (PKS Pasal 8(2)), whether it is still being retried or has
 * gone DEAD. No body: the actor is the session's. 200 {outcome: "SENT"} when the
 * provider accepted it, 200 {outcome: "FAILED"} when it refused again (the row
 * keeps the new error and, past the limit, stays DEAD), 409 when it is already
 * sent or another runner holds it right now, 404 when there is no such row.
 */
export const POST = withHiddenAssignmentCheck(
  Assignment.ADMIN,
  async (_request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const session = await getServerSession();
    const actorId = session!.user!.id as string;

    try {
      const outcome = await resendFailedNotification(id, actorId);
      return NextResponse.json({ outcome });
    } catch (error) {
      const refusal = refusalResponse(error);
      if (refusal) return refusal;
      console.error('Error resending a failed notification:', error);
      return NextResponse.json({ error: 'Gagal mengirim ulang notifikasi' }, { status: 500 });
    }
  },
);
