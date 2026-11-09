import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_OPERATIONS,
  InvalidOperationsError,
  MAX_OPERATIONS_HISTORY,
  OPERATIONS_KEY,
  OperationsConflictError,
  operationsErrorToHttp,
  donationsSwitchedOff,
  resolveOperations,
  resolveDonationPresetsOrDefaults,
  resolveOperationsOrDefaults,
  setOperations,
  OperationsCorruptError,
} from './operations';
import { MAX_DONATION_AMOUNT } from './donations';

/**
 * A SiteSetting table with at most the one `operations` row, versioned by
 * `updatedAt` like the real one. `rival()` makes another Admin's write land
 * between this one's read and write.
 */
function fakeDb(initial?: unknown) {
  let tick = 0;
  let row: { key: string; value: unknown; updatedAt: Date } | null =
    initial === undefined ? null : { key: OPERATIONS_KEY, value: initial, updatedAt: new Date(++tick) };
  let beforeWrite: (() => void) | null = null;
  const findUnique = vi.fn(async ({ where }: { where: { key: string } }) => {
    const seen = row && row.key === where.key ? { ...row } : null;
    const hook = beforeWrite;
    beforeWrite = null;
    hook?.();
    return seen;
  });
  const create = vi.fn(async ({ data }: { data: { key: string; value: unknown } }) => {
    if (row) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    row = { key: data.key, value: data.value, updatedAt: new Date(++tick) };
    return row;
  });
  const updateMany = vi.fn(
    async ({ where, data }: { where: { key: string; updatedAt: Date }; data: { value: unknown } }) => {
      if (!row || row.key !== where.key || row.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
      row = { ...row, value: data.value, updatedAt: new Date(++tick) };
      return { count: 1 };
    },
  );
  return {
    db: { siteSetting: { findUnique, create, updateMany } } as never,
    findUnique,
    create,
    updateMany,
    stored: () => row?.value,
    rival: (write: () => void) => {
      beforeWrite = write;
    },
    rivalWrites: (value: unknown) => {
      row = { key: OPERATIONS_KEY, value, updatedAt: new Date(++tick) };
    },
  };
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
    const { db, create } = fakeDb();
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
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ key: 'operations', updatedById: 'admin-1' }),
    });
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
    const { db, create, updateMany } = fakeDb();
    const result = await setOperations(db, { patch: { donationsOpen: true, maintenanceOn: false }, ...ADMIN });
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
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
    const { db, create, updateMany } = fakeDb();
    await expect(setOperations(db, { patch, ...ADMIN })).rejects.toBeInstanceOf(InvalidOperationsError);
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
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

describe('donation presets: what the donate page offers', () => {
  const OLD_DEFAULT = [20000, 50000, 100000, 250000, 500000];
  const stored = (presets: unknown) => ({
    donationsOpen: false,
    maintenance: { on: false, message: '' },
    history: [],
    donationPresets: presets,
  });

  it('are the amounts the page used to hard-code when nothing was ever stored', async () => {
    expect((await resolveOperations(fakeDb().db)).donationPresets).toEqual(OLD_DEFAULT);
    expect(DEFAULT_OPERATIONS.donationPresets).toEqual(OLD_DEFAULT);
    expect(await resolveDonationPresetsOrDefaults(fakeDb().db)).toEqual(OLD_DEFAULT);
  });

  it('are the defaults for a row written before presets existed, with its switches untouched', async () => {
    const { db } = fakeDb({ donationsOpen: false, maintenance: { on: true, message: 'x' }, history: [] });
    const ops = await resolveOperations(db);
    expect(ops.donationPresets).toEqual(OLD_DEFAULT);
    expect(ops.donationsOpen).toBe(false);
    expect(ops.maintenance.on).toBe(true);
  });

  it('are the stored amounts when they are valid', async () => {
    const { db } = fakeDb(stored([5000, 10000, 25000]));
    expect(await resolveDonationPresetsOrDefaults(db)).toEqual([5000, 10000, 25000]);
  });

  it.each([
    ['not an array', 'banyak'],
    ['too few', [5000, 10000]],
    ['too many', [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000]],
    ['below the minimum donation', [500, 5000, 10000]],
    ['duplicated', [5000, 5000, 10000]],
    ['not whole rupiah', [5000.5, 10000, 20000]],
  ])('fall back to the defaults for a damaged row (%s), keeping the switches as stored', async (_why, bad) => {
    const { db } = fakeDb(stored(bad));
    const ops = await resolveOperations(db);
    expect(ops.donationPresets).toEqual(OLD_DEFAULT);
    expect(ops.donationsOpen).toBe(false);
  });

  it('show the defaults rather than throwing when the database cannot be read', async () => {
    const db = { siteSetting: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) } } as never;
    expect(await resolveDonationPresetsOrDefaults(db)).toEqual(OLD_DEFAULT);
  });
});

