import { describe, it, expect } from 'vitest';
import { refundOutcomeEmail } from './refund-outcome';
import { SITE_IDENTITY } from '@/lib/site-identity';

/**
 * The Refund emails a Donor gets (ticket rilis-1-benda/68): paid, or failed.
 * Neither ever carries an account number: the input has no field for one,
 * so no caller can put it there.
 */
const BASE = {
  to: 'donor@example.test',
  donorName: 'Budi',
  subjectTitle: 'Bantu Korban Banjir',
  amount: 250_000,
} as const;

describe('refundOutcomeEmail', () => {
  it('tells the Donor a completed Refund was transferred, with the amount and the title', () => {
    const m = refundOutcomeEmail({ ...BASE, outcome: 'completed' });
    expect(m.to).toBe('donor@example.test');
    expect(m.subject).toBe('Refund untuk "Bantu Korban Banjir" sudah ditransfer');
    expect(m.text).toContain('Halo Budi,');
    expect(m.text).toMatch(/Rp\s?250\.000/);
    expect(m.text).toContain('rekening yang Anda berikan');
    expect(m.text).toContain(SITE_IDENTITY.contactEmail);
  });

  it('tells the Donor a failed Refund moved no money, and where to ask', () => {
    const m = refundOutcomeEmail({ ...BASE, outcome: 'failed' });
    expect(m.subject).toBe('Refund untuk "Bantu Korban Banjir" belum berhasil');
    expect(m.text).toContain('belum berhasil dilakukan');
    expect(m.text).toContain('tidak hilang');
    expect(m.text).toContain(SITE_IDENTITY.contactEmail);
  });

  it.each(['completed', 'failed'] as const)('carries no digits beyond the amount when %s', (outcome) => {
    const m = refundOutcomeEmail({ ...BASE, outcome });
    // Every digit run in the body is the amount's: no account number, no reference.
    const runs = (m.text.match(/\d[\d.]*/g) ?? []).filter((run) => run !== '250.000');
    expect(runs).toEqual([]);
  });

  it('escapes typed values in the HTML and keeps the subject on one line', () => {
    const m = refundOutcomeEmail({
      ...BASE,
      donorName: '<i>Budi</i>',
      subjectTitle: 'Banjir <script>x</script>\nlagi',
      outcome: 'failed',
    });
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<i>Budi</i>');
    expect(m.subject).not.toMatch(/\n/);
  });
});
