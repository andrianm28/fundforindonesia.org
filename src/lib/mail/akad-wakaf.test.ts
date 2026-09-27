import { describe, it, expect } from 'vitest';
import { receiptEmail } from './receipt';
import { withAkadWakaf } from './akad-wakaf';

/**
 * The Akad Wakaf (CONTEXT.md, Akad Wakaf; ADR 0010): named the same
 * Collecting Entity as the Receipt (as nazhir -- there is no separate
 * Nazhir entity in this schema), sent as one delivery alongside the Receipt
 * rather than a second email.
 */
describe('withAkadWakaf', () => {
  const receipt = receiptEmail({
    to: 'wakif@example.com',
    donorName: 'Sari',
    campaignTitle: 'Wakaf Pembangunan Masjid Al-Ikhlas',
    collectingEntityName: 'Yayasan Contoh',
    amount: 500_000,
    paidAt: new Date('2026-09-26T10:00:00.000Z'),
    printUrl: 'https://fundforindonesia.org/receipt/abc123',
  });

  const akadWakafInput = {
    wakifName: 'Sari',
    amount: 500_000,
    purpose: 'Wakaf Pembangunan Masjid Al-Ikhlas',
    nazhirName: 'Yayasan Contoh',
    printUrl: 'https://fundforindonesia.org/akad-wakaf/def456',
  };

  it('keeps the Receipt as one delivery, only appending the Akad Wakaf section', () => {
    const merged = withAkadWakaf(receipt, akadWakafInput);

    expect(merged.to).toBe(receipt.to);
    expect(merged.subject).toBe(receipt.subject);
    expect(merged.text).toContain(receipt.text);
    expect(merged.html).toContain(receipt.html);
  });

  it('carries the Wakif, the amount, the purpose and the nazhir', () => {
    const merged = withAkadWakaf(receipt, akadWakafInput);

    expect(merged.text).toContain('Sari');
    expect(merged.text).toContain('Rp500.000');
    expect(merged.text).toContain('Wakaf Pembangunan Masjid Al-Ikhlas');
    expect(merged.text).toContain('Yayasan Contoh');
    expect(merged.text).toContain(akadWakafInput.printUrl);
    expect(merged.html).toContain(akadWakafInput.printUrl);
  });

  it('falls back to a generic label when no Wakif name is known', () => {
    const merged = withAkadWakaf(receipt, { ...akadWakafInput, wakifName: null });

    expect(merged.text).toContain('Wakif: Wakif');
  });

  it('escapes a Fundraiser- or Donor-supplied name in the HTML section', () => {
    const merged = withAkadWakaf(receipt, { ...akadWakafInput, purpose: '<script>alert(1)</script>' });

    expect(merged.html).not.toContain('<script>alert(1)</script>');
    expect(merged.html).toContain('&lt;script&gt;');
  });
});
