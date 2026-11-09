import { describe, it, expect } from 'vitest';
import { buildReceiptPdf } from './receipt-pdf';

const base = {
  campaignTitle: 'Bantu Sekolah Yatim',
  collectingEntityName: 'Yayasan Insan Ekonomi Mandiri',
  amountLabel: 'Rp250.000',
  dateLabel: '26 September 2026',
  donorName: 'Sari',
  betaSandbox: false,
};

describe('buildReceiptPdf', () => {
  it('produces a PDF whose xref offsets point at their objects', () => {
    const pdf = buildReceiptPdf(base).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const entries = [...pdf.slice(xrefAt).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(entries.length).toBeGreaterThanOrEqual(5);
    entries.forEach((offset, i) => {
      expect(pdf.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });

  it('declares a /Length that matches the content stream', () => {
    const pdf = buildReceiptPdf(base).toString('latin1');
    const declared = Number(/\/Length (\d+)/.exec(pdf)![1]);
    const stream = /stream\n([\s\S]*?)\nendstream/.exec(pdf)![1];
    expect(stream.length).toBe(declared);
  });

  it('shows the receipt facts', () => {
    const pdf = buildReceiptPdf(base).toString('latin1');
    for (const text of ['Bukti Donasi', 'Bantu Sekolah Yatim', 'Rp250.000', '26 September 2026', 'Sari', 'Yayasan Insan Ekonomi Mandiri']) {
      expect(pdf).toContain(text);
    }
    expect(pdf).not.toContain('beta');
  });

  it('escapes parentheses and backslashes in text', () => {
    const pdf = buildReceiptPdf({ ...base, campaignTitle: 'A (b) \\ c' }).toString('latin1');
    expect(pdf).toContain('A \\(b\\) \\\\ c');
  });

  it('replaces characters outside Latin-1 so offsets stay byte-exact', () => {
    const pdf = buildReceiptPdf({ ...base, campaignTitle: 'Bantu 😀 Anak' });
    expect(pdf.toString('latin1')).toContain('Bantu ? Anak');
  });

  it('adds the beta notice for a sandbox Payment', () => {
    const pdf = buildReceiptPdf({ ...base, betaSandbox: true }).toString('latin1');
    expect(pdf).toContain('beta');
  });
});
