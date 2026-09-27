import { NextRequest, NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import { domainErrorToHttp } from '@/lib/domain-errors';
import { recordManualContribution } from '@/lib/money/manual-contributions';

/**
 * POST /api/admin/manual-contributions: one Admin records money that arrived
 * outside the payment gateway (CONTEXT.md, Manual Contribution; PRD FFI-07c).
 *
 *   { campaignId, amount, proofReference, note? }   -- money for a Campaign
 *   { programId,  amount, proofReference, note? }   -- CSR money for a Program
 *
 * `proofReference` is required, not optional: no provider confirms this money,
 * so the evidence is the only thing standing behind the number. The route
 * records and stops -- a second Admin decides, on
 * /api/admin/manual-contributions/[id]/decision -- so nothing here puts money
 * in a balance on one person's word.
 *
 * ADMIN only: the ADMIN assignment alone, not a rank and not "Verifier is
 * senior". Recording money is in the Admin's remit in CONTEXT.md, and
 * deliberately not the Verifier's, who checks documents rather than authorising
 * movements.
 */
export const POST = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest) => {
  const session = await getServerSession();
  const actorId = session!.user.id as string;

  const parsed = await req.json().catch(() => undefined);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'Body permintaan harus berupa objek JSON.' }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;

  // The target is named in the body, never inferred: a contribution that
  // guessed between a Campaign and a Program would be a coin toss on where
  // somebody's money lands. Both fields are passed through as given -- a body
  // naming both, or neither, is a value the service layer can refuse by name
  // rather than something this route quietly resolves.
  try {
    const contribution = await prisma.$transaction((tx) =>
      recordManualContribution(tx, {
        target: { campaignId: body.campaignId as string | undefined, programId: body.programId as string | undefined },
        amount: body.amount as number,
        proofReference: body.proofReference as string,
        note: body.note as string | undefined,
        recordedById: actorId,
      }),
    );
    return NextResponse.json({ contribution }, { status: 201 });
  } catch (error) {
    const refusal = domainErrorToHttp(error);
    if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
    throw error;
  }
});
