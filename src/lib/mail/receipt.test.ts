import { describe, it, expect } from 'vitest';
import { receiptEmail, resolveReceiptRecipient } from './receipt';

/**
 * The Receipt email (CONTEXT.md, Receipt): names the Collecting Entity as
 * who received the money, never the platform, and reaches the Donor whether
 * or not they chose to be shown anonymously on the Campaign page -- this is
 * their own proof, sent to them alone, so anonymity toward the public has no
 * bearing on it.
 */
describe('receiptEmail', () => {
  const base = {
    to: 'donor@example.com',
    donorName: 'Sari',
    campaignTitle: 'Bantu Sekolah Yatim',
    collectingEntityName: 'Yayasan Insan Ekonomi Mandiri',
    amount: 250_000,
    paidAt: new Date('2026-09-26T10:00:00.000Z'),
    printUrl: 'https://fundforindonesia.org/receipt/abc123',
  };

  it('names the Collecting Entity as who received the money, never the platform', () => {
    const email = receiptEmail(base);

    expect(email.text).toContain('Yayasan Insan Ekonomi Mandiri');
    expect(email.html).toContain('Yayasan Insan Ekonomi Mandiri');
    expect(email.text).not.toMatch(/Fund for Indonesia menerima/i);
  });

  it('opens with the beta notice, in text and html, only for a beta Receipt (ticket rilis-1-benda/92)', () => {
    const beta = receiptEmail({ ...base, betaSandbox: true });
    expect(beta.text.split('\n\n')[1]).toMatch(/^Beta, tidak ada uang nyata/);
    expect(beta.html).toMatch(/Beta, tidak ada uang nyata/);

    for (const plain of [receiptEmail(base), receiptEmail({ ...base, betaSandbox: false })]) {
      expect(plain.text).not.toMatch(/tidak ada uang nyata/i);
      expect(plain.html).not.toMatch(/tidak ada uang nyata/i);
    }
  });

  it('greets the Donor by name and carries the amount, campaign and print link', () => {
    const email = receiptEmail(base);

    expect(email.to).toBe('donor@example.com');
    expect(email.text).toContain('Sari');
    expect(email.text).toContain('Bantu Sekolah Yatim');
    expect(email.text).toContain('Rp250.000');
    expect(email.text).toContain(base.printUrl);
    expect(email.html).toContain(base.printUrl);
  });

  it('falls back to a generic greeting when no Donor name is known', () => {
    const email = receiptEmail({ ...base, donorName: null });

    expect(email.text).not.toContain('Halo null');
    expect(email.text.startsWith('Halo,')).toBe(true);
  });

  it('escapes a Donor- or Fundraiser-supplied name in the HTML body', () => {
    const email = receiptEmail({ ...base, donorName: '<script>alert(1)</script>' });

    expect(email.html).not.toContain('<script>alert(1)</script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('never says Invoice, tanda terima or kwitansi (CONTEXT.md, Receipt: avoid list)', () => {
    const email = receiptEmail(base);

    for (const banned of [/invoice/i, /tanda terima/i, /kwitansi/i]) {
      expect(email.subject).not.toMatch(banned);
      expect(email.text).not.toMatch(banned);
    }
  });
});

/**
 * The one place both the settlement webhook and the resend endpoint decide
 * who a Receipt email goes to and what it names as recipient of the money
 * -- kept here, not copied into each route, so the fallback order (donor vs
 * Guest Donor, missing Collecting Entity) has exactly one definition.
 */
describe('resolveReceiptRecipient', () => {
  const collectingEntityName = 'Yayasan Contoh';

  it("prefers a registered Donor's account email over a Guest Donor's plaintext one", () => {
    const result = resolveReceiptRecipient({
      donor: { email: 'donor@example.test', name: 'Donor Test' },
      guestEmail: 'guest@example.test',
      guestName: 'Guest Test',
      collectingEntityName,
    });

    expect(result).toEqual({
      ok: true,
      recipient: { recipientEmail: 'donor@example.test', donorName: 'Donor Test', collectingEntityName },
    });
  });

  it("falls back to the Guest Donor's plaintext guestEmail when there is no account", () => {
    const result = resolveReceiptRecipient({
      donor: null,
      guestEmail: 'guest@example.test',
      guestName: 'Guest Test',
      collectingEntityName,
    });

    expect(result).toEqual({
      ok: true,
      recipient: { recipientEmail: 'guest@example.test', donorName: 'Guest Test', collectingEntityName },
    });
  });

  it('refuses when there is no recipient email at all', () => {
    const result = resolveReceiptRecipient({
      donor: null,
      guestEmail: null,
      guestName: null,
      collectingEntityName,
    });

    expect(result).toEqual({ ok: false, reason: 'no recipient email on the Donation' });
  });

  it('refuses when the Campaign has no Collecting Entity, even with a recipient email', () => {
    const result = resolveReceiptRecipient({
      donor: { email: 'donor@example.test', name: 'Donor Test' },
      guestEmail: null,
      guestName: null,
      collectingEntityName: null,
    });

    expect(result).toEqual({ ok: false, reason: 'Campaign has no Collecting Entity' });
  });
});
