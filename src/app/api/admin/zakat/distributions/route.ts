import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { resolveOperations } from '@/lib/operations';
import { zakatAdminRoute } from '@/lib/zakat-route';
import {
  listZakatDistributions,
  recordZakatDistribution,
  zakatDistributionErrorToHttp,
  zakatPosition,
} from '@/lib/zakat-distributions';

/**
 * Zakat distribution records (PKS pemenuhan 19, ADR 0028; rules in
 * src/lib/zakat-distributions.ts).
 *
 * GET   what the configured institution received, distributed and has left,
 *       and the records, newest first.
 * POST  an Admin records a distribution; body `{ amount, asnaf, distributedAt:
 *       'YYYY-MM-DD', recipientSummary, note? }`.
 *
 * A RECORD ONLY: nothing here posts to the ledger or creates a Payout.
 * Admin-only, and a 404 for everyone while the zakat module is off.
 */
export const GET = zakatAdminRoute(async () => {
  const { zakat } = await resolveOperations(prisma);
  if (zakat.recipientOrganisationId === null) {
    return NextResponse.json({ position: { received: 0, distributed: 0, remaining: 0 }, distributions: [] });
  }
  const [position, distributions] = await Promise.all([
    zakatPosition(prisma, zakat.recipientOrganisationId),
    listZakatDistributions(prisma, zakat.recipientOrganisationId),
  ]);
  return NextResponse.json({ position, distributions });
});

export const POST = zakatAdminRoute(async (req: NextRequest) => {
  const session = await getServerSession();
  const input = await req.json().catch(() => undefined);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return NextResponse.json({ error: 'Body permintaan harus berupa objek JSON.' }, { status: 400 });
  }
  try {
    const created = await recordZakatDistribution(prisma, { actorId: session!.user.id as string, input });
    return NextResponse.json({ distribution: created }, { status: 201 });
  } catch (error) {
    const refusal = zakatDistributionErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
});
