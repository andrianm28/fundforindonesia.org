import { describe, it, expect } from 'vitest';
import { suspensionEmail } from './suspension';

/**
 * The Suspension emails a Fundraiser gets (ticket rilis-1-benda/68; ADR
 * 0015): imposed and lifted, each with the Admin's reason.
 */
const BASE = {
  to: 'siti@example.test',
  fundraiserName: 'Siti',
  campaignTitle: 'Bantu Korban Banjir',
  reason: 'Laporan penipuan sedang diperiksa',
  campaignUrl: 'https://fundforindonesia.org/akun/kampanye-saya',
} as const;

describe('suspensionEmail', () => {
  it('tells the Fundraiser their Campaign was suspended, and why', () => {
    const m = suspensionEmail({ ...BASE, event: 'suspended' });
    expect(m.subject).toBe('Campaign "Bantu Korban Banjir" dibekukan (Suspended)');
    expect(m.text).toContain('Halo Siti,');
    expect(m.text).toContain('Alasan: Laporan penipuan sedang diperiksa');
    expect(m.text).toContain(BASE.campaignUrl);
  });

  it('tells the Fundraiser the Suspension was lifted, the status it returned to, and why', () => {
    const m = suspensionEmail({ ...BASE, reason: 'Klarifikasi diterima', event: 'lifted', statusLabel: 'Active' });
    expect(m.subject).toBe('Suspension Campaign "Bantu Korban Banjir" dicabut');
    expect(m.text).toContain('Campaign kini Active.');
    expect(m.text).toContain('Alasan: Klarifikasi diterima');
  });

  it('escapes the reason and the title in the HTML', () => {
    const m = suspensionEmail({
      ...BASE,
      campaignTitle: 'Banjir <script>x</script>',
      reason: '<a href="https://evil.example">klik</a>',
      event: 'suspended',
    });
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<a href="https://evil.example">');
    expect(m.html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;');
  });
});
