import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Never called. It names the legacy Campaign `status` column on purpose,
 * three ways (a write, a filter and a read), so the guard in
 * src/__tests__/campaign-status-readers.test.ts can prove its detector still
 * sees the column. Ticket 03 drops the column and deletes this file with the
 * guard.
 */
export async function namesTheLegacyStatusColumn(db: PrismaClient) {
  await db.campaign.update({ where: { id: 'canary' }, data: { status: 'active' } });
  const row = await db.campaign.findFirstOrThrow({ where: { status: 'active' } });
  return row.status;
}
