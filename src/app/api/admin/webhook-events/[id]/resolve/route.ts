import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { withHiddenAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { refusalResponse } from '@/lib/refusal-response';
import { resolveWebhookEvent } from '@/lib/money/payment-reconciliation';

/**
 * POST /api/admin/webhook-events/[id]/resolve -- an Admin marks a webhook event
 * in the /admin/reconciliation review queue as dealt with ("tandai selesai"),
 * with a required note saying what was done at the provider (PKS pemenuhan 05;
 * before this it was SQL by the owner, docs/runbooks/payment-reconciliation.md).
 *
 *   { note }
 *
 * The actor is the session's. 400 for a blank or over-long note, 409 when the
 * event needs no review or is already closed (including a lost race), 404 when
 * there is no such event. Moves no money and posts nothing.
 */
export const POST = withHiddenAssignmentCheck(
  Assignment.ADMIN,
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const session = await getServerSession();
    const actorId = session!.user!.id as string;
    const body = (await request.json().catch(() => undefined)) as Record<string, unknown> | undefined;

    try {
      await resolveWebhookEvent(prisma, {
        eventId: id,
        actorId,
        note: typeof body?.note === 'string' ? body.note : '',
      });
      return NextResponse.json({ resolved: true });
    } catch (error) {
      const refusal = refusalResponse(error);
      if (refusal) return refusal;
      console.error('Error resolving a webhook event:', error);
      return NextResponse.json({ error: 'Gagal menandai event webhook selesai' }, { status: 500 });
    }
  },
);
