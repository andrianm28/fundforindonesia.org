import { describe, it, expect, vi } from 'vitest';
import { resolveZakatCheckout, zakatCheckoutRefusal } from './zakat';
import { OPERATIONS_KEY } from './operations';

/** The zakat page's read: the Admin's settings and the Campaign a zakat payment goes to (ADR 0028). */

const NOW = new Date('2026-11-09T03:00:00.000Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const licensedEntity = {
  id: 'org-1',
  name: 'Yayasan Contoh Peduli',
  permits: [{ kinds: ['ZAKAT'], validFrom: day(-10), validTo: day(300) }],
  kindAuthorisations: [{ kind: 'ZAKAT', validFrom: day(-10), validTo: day(300) }],
};

function campaign(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    slug: 'zakat-yayasan',
    title: 'Zakat melalui Yayasan Contoh',
    lifecycleStatus: 'ACTIVE',
    deadline: day(60),
    kind: 'ZAKAT',
    collectingEntity: licensedEntity,
    ...over,
  };
}

function fakeDb(zakat: unknown, campaigns: unknown[]) {
  const findMany = vi.fn(async () => campaigns);
  const db = {
    siteSetting: {
      findUnique: vi.fn(async () =>
        zakat === undefined
          ? null
          : { key: OPERATIONS_KEY, value: { donationsOpen: true, maintenance: { on: false, message: '' }, zakat, history: [] }, updatedAt: new Date(1) },
      ),
    },
    campaign: { findMany },
    partnerOrganisation: { findUnique: vi.fn(async () => ({ name: 'Yayasan Contoh Peduli' })) },
  } as never;
  return { db, findMany };
}

const ON = { enabled: true, nisabAmount: 85_000_000, recipientOrganisationId: 'org-1' };

describe('resolveZakatCheckout', () => {
  it('is null while the module is off, without looking for a Campaign', async () => {
    const { db, findMany } = fakeDb({ ...ON, enabled: false }, [campaign()]);
    expect(await resolveZakatCheckout(db, NOW)).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns the nisab, the recipient and the Campaign a payment goes to', async () => {
    const { db, findMany } = fakeDb(ON, [campaign()]);

    expect(await resolveZakatCheckout(db, NOW)).toEqual({
      nisabAmount: 85_000_000,
      recipientName: 'Yayasan Contoh Peduli',
      campaign: { slug: 'zakat-yayasan', title: 'Zakat melalui Yayasan Contoh' },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ kind: 'ZAKAT', collectingEntityId: 'org-1', isDemo: false }) }),
    );
  });

  it('skips a Campaign whose recipient permit or Kind Authorisation lapsed, taking the next that can collect', async () => {
    const lapsed = campaign({
      slug: 'lama',
      collectingEntity: { ...licensedEntity, kindAuthorisations: [{ kind: 'ZAKAT', validFrom: day(-300), validTo: day(-1) }] },
    });
    const { db } = fakeDb(ON, [lapsed, campaign({ slug: 'baru' })]);
    expect((await resolveZakatCheckout(db, NOW))?.campaign?.slug).toBe('baru');
  });

  it('has no Campaign to offer when none can collect, and says the recipient anyway', async () => {
    const { db } = fakeDb(ON, [campaign({ deadline: day(-1) })]);
    expect(await resolveZakatCheckout(db, NOW)).toMatchObject({ campaign: null, recipientName: 'Yayasan Contoh Peduli' });
  });

  it('is null on an unreadable setting', async () => {
    const db = { siteSetting: { findUnique: vi.fn().mockRejectedValue(new Error('down')) } } as never;
    expect(await resolveZakatCheckout(db, NOW)).toBeNull();
  });
});

describe('zakatCheckoutRefusal', () => {
  it('judges nothing for another Kind and reads nothing', async () => {
    const { db } = fakeDb(undefined, []);
    expect(await zakatCheckoutRefusal(db, { kind: 'WAKAF', collectingEntity: null })).toBeNull();
    expect((db as never as { siteSetting: { findUnique: ReturnType<typeof vi.fn> } }).siteSetting.findUnique).not.toHaveBeenCalled();
  });
});