describe('setOperations: donation presets', () => {
  it('stores new presets sorted, and records the old and new list in the history', async () => {
    const { db } = fakeDb();
    const result = await setOperations(db, {
      patch: { donationPresets: [50000, 10000, 25000, 100000] },
      ...ADMIN,
      now: new Date('2026-11-09T03:00:00.000Z'),
    });

    expect(result.donationPresets).toEqual([10000, 25000, 50000, 100000]);
    expect(result.history[0].changes).toEqual([
      {
        field: 'donationPresets',
        from: [20000, 50000, 100000, 250000, 500000],
        to: [10000, 25000, 50000, 100000],
      },
    ]);
    expect(await resolveDonationPresetsOrDefaults(db)).toEqual([10000, 25000, 50000, 100000]);
  });

  it('changes nothing else and writes nothing when the presets sent are the ones already in force', async () => {
    const { db, create } = fakeDb();
    await setOperations(db, { patch: { donationPresets: [500000, 20000, 250000, 100000, 50000] }, ...ADMIN });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['below the minimum donation', [999, 5000, 10000], /minimal Rp1\.000/],
    ['duplicated', [5000, 5000, 10000], /tidak boleh ada yang sama/],
    ['more than 8 values', [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000], /maksimal 8/],
    ['fewer than 3 values', [5000, 10000], /minimal 3/],
    ['not whole rupiah', [5000.5, 10000, 20000], /bilangan bulat/],
    ['above the donation ceiling', [5000, 10000, 1_000_000_001], /maksimal Rp1\.000\.000\.000/],
    ['not numbers', ['5000', 10000, 20000], /angka/],
    ['not a list', 'banyak', /daftar angka/],
  ])('refuses presets %s and writes nothing', async (_why, presets, message) => {
    const { db, create, updateMany } = fakeDb();
    const error = await setOperations(db, { patch: { donationPresets: presets }, ...ADMIN }).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidOperationsError);
    expect(error.message).toMatch(message);
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('setOperations: two Admins saving at once', () => {
  it('refuses the second save with a conflict when the row changed after it was read, and keeps the first Admin work', async () => {
    const f = fakeDb({ ...DEFAULT_OPERATIONS });
    f.rival(() =>
      f.rivalWrites({
        ...DEFAULT_OPERATIONS,
        donationsOpen: false,
        history: [{ at: '2026-11-09T02:00:00.000Z', actorId: 'admin-2', actorName: 'Budi', changes: [{ field: 'donationsOpen', from: true, to: false }] }],
      }),
    );

    const error = await setOperations(f.db, { patch: { maintenanceOn: true }, ...ADMIN }).catch((e) => e);

    expect(error).toBeInstanceOf(OperationsConflictError);
    expect(operationsErrorToHttp(error)).toEqual({ status: 409, error: 'Setelan berubah, muat ulang halaman lalu coba lagi.' });
    const kept = await resolveOperations(f.db);
    expect(kept.donationsOpen).toBe(false);
    expect(kept.maintenance.on).toBe(false);
    expect(kept.history).toHaveLength(1);
  });

  it('refuses a preset save the same way when the row changed meanwhile', async () => {
    const f = fakeDb({ ...DEFAULT_OPERATIONS });
    f.rival(() => f.rivalWrites({ ...DEFAULT_OPERATIONS, donationPresets: [1000, 2000, 3000] }));

    await expect(
      setOperations(f.db, { patch: { donationPresets: [5000, 10000, 20000] }, ...ADMIN }),
    ).rejects.toBeInstanceOf(OperationsConflictError);
    expect(await resolveDonationPresetsOrDefaults(f.db)).toEqual([1000, 2000, 3000]);
  });

  it('refuses the loser of a race to write the very first row', async () => {
    const f = fakeDb();
    f.rival(() => f.rivalWrites({ ...DEFAULT_OPERATIONS, donationsOpen: false }));

    await expect(setOperations(f.db, { patch: { maintenanceOn: true }, ...ADMIN })).rejects.toBeInstanceOf(
      OperationsConflictError,
    );
    expect((await resolveOperations(f.db)).donationsOpen).toBe(false);
  });

  it('lets a save through when nobody else wrote in between', async () => {
    const f = fakeDb({ ...DEFAULT_OPERATIONS });
    await setOperations(f.db, { patch: { maintenanceOn: true }, ...ADMIN });
    await setOperations(f.db, { patch: { donationsOpen: false }, ...ADMIN });
    expect((await resolveOperations(f.db)).history).toHaveLength(2);
  });
});

describe('setOperations: preset ceiling and whole rupiah', () => {
  it('refuses presets above Rp1 miliar, naming the ceiling in rupiah', async () => {
    const f = fakeDb({ ...DEFAULT_OPERATIONS });
    const error = await setOperations(f.db, {
      patch: { donationPresets: [5000, 10000, MAX_DONATION_AMOUNT + 1] },
      ...ADMIN,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidOperationsError);
    expect(error.message).toBe('Nominal preset maksimal Rp1.000.000.000.');
    expect(f.updateMany).not.toHaveBeenCalled();
  });

  it('accepts a preset of exactly Rp1 miliar', async () => {
    const f = fakeDb({ ...DEFAULT_OPERATIONS });
    const next = await setOperations(f.db, { patch: { donationPresets: [5000, 10000, 1_000_000_000] }, ...ADMIN });
    expect(next.donationPresets).toEqual([5000, 10000, 1_000_000_000]);
  });

  it('refuses non-integer presets', async () => {
    const f = fakeDb({ ...DEFAULT_OPERATIONS });
    await expect(
      setOperations(f.db, { patch: { donationPresets: [5000, 10000.5, 20000] }, ...ADMIN }),
    ).rejects.toBeInstanceOf(InvalidOperationsError);
    expect(f.updateMany).not.toHaveBeenCalled();
  });

  it('writes the minimum in rupiah, not in the runtime locale', async () => {
    const f = fakeDb({ ...DEFAULT_OPERATIONS });
    const error = await setOperations(f.db, { patch: { donationPresets: [500, 10000, 20000] }, ...ADMIN }).catch((e) => e);
    expect(error.message).toBe('Nominal preset minimal Rp1.000.');
  });
});

describe('setOperations: stale version and a damaged row', () => {
  it('refuses a save that carries a stale updatedAt, and the first save stands', async () => {
    const f = fakeDb({ ...DEFAULT_OPERATIONS });
    f.rival(() => f.rivalWrites({ ...DEFAULT_OPERATIONS, donationsOpen: false }));
    const error = await setOperations(f.db, { patch: { maintenanceOn: true }, ...ADMIN }).catch((e) => e);
    expect(error).toBeInstanceOf(OperationsConflictError);
    const kept = await resolveOperations(f.db);
    expect(kept.donationsOpen).toBe(false);
    expect(kept.maintenance.on).toBe(false);
  });

  it('refuses to save over a row that no longer parses, writes nothing, and logs operations_row_corrupt', async () => {
    const damaged = { donationsOpen: 'ya', history: [{ at: 'x' }] };
    const f = fakeDb(damaged);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const error = await setOperations(f.db, { patch: { maintenanceOn: true }, ...ADMIN }).catch((e) => e);

    expect(error).toBeInstanceOf(OperationsCorruptError);
    expect(operationsErrorToHttp(error)?.status).toBe(422);
    expect(f.updateMany).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.stored()).toEqual(damaged);
    expect(log.mock.calls.flat().join(' ')).toContain('operations_row_corrupt');
    log.mockRestore();
  });

  it('reads a damaged row as the defaults without throwing, as before', async () => {
    const f = fakeDb({ donationsOpen: 'ya' });
    expect(await resolveOperations(f.db)).toEqual(DEFAULT_OPERATIONS);
    expect(await donationsSwitchedOff(f.db)).toBe(false);
  });
});
