import { NextRequest, NextResponse } from 'next/server';
import { Assignment } from '@/generated/prisma/client';
import { getServerSession } from '@/lib/auth';
import { withAssignmentCheck } from '@/lib/withAssignmentCheck';
import { prisma } from '@/lib/prisma';
import { domainErrorToHttp } from '@/lib/domain-errors';
import { recordProviderWithdrawal } from '@/lib/money/provider-withdrawals';

/**
 * POST /api/admin/provider-withdrawals: one Admin records money moving from a
 * Payment Provider's Merchant Account to a Collection Account
 * (prd-compliance 35; PRD FFI-07; ADR 0011).
 *
 *   { provider, reference, amount, destinationName, collectingEntityId?,
 *     providerBalanceBefore, providerBalanceAfter, proofReference }
 *
 * The two balance readings are the point of the endpoint, not an extra field on
 * it. No provider this platform talks to exposes a balance API (ADR 0006), so
 * the Admin opens the dashboard and writes down what it says either side of the
 * movement -- and that pair is what tomorrow's reconciliation compares against
 * the ledger. Required rather than optional because an unread pot is the exact
 * condition this ticket exists to stop being invisible: "the Admin did not look"
 * is not a number, and storing nothing would make the sweep look identical to a
 * sweep nobody verified.
 *
 * They are NOT required to differ by `amount`, and the route does not reconcile
 * them. A provider that charges a fee on the transfer really does move by more,
 * and an honest record of that is worth more than a tidy one; the gap is
 * reported by GET /api/admin/reconcile and nothing here corrects it.
 *
 * ADMIN only, on the assignment alone. Unlike a Payout there is no two-person
 * rule: the money goes to a bank account of a named entity rather than to a
 * person, so there is nobody for a second pair of hands to protect it from. That
 * is a judgement, not a default -- see the ticket's Comments.
 */
export const POST = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest) => {
  const session = await getServerSession();
  // From the session, never from the body: a sweep of the platform's own money
  // that named its own author would be a record nobody can audit.
  const recordedById = session!.user.id as string;

  const parsed = await req.json().catch(() => undefined);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'Body permintaan harus berupa objek JSON.' }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;

  try {
    const withdrawal = await recordProviderWithdrawal(prisma, {
      provider: body.provider as string,
      reference: body.reference as string,
      amount: body.amount as number,
      destinationName: body.destinationName as string,
      collectingEntityId: body.collectingEntityId as string | undefined,
      providerBalanceBefore: body.providerBalanceBefore as number,
      providerBalanceAfter: body.providerBalanceAfter as number,
      proofReference: body.proofReference as string,
      recordedById,
    });
    return NextResponse.json({ withdrawal }, { status: 201 });
  } catch (error) {
    const refusal = domainErrorToHttp(error);
    if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
    throw error;
  }
});
