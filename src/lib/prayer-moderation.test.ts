import { describe, it, expect } from 'vitest';
import { moderatePrayer, publicPrayerWhere } from './prayer-moderation';

/**
 * Prayer moderation (PKS Pasal 3.7c): hide, show again, soft delete, each
 * recording who and when. Run against a tiny in-memory Prayer table that
 * implements just the two calls the module makes.
 */

type Row = {
  id: string;
  hidden: boolean;
  hiddenAt: Date | null;
  hiddenById: string | null;
  deletedAt: Date | null;
  deletedById: string | null;
};

const blank = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  hidden: false,
  hiddenAt: null,
  hiddenById: null,
  deletedAt: null,
  deletedById: null,
  ...over,
});

function fakeDb(rows: Row[]) {
  const matches = (r: Row, where: Partial<Row>) =>
    Object.entries(where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v);
  const db = {
    prayer: {
      findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
      updateMany: async ({ where, data }: { where: Partial<Row>; data: Partial<Row> }) => {
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
  };
  return { db: db as never, rows };
}

const NOW = new Date('2026-11-11T03:00:00Z');
const LATER = new Date('2026-11-12T03:00:00Z');

describe('publicPrayerWhere', () => {
  it('leaves out hidden and deleted Prayers', () => {
    expect(publicPrayerWhere()).toEqual({ hidden: false, deletedAt: null });
  });
});

describe('moderatePrayer', () => {
  it('hides a Prayer, recording who and when', async () => {
    const { db, rows } = fakeDb([blank('p1')]);
    expect(await moderatePrayer(db, { prayerId: 'p1', action: 'hide', actorId: 'mod-1', now: NOW })).toBe('OK');
    expect(rows[0]).toMatchObject({ hidden: true, hiddenAt: NOW, hiddenById: 'mod-1', deletedAt: null });
  });

  it('hiding again changes nothing: the first moderator and time stay on record', async () => {
    const { db, rows } = fakeDb([blank('p1')]);
    await moderatePrayer(db, { prayerId: 'p1', action: 'hide', actorId: 'mod-1', now: NOW });
    expect(await moderatePrayer(db, { prayerId: 'p1', action: 'hide', actorId: 'mod-2', now: LATER })).toBe('OK');
    expect(rows[0]).toMatchObject({ hiddenAt: NOW, hiddenById: 'mod-1' });
  });

  it('shows a hidden Prayer again and clears the hide record', async () => {
    const { db, rows } = fakeDb([blank('p1', { hidden: true, hiddenAt: NOW, hiddenById: 'mod-1' })]);
    expect(await moderatePrayer(db, { prayerId: 'p1', action: 'show', actorId: 'mod-2', now: LATER })).toBe('OK');
    expect(rows[0]).toMatchObject({ hidden: false, hiddenAt: null, hiddenById: null });
  });

  it('soft-deletes a Prayer, recording who and when, and keeps the row', async () => {
    const { db, rows } = fakeDb([blank('p1')]);
    expect(await moderatePrayer(db, { prayerId: 'p1', action: 'delete', actorId: 'mod-1', now: NOW })).toBe('OK');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ deletedAt: NOW, deletedById: 'mod-1' });
  });

  it('refuses to hide, show or delete a deleted Prayer (GONE) and leaves its record alone', async () => {
    for (const action of ['hide', 'show', 'delete'] as const) {
      const { db, rows } = fakeDb([blank('p1', { deletedAt: NOW, deletedById: 'mod-1' })]);
      expect(await moderatePrayer(db, { prayerId: 'p1', action, actorId: 'mod-2', now: LATER })).toBe('GONE');
      expect(rows[0]).toMatchObject({ hidden: false, deletedAt: NOW, deletedById: 'mod-1' });
    }
  });

  it('answers NOT_FOUND for a Prayer that does not exist', async () => {
    const { db } = fakeDb([]);
    expect(await moderatePrayer(db, { prayerId: 'nope', action: 'hide', actorId: 'm', now: NOW })).toBe('NOT_FOUND');
  });

  it('showing a Prayer that is not hidden is a no-op success', async () => {
    const { db, rows } = fakeDb([blank('p1')]);
    expect(await moderatePrayer(db, { prayerId: 'p1', action: 'show', actorId: 'm', now: NOW })).toBe('OK');
    expect(rows[0].hidden).toBe(false);
  });
});
