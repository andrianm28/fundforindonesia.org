import type { Prisma } from '@/generated/prisma/client';

/**
 * Records that a Verifier checked a Fundraiser's identity, on the first
 * approved submission of either kind, a Campaign or a Volunteer Trip
 * (CONTEXT.md, Fundraiser). One row per Fundraiser: the unique userId keeps
 * the first, and `skipDuplicates` makes a later approval, or a second
 * approval racing this one under a different row lock, a no-op rather than
 * an error. Returns whether this call created the row.
 */
export async function recordIdentityVerification(
  tx: Prisma.TransactionClient,
  params: { userId: string; verifierId: string; verifiedAt: Date; note?: string | null },
): Promise<boolean> {
  const created = await tx.identityVerification.createMany({
    data: [
      {
        userId: params.userId,
        verifierId: params.verifierId,
        verifiedAt: params.verifiedAt,
        note: params.note ?? null,
      },
    ],
    skipDuplicates: true,
  });
  return created.count > 0;
}
