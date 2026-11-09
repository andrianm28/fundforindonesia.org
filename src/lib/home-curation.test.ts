import { describe, it, expect } from 'vitest';
import { setCampaignFeatures, setPrayerHighlights, type HomeCurationDb } from './home-curation';

/**
 * Admin curation of the home page (PKS pemenuhan 15): the Admin sends the
 * whole ordered list for one slot, and the list is what is stored, with who
 * and when for each mark.
 */
type FeatureRow = { campaignId: string; kind: string; position: number; markedById: string; markedAt: Date };
type HighlightRow = { prayerId: string; position: number; markedById: string; markedAt: Date };

function fakeDb(opts: { campaigns: string[]; prayers: Array<{ id: string; deletedAt?: Date | null }> }) {
  const features: FeatureRow[] = [];
  const highlights: HighlightRow[] = [];
  const db = {
    campaign: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        opts.campaigns.filter((id) => where.id.in.includes(id)).map((id) => ({ id })),
    },
    prayer: {
      findMany: async ({ where }: { where: { id: { in: string[] }; deletedAt: null } }) =>
        opts.prayers.filter((p) => where.id.in.includes(p.id) && !p.deletedAt).map((p) => ({ id: p.id })),
    },
    campaignFeature: {
      deleteMany: async ({ where }: { where: { kind: string; campaignId: { notIn: string[] } } }) => {
        for (let i = features.length - 1; i >= 0; i--) {
          if (features[i].kind === where.kind && !where.campaignId.notIn.includes(features[i].campaignId)) features.splice(i, 1);
        }
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { campaignId_kind: { campaignId: string; kind: string } };
        create: FeatureRow;
        update: { position: number };
      }) => {
        const key = where.campaignId_kind;
        const row = features.find((f) => f.campaignId === key.campaignId && f.kind === key.kind);
        if (row) row.position = update.position;
        else features.push({ ...create });
      },
    },
    prayerHighlight: {
      deleteMany: async ({ where }: { where: { prayerId: { notIn: string[] } } }) => {
        for (let i = highlights.length - 1; i >= 0; i--) {
          if (!where.prayerId.notIn.includes(highlights[i].prayerId)) highlights.splice(i, 1);
        }
      },
      upsert: async ({ where, create, update }: { where: { prayerId: string }; create: HighlightRow; update: { position: number } }) => {
        const row = highlights.find((h) => h.prayerId === where.prayerId);
        if (row) row.position = update.position;
        else highlights.push({ ...create });
      },
    },
  } as unknown as HomeCurationDb;
  return { db, features, highlights };
}

const T1 = new Date('2026-11-09T01:00:00Z');
const T2 = new Date('2026-11-09T02:00:00Z');

describe('setCampaignFeatures', () => {
  it('stores the list in the order given, with who and when', async () => {
    const { db, features } = fakeDb({ campaigns: ['a', 'b', 'c'], prayers: [] });
    const outcome = await setCampaignFeatures(db, { kind: 'PILIHAN', campaignIds: ['c', 'a'], actorId: 'admin-1', now: T1 });

    expect(outcome).toBe('OK');
    expect(features.sort((x, y) => x.position - y.position)).toEqual([
      { campaignId: 'c', kind: 'PILIHAN', position: 0, markedById: 'admin-1', markedAt: T1 },
      { campaignId: 'a', kind: 'PILIHAN', position: 1, markedById: 'admin-1', markedAt: T1 },
    ]);
  });

  it('keeps who and when for a Campaign that stays marked, and records the new one', async () => {
    const { db, features } = fakeDb({ campaigns: ['a', 'b'], prayers: [] });
    await setCampaignFeatures(db, { kind: 'PILIHAN', campaignIds: ['a'], actorId: 'admin-1', now: T1 });
    await setCampaignFeatures(db, { kind: 'PILIHAN', campaignIds: ['b', 'a'], actorId: 'admin-2', now: T2 });

    const byId = Object.fromEntries(features.map((f) => [f.campaignId, f]));
    expect(byId.a).toMatchObject({ position: 1, markedById: 'admin-1', markedAt: T1 });
    expect(byId.b).toMatchObject({ position: 0, markedById: 'admin-2', markedAt: T2 });
  });

  it('removes a mark that is no longer in the list, and leaves the other slot alone', async () => {
    const { db, features } = fakeDb({ campaigns: ['a', 'b'], prayers: [] });
    await setCampaignFeatures(db, { kind: 'PILIHAN', campaignIds: ['a', 'b'], actorId: 'admin-1', now: T1 });
    await setCampaignFeatures(db, { kind: 'UNGGULAN_KATEGORI', campaignIds: ['a'], actorId: 'admin-1', now: T1 });
    await setCampaignFeatures(db, { kind: 'PILIHAN', campaignIds: ['b'], actorId: 'admin-1', now: T2 });

    expect(features.map((f) => `${f.kind}:${f.campaignId}`).sort()).toEqual(['PILIHAN:b', 'UNGGULAN_KATEGORI:a']);
  });

  it('an empty list clears the slot', async () => {
    const { db, features } = fakeDb({ campaigns: ['a'], prayers: [] });
    await setCampaignFeatures(db, { kind: 'PILIHAN', campaignIds: ['a'], actorId: 'admin-1', now: T1 });
    await setCampaignFeatures(db, { kind: 'PILIHAN', campaignIds: [], actorId: 'admin-1', now: T2 });
    expect(features).toEqual([]);
  });

  it('refuses a Campaign that does not exist, and changes nothing', async () => {
    const { db, features } = fakeDb({ campaigns: ['a'], prayers: [] });
    const outcome = await setCampaignFeatures(db, { kind: 'PILIHAN', campaignIds: ['a', 'ghost'], actorId: 'admin-1', now: T1 });
    expect(outcome).toBe('UNKNOWN_ID');
    expect(features).toEqual([]);
  });

  it('counts a repeated id once', async () => {
    const { db, features } = fakeDb({ campaigns: ['a', 'b'], prayers: [] });
    await setCampaignFeatures(db, { kind: 'PILIHAN', campaignIds: ['a', 'b', 'a'], actorId: 'admin-1', now: T1 });
    expect(features.map((f) => [f.campaignId, f.position]).sort()).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });
});

describe('setPrayerHighlights', () => {
  it('stores the ordered list with who and when, and refuses a deleted Prayer', async () => {
    const { db, highlights } = fakeDb({ campaigns: [], prayers: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3', deletedAt: T1 }] });

    expect(await setPrayerHighlights(db, { prayerIds: ['p2', 'p3'], actorId: 'admin-1', now: T1 })).toBe('UNKNOWN_ID');
    expect(highlights).toEqual([]);

    expect(await setPrayerHighlights(db, { prayerIds: ['p2', 'p1'], actorId: 'admin-1', now: T1 })).toBe('OK');
    expect(highlights.sort((x, y) => x.position - y.position)).toEqual([
      { prayerId: 'p2', position: 0, markedById: 'admin-1', markedAt: T1 },
      { prayerId: 'p1', position: 1, markedById: 'admin-1', markedAt: T1 },
    ]);
  });
});
