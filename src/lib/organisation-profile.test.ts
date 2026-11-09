import { describe, it, expect, vi } from 'vitest';
import { getOrganisationProfile } from './organisation-profile';

type Db = Parameters<typeof getOrganisationProfile>[0];

/**
 * The public profile of a Partner Organisation (PKS Pasal 12(5)): only
 * public fields leave this module, and an organisation with no valid permit
 * is described as it is.
 */

const NOW = new Date('2026-11-09T00:00:00Z');

function dbWith(org: Record<string, unknown> | null, campaigns: Record<string, unknown>[] = []) {
  const findUnique = vi.fn().mockResolvedValue(org);
  const findMany = vi.fn().mockResolvedValue(campaigns);
  const db = {
    partnerOrganisation: { findUnique },
    campaign: { findMany, findFirst: vi.fn() },
  };
  return Object.assign(db as never, { findUnique, findMany }) as Db & { findUnique: typeof findUnique; findMany: typeof findMany };
}

const permit = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  number: 'SK-123/2026',
  issuer: 'Kementerian Sosial',
  kinds: ['DONATION'],
  validFrom: new Date('2026-01-01T00:00:00Z'),
  validTo: new Date('2026-12-31T00:00:00Z'),
  ...over,
});

describe('getOrganisationProfile', () => {
  it('returns null for an unknown organisation', async () => {
    expect(await getOrganisationProfile(dbWith(null), 'nope', NOW)).toBeNull();
  });

  it('returns only public fields, whatever else the row carries', async () => {
    const row = {
      id: 'org1',
      name: 'Yayasan Contoh',
      permits: [permit({ recordedById: 'u9' })],
      fundraiserId: 'u1',
      registeredById: 'u2',
      documents: [{ id: 'd1', fileUrl: '/uploads/secret.pdf' }],
      members: [{ email: 'a@b.c' }],
    };
    const profile = await getOrganisationProfile(dbWith(row), 'org1', NOW);
    expect(Object.keys(profile!).sort()).toEqual(['campaigns', 'id', 'name', 'permitStatus', 'permits']);
    expect(Object.keys(profile!.permits[0]).sort()).toEqual([
      'id',
      'issuer',
      'kinds',
      'number',
      'status',
      'validFrom',
      'validTo',
    ]);
    expect(JSON.stringify(profile)).not.toMatch(/secret|a@b\.c|u1|u2|u9/);
  });

  it('asks the database for public columns only', async () => {
    const db = dbWith({ id: 'org1', name: 'Y', permits: [] });
    await getOrganisationProfile(db, 'org1', NOW);
    const args = db.findUnique.mock.calls[0][0];
    const text = JSON.stringify(args);
    for (const forbidden of ['documents', 'members', 'fundraiser', 'bank', 'verificationRequests', 'providerWithdrawals']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it('marks each permit as valid, expired or not yet valid, ends inclusive', async () => {
    const row = {
      id: 'o',
      name: 'Y',
      permits: [
        permit({ id: 'a', validTo: NOW }),
        permit({ id: 'b', validFrom: new Date('2025-01-01T00:00:00Z'), validTo: new Date('2026-11-08T23:59:59Z') }),
        permit({ id: 'c', validFrom: new Date('2026-11-10T00:00:00Z'), validTo: new Date('2027-11-10T00:00:00Z') }),
      ],
    };
    const profile = await getOrganisationProfile(dbWith(row), 'o', NOW);
    const byId = Object.fromEntries(profile!.permits.map((p) => [p.id, p.status]));
    expect(byId).toEqual({ a: 'valid', b: 'expired', c: 'not_yet_valid' });
    expect(profile!.permitStatus).toBe('valid');
  });

  it('says so when it has no permit at all, and when none is valid now', async () => {
    const none = await getOrganisationProfile(dbWith({ id: 'o', name: 'Y', permits: [] }), 'o', NOW);
    expect(none!.permitStatus).toBe('none');
    const lapsed = { id: 'o', name: 'Y', permits: [permit({ validTo: new Date('2026-06-30T00:00:00Z') })] };
    expect((await getOrganisationProfile(dbWith(lapsed), 'o', NOW))!.permitStatus).toBe('none_valid');
  });

  it('lists permits valid first, then newest', async () => {
    const row = {
      id: 'o',
      name: 'Y',
      permits: [
        permit({ id: 'old', validFrom: new Date('2024-01-01T00:00:00Z'), validTo: new Date('2024-12-31T00:00:00Z') }),
        permit({ id: 'now' }),
      ],
    };
    const profile = await getOrganisationProfile(dbWith(row), 'o', NOW);
    expect(profile!.permits.map((p) => p.id)).toEqual(['now', 'old']);
  });

  it('lists the active campaigns it collects for, as public card fields', async () => {
    const campaigns = [{ slug: 'sumur', title: 'Sumur', targetAmount: 1000, secret: 'x' }];
    const db = dbWith({ id: 'o', name: 'Y', permits: [] }, campaigns);
    const profile = await getOrganisationProfile(db, 'o', NOW);
    expect(profile!.campaigns).toEqual([{ slug: 'sumur', title: 'Sumur' }]);
    const where = JSON.stringify(db.findMany.mock.calls[0][0].where);
    expect(where).toContain('collectingEntityId');
    expect(where).toContain('ACTIVE');
  });
});
