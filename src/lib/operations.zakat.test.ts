import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_OPERATIONS,
  InvalidOperationsError,
  OPERATIONS_KEY,
  resolveOperations,
  setOperations,
  zakatSwitchedOn,
} from './operations';

/**
 * The zakat switch and settings (PKS pemenuhan 19, ADR 0028) live in the same
 * `operations` row as the donation switch. Default OFF, Admin-only (the route
 * is), and it can only be turned ON while the recipient institution holds a
 * valid permit and Kind Authorisation for zakat.
 */

const NOW = new Date('2026-11-09T03:00:00.000Z');
const ADMIN = { actorId: 'admin-1', actorName: 'Dewi Admin', now: NOW };
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

type Org = {
  permits: { kinds: string[]; validFrom: Date; validTo: Date }[];
  kindAuthorisations: { kind: string; validFrom: Date; validTo: Date }[];
};
const LICENSED: Org = {
  permits: [{ kinds: ['DONATION', 'ZAKAT'], validFrom: day(-10), validTo: day(300) }],
  kindAuthorisations: [{ kind: 'ZAKAT', validFrom: day(-10), validTo: day(300) }],
};

function fakeDb(initial?: unknown, orgs: Record<string, Org> = { 'org-1': LICENSED }) {
  let row: { key: string; value: unknown; updatedAt: Date } | null =
    initial === undefined ? null : { key: OPERATIONS_KEY, value: initial, updatedAt: new Date(1) };
  const create = vi.fn(async ({ data }: { data: { key: string; value: unknown } }) => {
    row = { key: data.key, value: data.value, updatedAt: new Date(2) };
    return row;
  });
  const updateMany = vi.fn(async ({ data }: { data: { value: unknown } }) => {
    row = { ...row!, value: data.value, updatedAt: new Date(row!.updatedAt.getTime() + 1) };
    return { count: 1 };
  });
  const findUnique = vi.fn(async () => (row ? { ...row } : null));
  const orgFind = vi.fn(async ({ where }: { where: { id: string } }) => orgs[where.id] ?? null);
  return {
    db: { siteSetting: { findUnique, create, updateMany }, partnerOrganisation: { findUnique: orgFind } } as never,
    create,
    updateMany,
    stored: () => row?.value as { zakat: unknown } | undefined,
  };
}

describe('zakat switch defaults', () => {
  it('is OFF by default, with no nisab and no recipient', async () => {
    expect(DEFAULT_OPERATIONS.zakat).toEqual({ enabled: false, nisabAmount: 0, recipientOrganisationId: null });
    expect(await zakatSwitchedOn(fakeDb().db)).toBe(false);
  });

  it('reads a row written before the zakat section existed as OFF, keeping the donation switch as stored', async () => {
    const { db } = fakeDb({ donationsOpen: false, maintenance: { on: false, message: '' }, history: [] });
    const operations = await resolveOperations(db);
    expect(operations.zakat.enabled).toBe(false);
    expect(operations.donationsOpen).toBe(false);
  });

  it('fails closed: an unreadable row means the module is off', async () => {
    const db = { siteSetting: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) } } as never;
    expect(await zakatSwitchedOn(db)).toBe(false);
  });
});

describe('setOperations: zakat settings', () => {
  it('stores nisab and recipient while OFF, without any licence check, and records them in the history', async () => {
    const { db } = fakeDb(undefined, {});
    const result = await setOperations(db, {
      patch: { zakatNisabAmount: 85_000_000, zakatRecipientOrganisationId: null },
      ...ADMIN,
    });
    expect(result.zakat).toEqual({ enabled: false, nisabAmount: 85_000_000, recipientOrganisationId: null });
    expect(result.history[0].changes).toEqual([{ field: 'zakatNisabAmount', from: 0, to: 85_000_000 }]);
  });

  it('refuses a recipient that is not a Partner Organisation', async () => {
    const { db, create } = fakeDb();
    const error = await setOperations(db, { patch: { zakatRecipientOrganisationId: 'ghost' }, ...ADMIN }).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidOperationsError);
    expect(error.message).toMatch(/Lembaga penerima zakat tidak ditemukan/);
    expect(create).not.toHaveBeenCalled();
  });

  it('turns the module ON only with a nisab, a recipient, and the recipient licensed for zakat now', async () => {
    const { db } = fakeDb();
    const result = await setOperations(db, {
      patch: { zakatEnabled: true, zakatNisabAmount: 85_000_000, zakatRecipientOrganisationId: 'org-1' },
      ...ADMIN,
    });
    expect(result.zakat).toEqual({ enabled: true, nisabAmount: 85_000_000, recipientOrganisationId: 'org-1' });
    expect(await zakatSwitchedOn(db)).toBe(true);
    expect(result.history[0].changes.map((c) => c.field).sort()).toEqual([
      'zakatEnabled',
      'zakatNisabAmount',
      'zakatRecipientOrganisationId',
    ]);
  });

  it.each([
    ['no nisab', { zakatEnabled: true, zakatRecipientOrganisationId: 'org-1' }, /nisab/i],
    ['no recipient', { zakatEnabled: true, zakatNisabAmount: 85_000_000 }, /lembaga penerima/i],
  ])('refuses ON with %s, and writes nothing', async (_why, patch, message) => {
    const { db, create } = fakeDb();
    const error = await setOperations(db, { patch, ...ADMIN }).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidOperationsError);
    expect(error.message).toMatch(message);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['no permit for zakat', { permits: [{ kinds: ['DONATION'], validFrom: day(-10), validTo: day(300) }], kindAuthorisations: LICENSED.kindAuthorisations }],
    ['no Kind Authorisation for zakat', { permits: LICENSED.permits, kindAuthorisations: [] }],
    ['a lapsed authorisation', { permits: LICENSED.permits, kindAuthorisations: [{ kind: 'ZAKAT', validFrom: day(-300), validTo: day(-1) }] }],
  ])('refuses ON when the recipient has %s', async (_why, org) => {
    const { db, create } = fakeDb(undefined, { 'org-1': org });
    const error = await setOperations(db, {
      patch: { zakatEnabled: true, zakatNisabAmount: 85_000_000, zakatRecipientOrganisationId: 'org-1' },
      ...ADMIN,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidOperationsError);
    expect(error.message).toMatch(/izin.*zakat/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('turns OFF without any check, whatever the recipient holds now', async () => {
    const { db } = fakeDb(
      { ...DEFAULT_OPERATIONS, zakat: { enabled: true, nisabAmount: 85_000_000, recipientOrganisationId: 'org-1' } },
      {},
    );
    const result = await setOperations(db, { patch: { zakatEnabled: false }, ...ADMIN });
    expect(result.zakat.enabled).toBe(false);
  });

  it('refuses a nisab that is not a positive whole rupiah', async () => {
    for (const bad of [0, -5, 1.5, '85000000']) {
      const { db } = fakeDb();
      const error = await setOperations(db, { patch: { zakatNisabAmount: bad }, ...ADMIN }).catch((e) => e);
      expect(error).toBeInstanceOf(InvalidOperationsError);
    }
  });
});
