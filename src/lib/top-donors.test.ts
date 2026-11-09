import { describe, it, expect, vi } from 'vitest';
import { TOP_DONORS_LIMIT, topDonorsForCampaign } from './top-donors';

/**
 * "Donatur teratas" (PKS Pasal 3.7b): the largest PAID Donations of a Campaign,
 * an anonymous Donor never named (ADR 0023; the same rule as the Donation list).
 */

type Row = {
  amount: number;
  isAnonymous: boolean;
  guestName: string | null;
  donor: { name: string } | null;
  // Fields the query must never ask for; present so a leak would show.
  message?: string;
  guestEmailCiphertext?: string;
  createdAt?: Date;
  id?: string;
};

function dbReturning(rows: Row[]) {
  const findMany = vi.fn(async () => rows);
  return { db: { donation: { findMany } } as never, findMany };
}

describe('topDonorsForCampaign', () => {
  it('lists the donors in the order the database returns them (amount descending), ranked from 1', async () => {
    const { db } = dbReturning([
      { amount: 500_000, isAnonymous: false, guestName: null, donor: { name: 'Siti' } },
      { amount: 200_000, isAnonymous: false, guestName: 'Budi Tamu', donor: null },
    ]);

    expect(await topDonorsForCampaign(db, 'camp-1')).toEqual([
      { rank: 1, donorName: 'Siti', amount: 500_000 },
      { rank: 2, donorName: 'Budi Tamu', amount: 200_000 },
    ]);
  });

  it('never names an anonymous Donor, registered or guest, and carries nothing that identifies one', async () => {
    const { db } = dbReturning([
      {
        amount: 900_000,
        isAnonymous: true,
        guestName: null,
        donor: { name: 'Rahasia Terdaftar' },
        message: 'doa pribadi',
        id: 'don-secret',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      { amount: 800_000, isAnonymous: true, guestName: 'Rahasia Tamu', donor: null, guestEmailCiphertext: 'xyz' },
    ]);

    const result = await topDonorsForCampaign(db, 'camp-1');
    const json = JSON.stringify(result);

    expect(result.map((r) => r.donorName)).toEqual(['Anonim', 'Anonim']);
    for (const leak of ['Rahasia', 'doa pribadi', 'don-secret', 'xyz', '2026-01-01']) {
      expect(json).not.toContain(leak);
    }
    expect(Object.keys(result[0]).sort()).toEqual(['amount', 'donorName', 'rank']);
  });

  it('shows Anonim for a Donor with no name at all', async () => {
    const { db } = dbReturning([{ amount: 1, isAnonymous: false, guestName: null, donor: null }]);
    expect((await topDonorsForCampaign(db, 'c'))[0].donorName).toBe('Anonim');
  });

  it('asks only for confirmed Donations with a PAID, counted (non-sandbox) Payment, largest first, and selects no contact or message field', async () => {
    const { db, findMany } = dbReturning([]);

    await topDonorsForCampaign(db, 'camp-1');

    const args = findMany.mock.calls[0] as unknown as [
      { where: Record<string, unknown>; orderBy: unknown; take: number; select: Record<string, unknown> },
    ];
    const { where, orderBy, take, select } = args[0];
    expect(where).toEqual({
      campaignId: 'camp-1',
      paymentStatus: 'confirmed',
      payments: { some: { status: 'PAID', sandbox: false } },
    });
    expect(orderBy).toEqual([{ amount: 'desc' }, { createdAt: 'asc' }]);
    expect(take).toBe(TOP_DONORS_LIMIT);
    expect(Object.keys(select).sort()).toEqual(['amount', 'donor', 'guestName', 'isAnonymous']);
  });
});
