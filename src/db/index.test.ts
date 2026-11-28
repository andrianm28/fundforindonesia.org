import { describe, expect, it } from 'vitest';

/**
 * Without a real DATABASE_URL (`next build` uses a dummy one; unit tests have
 * none) `db` is the build-time stand-in, the twin of src/lib/prisma.ts's mock:
 * queries resolve to no rows and nothing tries to connect.
 */
describe('db without a database', () => {
  it('resolves a select chain to no rows', async () => {
    const { db, schema } = await import('./index');
    await expect(db.select().from(schema.campaign).where(undefined).limit(5)).resolves.toEqual([]);
  });

  it('finds nothing with the relational findFirst', async () => {
    const { db } = await import('./index');
    await expect(db.query.campaign.findFirst()).resolves.toBeUndefined();
  });

  it('runs a transaction callback against the same stand-in', async () => {
    const { db, schema } = await import('./index');
    const result = await db.transaction(async (tx) => tx.select().from(schema.category));
    expect(result).toEqual([]);
  });
});
