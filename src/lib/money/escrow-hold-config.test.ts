import { describe, it, expect, vi } from 'vitest';
import {
  resolveEscrowHoldDays,
  setEscrowHoldSetting,
  InvalidEscrowHoldError,
  MIN_ESCROW_HOLD_DAYS,
  MAX_ESCROW_HOLD_DAYS,
} from './escrow-hold-config';
import { ESCROW_HOLD_DAYS } from './escrow';

/**
 * Escrow Hold resolution (Category override, then Admin default, then the
 * 7-day fallback) and the append-only writes (ticket 90). In-memory stand-in
 * for the one table the module touches, in the style of platform-fee-config.test.ts.
 */

type Row = {
  id: string;
  scope: 'DEFAULT' | 'CATEGORY';
  category: string | null;
  days: number;
  setById: string;
  setAt: Date;
};

function makeDb(seed: Row[] = []) {
  const rows = [...seed];
  let nextId = 1;
  return {
    rows,
    escrowHoldSetting: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const matches = rows.filter((r) =>
          Object.entries(where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v),
        );
        return matches.sort((a, b) => b.setAt.getTime() - a.setAt.getTime())[0] ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Omit<Row, 'id' | 'setAt'> }) => {
        const row: Row = { id: `s-${nextId++}`, setAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
    },
  };
}

const row = (over: Partial<Row>): Row => ({
  id: 'r',
  scope: 'DEFAULT',
  category: null,
  days: 7,
  setById: 'admin-1',
  setAt: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

describe('resolveEscrowHoldDays', () => {
  it('falls back to the 7-day constant when no Admin has set anything', async () => {
    expect(await resolveEscrowHoldDays(makeDb() as never, { category: 'bencana' })).toBe(ESCROW_HOLD_DAYS);
    expect(ESCROW_HOLD_DAYS).toBe(7);
  });

  it('uses the Admin default over the fallback', async () => {
    const db = makeDb([row({ days: 10 })]);
    expect(await resolveEscrowHoldDays(db as never, { category: 'kesehatan' })).toBe(10);
  });

  it('prefers the Category override over the default', async () => {
    const db = makeDb([row({ days: 10 }), row({ id: 'c', scope: 'CATEGORY', category: 'bencana', days: 3 })]);
    expect(await resolveEscrowHoldDays(db as never, { category: 'bencana' })).toBe(3);
    expect(await resolveEscrowHoldDays(db as never, { category: 'kesehatan' })).toBe(10);
  });

  it('reads the latest row for a key, since rows are append-only', async () => {
    const db = makeDb([
      row({ id: 'old', days: 14, setAt: new Date('2026-10-01T00:00:00Z') }),
      row({ id: 'new', days: 5, setAt: new Date('2026-10-05T00:00:00Z') }),
    ]);
    expect(await resolveEscrowHoldDays(db as never)).toBe(5);
  });

  it('finds a Category override even when the campaign category carries stray whitespace', async () => {
    const db = makeDb([row({ id: 'c', scope: 'CATEGORY', category: 'bencana', days: 3 })]);
    expect(await resolveEscrowHoldDays(db as never, { category: ' bencana ' })).toBe(3);
  });

  it('ignores Category rows when no category is given (Trip Fee)', async () => {
    const db = makeDb([row({ id: 'c', scope: 'CATEGORY', category: 'bencana', days: 3 })]);
    expect(await resolveEscrowHoldDays(db as never)).toBe(ESCROW_HOLD_DAYS);
  });
});

describe('setEscrowHoldSetting', () => {
  it('inserts a DEFAULT row with the actor, and never touches an earlier row', async () => {
    const db = makeDb([row({ days: 7 })]);
    await setEscrowHoldSetting(db as never, { scope: 'DEFAULT', days: 10, actorId: 'admin-2' });

    expect(db.rows).toHaveLength(2);
    expect(db.rows[0].days).toBe(7);
    expect(db.rows[1]).toMatchObject({ scope: 'DEFAULT', category: null, days: 10, setById: 'admin-2' });
    expect(db.escrowHoldSetting).not.toHaveProperty('update');
  });

  it('inserts a CATEGORY row with a trimmed category', async () => {
    const db = makeDb();
    await setEscrowHoldSetting(db as never, { scope: 'CATEGORY', category: ' bencana ', days: 2, actorId: 'a' });
    expect(db.rows[0]).toMatchObject({ scope: 'CATEGORY', category: 'bencana', days: 2 });
  });

  it('drops a stray category on a DEFAULT row', async () => {
    const db = makeDb();
    await setEscrowHoldSetting(db as never, { scope: 'DEFAULT', category: 'bencana', days: 4, actorId: 'a' });
    expect(db.rows[0].category).toBeNull();
  });

  it.each([0, -1, 0.5, 1.5, MAX_ESCROW_HOLD_DAYS + 1, NaN, '7', null, undefined])(
    'refuses %s days with a domain error and writes nothing',
    async (days) => {
      const db = makeDb();
      await expect(
        setEscrowHoldSetting(db as never, { scope: 'DEFAULT', days: days as never, actorId: 'a' }),
      ).rejects.toBeInstanceOf(InvalidEscrowHoldError);
      expect(db.escrowHoldSetting.create).not.toHaveBeenCalled();
    },
  );

  it('accepts exactly the bounds', async () => {
    const db = makeDb();
    await setEscrowHoldSetting(db as never, { scope: 'DEFAULT', days: MIN_ESCROW_HOLD_DAYS, actorId: 'a' });
    await setEscrowHoldSetting(db as never, { scope: 'DEFAULT', days: MAX_ESCROW_HOLD_DAYS, actorId: 'a' });
    expect(db.rows).toHaveLength(2);
  });

  it('refuses CATEGORY without a category, and an unknown scope', async () => {
    const db = makeDb();
    await expect(setEscrowHoldSetting(db as never, { scope: 'CATEGORY', days: 3, actorId: 'a' })).rejects.toBeInstanceOf(
      InvalidEscrowHoldError,
    );
    await expect(
      setEscrowHoldSetting(db as never, { scope: 'CATEGORY', category: '  ', days: 3, actorId: 'a' }),
    ).rejects.toBeInstanceOf(InvalidEscrowHoldError);
    await expect(
      setEscrowHoldSetting(db as never, { scope: 'CAMPAIGN' as never, days: 3, actorId: 'a' }),
    ).rejects.toBeInstanceOf(InvalidEscrowHoldError);
  });
});
