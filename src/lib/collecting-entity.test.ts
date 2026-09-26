import { describe, it, expect } from 'vitest';
import { expiringGrants, requiresKindAuthorisation } from './collecting-entity';

/**
 * The pure rules layered on the Collecting Entity's Fundraising Permits and
 * Kind Authorisations (CONTEXT.md, Fundraising Permit, Kind Authorisation;
 * ADR 0010, 0013). campaign-lifecycle.accepts-donations.test.ts covers
 * collectingEntityBlock end to end; this file covers the reader-facing
 * helpers that reach no Campaign.
 */
const NOW = new Date('2026-09-26T10:00:00Z');

describe('requiresKindAuthorisation', () => {
  it('is false only for donation', () => {
    expect(requiresKindAuthorisation('DONATION')).toBe(false);
    expect(requiresKindAuthorisation('ZAKAT')).toBe(true);
    expect(requiresKindAuthorisation('WAKAF')).toBe(true);
    expect(requiresKindAuthorisation('HIBAH')).toBe(true);
  });
});

describe('expiringGrants', () => {
  const org = (overrides: Record<string, unknown> = {}) => ({
    id: 'partner-1',
    name: 'Yayasan Contoh Peduli',
    permits: [],
    kindAuthorisations: [],
    ...overrides,
  });

  it('lists a permit expiring within 30 days, sorted soonest first', () => {
    const permitSoon = { kinds: ['DONATION'] as const, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: new Date('2026-10-10T00:00:00Z') };
    const permitLater = { kinds: ['DONATION'] as const, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: new Date('2026-10-20T00:00:00Z') };

    const result = expiringGrants([org({ permits: [permitLater, permitSoon] })], NOW);

    expect(result).toEqual([
      { type: 'permit', organisationId: 'partner-1', organisationName: 'Yayasan Contoh Peduli', kinds: ['DONATION'], validTo: permitSoon.validTo },
      { type: 'permit', organisationId: 'partner-1', organisationName: 'Yayasan Contoh Peduli', kinds: ['DONATION'], validTo: permitLater.validTo },
    ]);
  });

  it('lists a Kind Authorisation expiring within 30 days', () => {
    const grant = { kind: 'ZAKAT' as const, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: new Date('2026-10-15T00:00:00Z') };

    const result = expiringGrants([org({ kindAuthorisations: [grant] })], NOW);

    expect(result).toEqual([
      { type: 'kindAuthorisation', organisationId: 'partner-1', organisationName: 'Yayasan Contoh Peduli', kind: 'ZAKAT', validTo: grant.validTo },
    ]);
  });

  it('excludes one already lapsed, one not started yet, and one expiring beyond the horizon', () => {
    const lapsed = { kinds: ['DONATION'] as const, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: new Date('2026-09-01T00:00:00Z') };
    const notStarted = { kinds: ['DONATION'] as const, validFrom: new Date('2026-10-01T00:00:00Z'), validTo: new Date('2026-10-10T00:00:00Z') };
    const farOut = { kinds: ['DONATION'] as const, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: new Date('2027-01-01T00:00:00Z') };

    expect(expiringGrants([org({ permits: [lapsed, notStarted, farOut] })], NOW)).toEqual([]);
  });

  it('honours a custom horizon', () => {
    const grant = { kind: 'WAKAF' as const, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: new Date('2026-11-20T00:00:00Z') };

    expect(expiringGrants([org({ kindAuthorisations: [grant] })], NOW, 30)).toEqual([]);
    expect(expiringGrants([org({ kindAuthorisations: [grant] })], NOW, 60)).toHaveLength(1);
  });
});
