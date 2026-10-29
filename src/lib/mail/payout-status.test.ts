import { describe, it, expect } from 'vitest';
import { payoutStatusEmail, type PayoutStatusEmailInput } from './payout-status';

/**
 * The Payout emails a Fundraiser gets (ticket rilis-1-benda/68): approved,
 * and completed with the transfer reference. Every typed value is escaped
 * in the HTML, and the destination is named by its bank only.
 */
const BASE = {
  to: 'siti@example.test',
  fundraiserName: 'Siti',
  subjectTitle: 'Bantu Korban Banjir',
  subjectKind: 'campaign',
  amount: 1_500_000,
  bankCode: 'BCA',
  statusUrl: 'https://fundforindonesia.org/akun/kampanye-saya/bantu/pencairan',
} as const;

function mail(overrides: Partial<PayoutStatusEmailInput> = {}) {
  return payoutStatusEmail({ ...BASE, event: 'approved', ...overrides } as PayoutStatusEmailInput);
}

describe('payoutStatusEmail', () => {
  it('tells the Fundraiser an approved Payout will be transferred, with the amount and the bank', () => {
    const m = mail();
    expect(m.to).toBe('siti@example.test');
    expect(m.subject).toBe('Pencairan dana "Bantu Korban Banjir" disetujui');
    expect(m.text).toContain('Halo Siti,');
    expect(m.text).toMatch(/Rp\s?1\.500\.000/);
    expect(m.text).toContain('Campaign "Bantu Korban Banjir"');
    expect(m.text).toContain('rekening BCA terverifikasi');
    expect(m.text).toContain(BASE.statusUrl);
  });

  it('tells the Fundraiser a completed Payout was sent, with the transfer reference and the Usage Report it now owes', () => {
    const m = mail({ event: 'completed', proofReference: 'TRX-2026-001' } as Partial<PayoutStatusEmailInput>);
    expect(m.subject).toBe('Dana "Bantu Korban Banjir" sudah ditransfer');
    expect(m.text).toContain('Nomor referensi transfer: TRX-2026-001');
    expect(m.text).toContain('Usage Report');
  });

  it('names a Volunteer Trip as such, and asks it for no Usage Report', () => {
    const m = mail({ subjectKind: 'trip', event: 'completed', proofReference: 'TRX-1' } as Partial<PayoutStatusEmailInput>);
    expect(m.text).toContain('Volunteer Trip "Bantu Korban Banjir"');
    expect(m.text).not.toContain('Usage Report');
  });

  it('escapes every typed value in the HTML and keeps the subject on one line', () => {
    const m = mail({
      fundraiserName: '<b>Siti</b>',
      subjectTitle: 'Banjir <script>alert(1)</script>\nBaris',
      event: 'completed',
      proofReference: '"><img src=x>',
    } as Partial<PayoutStatusEmailInput>);
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<b>Siti</b>');
    expect(m.html).not.toContain('<img src=x>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.subject).not.toMatch(/\n/);
  });

  it('greets without a name when the Fundraiser has none', () => {
    expect(mail({ fundraiserName: null }).text.startsWith('Halo,')).toBe(true);
  });
});
