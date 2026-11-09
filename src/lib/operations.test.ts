import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_OPERATIONS,
  InvalidOperationsError,
  MAX_OPERATIONS_HISTORY,
  OPERATIONS_KEY,
  donationsSwitchedOff,
  resolveOperations,
  resolveOperationsOrDefaults,
  setOperations,
} from './operations';

/** A SiteSetting table with at most the one `operations` row. */
function fakeDb(initial?: unknown) {
  let row: { key: string; value: unknown } | null = initial === undefined ? null : { key: OPERATIONS_KEY, value: initial };
  const findUnique = vi.fn(async ({ where }: { where: { key: string } }) => (row && row.key === where.key ? row : null));
  const upsert = vi.fn(async ({ create }: { create: { key: string; value: unknown } }) => {
    row = { key: create.key, value: create.value };
    return row;
  });
  return { db: { siteSetting: { findUnique, upsert } } as never, findUnique, upsert, stored: () => row?.value };
}

const ADMIN = { actorId: 'admin-1', actorName: 'Dewi Admin' };

describe('resolveOperations', () => {
  it('has donations open and maintenance off when nothing was ever stored', async () => {
    const { db } = fakeDb();
    expect(await resolveOperations(db)).toEqual(DEFAULT_OPERATIONS);
    expect(DEFAULT_OPERATIONS.donationsOpen).toBe(true);
    expect(DEFAULT_OPERATIONS.maintenance).toEqual({ on: false, message: '' });
  });

  it('falls back to the defaults for a stored row that no longer parses', async () => {
    const { db } = fakeDb({ donationsOpen: 'ya' });
    expect(await resolveOperations(db)).toEqual(DEFAULT_OPERATIONS);
  });

  it('shows the defaults rather than throwing when the database cannot be read (public pages)', async () => {
    const db = { siteSetting: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) } } as never;
    expect(await resolveOperationsOrDefaults(db)).toEqual(DEFAULT_OPERATIONS);
  });
});

describe('setOperations', () => {
  it('switches donations off and records who, when, and the old and new value', async () => {
    const { db, upsert } = fakeDb();
    const now = new Date('2026-11-09T03:00:00.000Z');

    const result = await setOperations(db, { patch: { donationsOpen: false }, ...ADMIN, now });

    expect(result.donationsOpen).toBe(false);
    expect(result.history).toEqual([
      {
        at: '2026-11-09T03:00:00.000Z',
        actorId: 'admin-1',
        actorName: 'Dewi Admin',
        changes: [{ field: 'donationsOpen', from: true, to: false }],
      },
    ]);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'operations' },
        create: expect.objectContaining({ key: 'operations', updatedById: 'admin-1' }),
        update: expect.objectContaining({ updatedById: 'admin-1' }),
      }),
    );
  });

  it('turns maintenance on with a message, keeping the earlier history newest first', async () => {
    const { db } = fakeDb();
    await setOperations(db, { patch: { donationsOpen: false }, ...ADMIN, now: new Date('2026-11-09T03:00:00Z') });
    const result = await setOperations(db, {
      patch: { maintenanceOn: true, maintenanceMessage: '  Kembali pukul 10.00 WIB.  ' },
      ...ADMIN,
      now: new Date('2026-11-09T04:00:00Z'),
    });

    expect(result.donationsOpen).toBe(false);
    expect(result.maintenance).toEqual({ on: true, message: 'Kembali pukul 10.00 WIB.' });
    expect(result.history.map((h) => h.at)).toEqual(['2026-11-09T04:00:00.000Z', '2026-11-09T03:00:00.000Z']);
    expect(result.history[0].changes).toEqual([
      { field: 'maintenanceOn', from: false, to: true },
      { field: 'maintenanceMessage', from: '', to: 'Kembali pukul 10.00 WIB.' },
    ]);
  });

  it('writes nothing and adds no history entry when the patch changes nothing', async () => {
    const { db, upsert } = fakeDb();
    const result = await setOperations(db, { patch: { donationsOpen: true, maintenanceOn: false }, ...ADMIN });
    expect(upsert).not.toHaveBeenCalled();
    expect(result.history).toEqual([]);
  });

  it('keeps only the newest entries of the history', async () => {
    const { db } = fakeDb();
    for (let i = 0; i < MAX_OPERATIONS_HISTORY + 5; i++) {
      await setOperations(db, { patch: { donationsOpen: i % 2 === 1 }, ...ADMIN, now: new Date(2026, 10, 9, 0, i) });
    }
    const { history } = await resolveOperations(db);
    expect(history).toHaveLength(MAX_OPERATIONS_HISTORY);
  });

  it.each([
    [{ donationsOpen: 'false' }],
    [{ maintenanceOn: 1 }],
    [{ maintenanceMessage: 'x'.repeat(501) }],
    [{}],
    [null],
    [{ unknown: true }],
  ])('refuses the invalid patch %j with a 400-class error and writes nothing', async (patch) => {
    const { db, upsert } = fakeDb();
    await expect(setOperations(db, { patch, ...ADMIN })).rejects.toBeInstanceOf(InvalidOperationsError);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('donationsSwitchedOff', () => {
  it('is true only when an Admin switched donations off', async () => {
    expect(await donationsSwitchedOff(fakeDb().db)).toBe(false);
    expect(await donationsSwitchedOff(fakeDb({ ...DEFAULT_OPERATIONS, donationsOpen: false }).db)).toBe(true);
  });

  it('fails closed: a switch that cannot be read refuses the money route', async () => {
    const db = { siteSetting: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) } } as never;
    expect(await donationsSwitchedOff(db)).toBe(true);
  });
});
