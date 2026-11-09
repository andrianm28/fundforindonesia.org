import { describe, it, expect } from 'vitest';
import { buildReceiptPdf, wrapReceiptText } from './receipt-pdf';

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

describe('wrapReceiptText', () => {
  it('keeps a short value on one line', () => {
    expect(wrapReceiptText('Bantu Sekolah')).toEqual(['Bantu Sekolah']);
  });

  it('wraps on word boundaries at 70 characters', () => {
    const title = Array.from({ length: 30 }, (_, i) => `kata${i}`).join(' ');
    const lines = wrapReceiptText(title);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(70);
    expect(lines.join(' ')).toBe(title);
  });

  it('hard-breaks a word longer than a line', () => {
    const lines = wrapReceiptText('a'.repeat(150));
    expect(lines).toEqual(['a'.repeat(70), 'a'.repeat(70), 'a'.repeat(10)]);
  });

  it('caps the line count with an ellipsis', () => {
    const lines = wrapReceiptText('kata '.repeat(200), 70, 3);
    expect(lines).toHaveLength(3);
    expect(lines[2].endsWith('...')).toBe(true);
    expect(lines[2].length).toBeLessThanOrEqual(70);
  });

  it('turns control characters into spaces', () => {
    expect(wrapReceiptText('a\u0000b\tc\u007Fd\u001Fe\r\nf')).toEqual(['a b c d e f']);
  });
});

describe('buildReceiptPdf long values', () => {
  it('prints a long Campaign title on several lines, all inside the page and the xref intact', () => {
    const title = Array.from({ length: 40 }, (_, i) => `judul${i}`).join(' ');
    const pdf = buildReceiptPdf({ ...base, campaignTitle: title }).toString('latin1');
    const stream = /stream\n([\s\S]*?)\nendstream/.exec(pdf)![1];
    const texts = [...stream.matchAll(/^\((.*)\) Tj$/gm)].map((m) => m[1]);
    expect(texts.every((t) => t.length <= 70)).toBe(true);
    expect(texts.filter((t) => t.startsWith('judul')).length).toBeGreaterThan(1);
    const declared = Number(/\/Length (\d+)/.exec(pdf)![1]);
    expect(stream.length).toBe(declared);
  });

  it('writes no control character from a value into the content stream', () => {
    const pdf = buildReceiptPdf({ ...base, donorName: 'Si\u0000ri\u0007\tX\u007F' }).toString('latin1');
    const stream = /stream\n([\s\S]*?)\nendstream/.exec(pdf)![1];
    expect(stream).toContain('(Si ri X) Tj');
    expect(/[\u0000-\u0009\u000B-\u001F\u007F]/.test(stream)).toBe(false);
  });
});
