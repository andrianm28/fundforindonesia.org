import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { campaignAcceptsDonations, donationBlock } from './campaign-lifecycle';

/**
 * Accepting Donations is computed lazily (prd-compliance 10, 11): an
 * effectively Active Campaign accepts one only while its Collecting Entity
 * holds a Fundraising Permit valid right now for the Campaign's Kind, and,
 * for every Kind but donation, a Kind Authorisation valid right now for it
 * too (CONTEXT.md, Kind Authorisation; ADR 0013). Nothing is written on
 * read, so a lapsed permit or authorisation stops collection by itself.
 */
const NOW = new Date('2026-09-26T10:00:00Z');

// The permit and Kind Authorisation rules below are judged with wakaf and hibah
// open; the WAKAF_HIBAH_OPEN switch has its own describe at the end.
beforeEach(() => {
  vi.stubEnv('WAKAF_HIBAH_OPEN', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const permit = (overrides: Partial<{ kinds: ('DONATION' | 'ZAKAT' | 'WAKAF' | 'HIBAH')[]; validFrom: Date; validTo: Date }> = {}) => ({
  kinds: ['DONATION' as const],
  validFrom: new Date('2026-01-01T00:00:00Z'),
  validTo: new Date('2026-12-31T23:59:59Z'),
  ...overrides,
});

const kindAuthorisation = (overrides: Partial<{ kind: 'DONATION' | 'ZAKAT' | 'WAKAF' | 'HIBAH'; validFrom: Date; validTo: Date }> = {}) => ({
  kind: 'ZAKAT' as const,
  validFrom: new Date('2026-01-01T00:00:00Z'),
  validTo: new Date('2026-12-31T23:59:59Z'),
  ...overrides,
});

const active = (overrides: Record<string, unknown> = {}) => ({
  lifecycleStatus: 'ACTIVE' as const,
  deadline: null,
  kind: 'DONATION' as const,
  collectingEntity: { permits: [permit()], kindAuthorisations: [] },
  ...overrides,
});

describe('campaignAcceptsDonations', () => {
  it('accepts an Active Campaign whose Collecting Entity holds a permit valid now for its Kind', () => {
    expect(campaignAcceptsDonations(active(), NOW)).toBe(true);
    expect(donationBlock(active(), NOW)).toBeNull();
  });

  it('refuses an Active Campaign without a Collecting Entity', () => {
    const campaign = active({ collectingEntity: null });
    expect(campaignAcceptsDonations(campaign, NOW)).toBe(false);
    expect(donationBlock(campaign, NOW)).toBe('NO_COLLECTING_ENTITY');
  });

  it.each([
    ['has lapsed', permit({ validTo: new Date('2026-09-26T09:59:59Z') })],
    ['is not valid yet', permit({ validFrom: new Date('2026-09-27T00:00:00Z') })],
    ['covers other Kinds only', permit({ kinds: ['ZAKAT', 'WAKAF'] })],
  ])('refuses an Active Campaign whose only permit %s', (_why, only) => {
    const campaign = active({ collectingEntity: { permits: [only] } });
    expect(campaignAcceptsDonations(campaign, NOW)).toBe(false);
    expect(donationBlock(campaign, NOW)).toBe('NO_VALID_PERMIT');
  });

  it('treats both ends of the permit as valid', () => {
    const exact = active({ collectingEntity: { permits: [permit({ validFrom: NOW, validTo: NOW })] } });
    expect(campaignAcceptsDonations(exact, NOW)).toBe(true);
  });

  it('accepts when any one permit covers the Kind now', () => {
    const campaign = active({
      kind: 'ZAKAT',
      collectingEntity: {
        permits: [permit({ validTo: new Date('2026-01-31T00:00:00Z'), kinds: ['ZAKAT'] }), permit({ kinds: ['ZAKAT'] })],
        kindAuthorisations: [kindAuthorisation()],
      },
    });
    expect(campaignAcceptsDonations(campaign, NOW)).toBe(true);
  });

  it('still refuses a Campaign that is not effectively Active, whatever its permit', () => {
    expect(campaignAcceptsDonations(active({ lifecycleStatus: 'SUSPENDED' }), NOW)).toBe(false);
    expect(campaignAcceptsDonations(active({ deadline: new Date('2026-09-01T00:00:00Z') }), NOW)).toBe(false);
    // The status is the reason there, not the permit.
    expect(donationBlock(active({ lifecycleStatus: 'SUSPENDED', collectingEntity: null }), NOW)).toBeNull();
  });
});

describe('campaignAcceptsDonations, Kind Authorisation (prd-compliance 11, ADR 0013)', () => {
  const zakat = (overrides: Record<string, unknown> = {}) =>
    active({
      kind: 'ZAKAT',
      collectingEntity: { permits: [permit({ kinds: ['ZAKAT'] })], kindAuthorisations: [kindAuthorisation()] },
      ...overrides,
    });

  it('accepts a Kind that needs one while its Kind Authorisation is valid now, alongside a valid permit', () => {
    expect(campaignAcceptsDonations(zakat(), NOW)).toBe(true);
    expect(donationBlock(zakat(), NOW)).toBeNull();
  });

  it('never needs one for donation, whatever the entity holds', () => {
    const campaign = active({ collectingEntity: { permits: [permit()], kindAuthorisations: [] } });
    expect(campaignAcceptsDonations(campaign, NOW)).toBe(true);
  });

  it.each([
    ['has lapsed', kindAuthorisation({ validTo: new Date('2026-09-26T09:59:59Z') })],
    ['is not valid yet', kindAuthorisation({ validFrom: new Date('2026-09-27T00:00:00Z') })],
    ['is for another Kind', kindAuthorisation({ kind: 'WAKAF' })],
  ])('refuses a Kind that needs one whose only Kind Authorisation %s, even holding a valid permit', (_why, only) => {
    const campaign = zakat({ collectingEntity: { permits: [permit({ kinds: ['ZAKAT'] })], kindAuthorisations: [only] } });
    expect(campaignAcceptsDonations(campaign, NOW)).toBe(false);
    expect(donationBlock(campaign, NOW)).toBe('NO_VALID_KIND_AUTHORISATION');
  });

  it('refuses with NO_VALID_PERMIT before judging the Kind Authorisation when the entity holds neither', () => {
    const campaign = zakat({ collectingEntity: { permits: [], kindAuthorisations: [] } });
    expect(donationBlock(campaign, NOW)).toBe('NO_VALID_PERMIT');
  });

  // ticket 02 (ADR 0013): hibah needs a Kind Authorisation exactly the same
  // way zakat and wakaf already do -- requiresKindAuthorisation is
  // `kind !== 'DONATION'`, not an enumerated list, but this pins the
  // observable behaviour for hibah specifically rather than assuming the
  // generic path covers it.
  it.each(['ZAKAT', 'WAKAF', 'HIBAH'] as const)(
    'accepts a %s Campaign while its Kind Authorisation is valid now, alongside a valid permit',
    (kind) => {
      const campaign = active({
        kind,
        collectingEntity: {
          permits: [permit({ kinds: [kind] })],
          kindAuthorisations: [kindAuthorisation({ kind })],
        },
      });
      expect(campaignAcceptsDonations(campaign, NOW)).toBe(true);
      expect(donationBlock(campaign, NOW)).toBeNull();
    },
  );

  it.each(['ZAKAT', 'WAKAF', 'HIBAH'] as const)(
    'refuses a %s Campaign holding a valid permit but no Kind Authorisation for it',
    (kind) => {
      const campaign = active({
        kind,
        collectingEntity: { permits: [permit({ kinds: [kind] })], kindAuthorisations: [] },
      });
      expect(campaignAcceptsDonations(campaign, NOW)).toBe(false);
      expect(donationBlock(campaign, NOW)).toBe('NO_VALID_KIND_AUTHORISATION');
    },
  );
});

// Audit L1 / T2: no wakaf or hibah money until a licensed nazhir and a sharia
// review are on record. WAKAF_HIBAH_OPEN is the platform switch; only the exact
// value "true" opens it, and it is judged on every call.
describe('campaignAcceptsDonations, WAKAF_HIBAH_OPEN switch', () => {
  const fullyAuthorised = (kind: 'DONATION' | 'WAKAF' | 'HIBAH') =>
    active({
      kind,
      collectingEntity: {
        permits: [permit({ kinds: ['DONATION', 'WAKAF', 'HIBAH'] })],
        kindAuthorisations: [kindAuthorisation({ kind: 'WAKAF' }), kindAuthorisation({ kind: 'HIBAH' })],
      },
    });

  it.each(['WAKAF', 'HIBAH'] as const)('blocks a %s Campaign with KIND_CLOSED when the switch is unset, whatever it holds', (kind) => {
    vi.stubEnv('WAKAF_HIBAH_OPEN', '');
    expect(campaignAcceptsDonations(fullyAuthorised(kind), NOW)).toBe(false);
    expect(donationBlock(fullyAuthorised(kind), NOW)).toBe('KIND_CLOSED');
  });

  it.each(['false', 'TRUE', '1', 'yes', ' true'])('treats %j as closed: only the exact "true" opens', (value) => {
    vi.stubEnv('WAKAF_HIBAH_OPEN', value);
    expect(donationBlock(fullyAuthorised('WAKAF'), NOW)).toBe('KIND_CLOSED');
  });

  it('leaves a donation Campaign unaffected while the switch is off', () => {
    vi.stubEnv('WAKAF_HIBAH_OPEN', '');
    expect(campaignAcceptsDonations(fullyAuthorised('DONATION'), NOW)).toBe(true);
    expect(donationBlock(fullyAuthorised('DONATION'), NOW)).toBeNull();
  });

  it.each(['WAKAF', 'HIBAH'] as const)('changes nothing for a %s Campaign when the switch is "true"', (kind) => {
    vi.stubEnv('WAKAF_HIBAH_OPEN', 'true');
    expect(campaignAcceptsDonations(fullyAuthorised(kind), NOW)).toBe(true);
    expect(donationBlock(fullyAuthorised(kind), NOW)).toBeNull();
    const noAuthorisation = active({
      kind,
      collectingEntity: { permits: [permit({ kinds: [kind] })], kindAuthorisations: [] },
    });
    expect(donationBlock(noAuthorisation, NOW)).toBe('NO_VALID_KIND_AUTHORISATION');
  });
});
