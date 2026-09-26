import { describe, it, expect } from 'vitest';
import { campaignAcceptsDonations, donationBlock } from './campaign-lifecycle';

/**
 * Accepting Donations is computed lazily (prd-compliance 10): an effectively
 * Active Campaign accepts one only while its Collecting Entity holds a
 * Fundraising Permit valid right now for the Campaign's Kind. Nothing is
 * written on read, so a lapsed permit stops collection by itself.
 */
const NOW = new Date('2026-09-26T10:00:00Z');

const permit = (overrides: Partial<{ kinds: ('DONATION' | 'ZAKAT' | 'WAKAF' | 'HIBAH')[]; validFrom: Date; validTo: Date }> = {}) => ({
  kinds: ['DONATION' as const],
  validFrom: new Date('2026-01-01T00:00:00Z'),
  validTo: new Date('2026-12-31T23:59:59Z'),
  ...overrides,
});

const active = (overrides: Record<string, unknown> = {}) => ({
  lifecycleStatus: 'ACTIVE' as const,
  deadline: null,
  kind: 'DONATION' as const,
  collectingEntity: { permits: [permit()] },
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
