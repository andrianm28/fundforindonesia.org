import { describe, it, expect } from 'vitest';
import { tripFeeEmail } from './trip-fee';
import { SITE_IDENTITY } from '@/lib/site-identity';

/**
 * The Trip Fee emails a Volunteer gets (ticket rilis-1-benda/84): the seat is
 * confirmed, a Trip Fee Refund is approved, and it is paid. None carries an
 * account number or other personal data: the input has no field for one.
 */
const BASE = {
  to: 'rina@example.test',
  volunteerName: 'Rina',
  tripTitle: 'Trip Lombok',
  tripUrl: 'https://fundforindonesia.org/volunteer-trip/lombok',
} as const;

describe('tripFeeEmail', () => {
  it('confirms the Registration, with the Trip Fee paid and the Batch dates', () => {
    const m = tripFeeEmail({
      ...BASE,
      event: 'confirmed',
      amount: 500_000,
      startDate: new Date('2026-12-01T00:00:00+07:00'),
      endDate: new Date('2026-12-05T23:59:59+07:00'),
    });
    expect(m.to).toBe('rina@example.test');
    expect(m.subject).toBe('Pendaftaran "Trip Lombok" dikonfirmasi');
    expect(m.text).toContain('Halo Rina,');
    expect(m.text).toMatch(/Rp\s?500\.000/);
    expect(m.text).toContain('1 Des 2026');
    expect(m.text).toContain('5 Des 2026');
    expect(m.text).toContain(BASE.tripUrl);
  });

  it('tells the Volunteer an approved full Refund will be transferred, in full', () => {
    const m = tripFeeEmail({ ...BASE, event: 'refund-approved', tier: 'FULL', amount: 500_000, paidAmount: 500_000 });
    expect(m.subject).toBe('Refund Trip Fee "Trip Lombok" disetujui');
    expect(m.text).toMatch(/Rp\s?500\.000/);
    expect(m.text).toContain('penuh');
    expect(m.text).toContain('sedang diproses');
  });

  it('tells the Volunteer an approved half Refund is half the Trip Fee, with both amounts', () => {
    const m = tripFeeEmail({ ...BASE, event: 'refund-approved', tier: 'HALF', amount: 250_000, paidAmount: 500_000 });
    expect(m.text).toMatch(/Rp\s?250\.000/);
    expect(m.text).toMatch(/Rp\s?500\.000/);
    expect(m.text).toContain('separuh');
  });

  it('tells the Volunteer a completed Refund was transferred', () => {
    const m = tripFeeEmail({ ...BASE, event: 'refund-completed', tier: 'FULL', amount: 500_000, paidAmount: 500_000 });
    expect(m.subject).toBe('Refund Trip Fee "Trip Lombok" sudah ditransfer');
    expect(m.text).toContain('rekening yang Anda berikan');
    expect(m.text).toContain(SITE_IDENTITY.contactEmail);
  });

  it('tells the Volunteer a completed half Refund was only half the Trip Fee', () => {
    const m = tripFeeEmail({ ...BASE, event: 'refund-completed', tier: 'HALF', amount: 250_000, paidAmount: 500_000 });
    expect(m.text).toContain('separuh');
    expect(m.text).toMatch(/Rp\s?250\.000/);
  });

  it.each([
    ['refund-approved', 'FULL'],
    ['refund-completed', 'HALF'],
  ] as const)('carries no digits beyond the amounts when a Refund is %s (%s)', (event, tier) => {
    const m = tripFeeEmail({ ...BASE, event, tier, amount: 250_000, paidAmount: 500_000 });
    const runs = (m.text.match(/\d[\d.]*/g) ?? []).filter((run) => run !== '250.000' && run !== '500.000');
    expect(runs).toEqual([]);
  });

  it('escapes typed values in the HTML and keeps the subject on one line', () => {
    const m = tripFeeEmail({
      ...BASE,
      volunteerName: '<i>Rina</i>',
      tripTitle: 'Lombok <script>x</script>\nlagi',
      event: 'refund-completed',
      tier: 'FULL',
      amount: 1,
      paidAmount: 1,
    });
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<i>Rina</i>');
    expect(m.subject).not.toMatch(/\n/);
  });
});
