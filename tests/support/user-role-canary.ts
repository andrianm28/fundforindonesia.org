import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Never called. It names the retired User columns `role`, `isVerified` and
 * `verificationType` on purpose (a write, a filter and a read), so the guard
 * in src/__tests__/user-role-readers.test.ts can prove its detector still
 * sees them. Ticket 03 of retire-role-hierarchy drops the columns and
 * deletes this file with the guard.
 */
export async function namesTheRetiredUserColumns(db: PrismaClient) {
  await db.user.update({ where: { id: 'canary' }, data: { role: 'DONOR' } });
  const row = await db.user.findFirstOrThrow({ where: { isVerified: true } });
  return row.verificationType;
}
