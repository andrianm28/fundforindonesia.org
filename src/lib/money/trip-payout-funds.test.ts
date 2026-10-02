import { describe, expect, it } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import { tripHeldBalance } from './trip-payout-funds';

/** A transaction client whose raw query answers `held` with whatever the test hands it. */
function txReturning(held: unknown): Prisma.TransactionClient {
  const client = { $queryRaw: async () => [{ held }] };
  return client as unknown as Prisma.TransactionClient;
}

describe('tripHeldBalance (ticket 49)', () => {
  it('reads bigint, number and string figures', async () => {
    expect(await tripHeldBalance(txReturning(BigInt(250_000)), 't')).toBe(250_000);
    expect(await tripHeldBalance(txReturning(250_000), 't')).toBe(250_000);
    expect(await tripHeldBalance(txReturning('250000'), 't')).toBe(250_000);
  });

  it('reads no rows or a null sum as nothing held', async () => {
    expect(await tripHeldBalance(txReturning(null), 't')).toBe(0);
  });

  it('throws on NaN or a non-finite figure instead of rounding it to 0', async () => {
    await expect(tripHeldBalance(txReturning(Number.NaN), 't')).rejects.toThrow(/non-finite/);
    await expect(tripHeldBalance(txReturning(Number.POSITIVE_INFINITY), 't')).rejects.toThrow(/non-finite/);
    await expect(tripHeldBalance(txReturning('abc'), 't')).rejects.toThrow(/non-finite/);
  });
});
