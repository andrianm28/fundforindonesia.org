/**
 * A Receipt as a downloadable PDF (CONTEXT.md, Receipt; PKS 3.8). Hand-written
 * on purpose: one page, text only, the built-in Helvetica font, so no
 * dependency is needed. All text is reduced to Latin-1 first, which keeps every
 * character one byte and so makes the xref offsets exact.
 */

export type ReceiptPdfInput = {
  campaignTitle: string;
  collectingEntityName: string;
  amountLabel: string;
  dateLabel: string;
  donorName: string;
  betaSandbox: boolean;
};

function toLatin1(text: string): string {
  // One `?` per code point, so an emoji does not become two.
  const typographic = text
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...');
  // Every control character (newlines, tabs, NUL ... DEL) becomes a space: a
  // stray one would be printed as a glyph or break the content stream.
  return Array.from(typographic.replace(/[\u0000-\u001F\u007F]+/g, ' '))
    .map((ch) => (ch.charCodeAt(0) <= 0xff ? ch : '?'))
    .join('');
}

/** Longest line of a value, in characters, before it wraps (13pt Helvetica on A4 with 56pt margins). */
export const RECEIPT_LINE_WIDTH = 70;
/** A value longer than this many lines is cut with an ellipsis, so one page always holds the Receipt. */
export const RECEIPT_MAX_VALUE_LINES = 4;

/**
 * Wraps `text` into lines of at most `width` characters on word boundaries; a
 * word longer than a line is hard-broken. Past `maxLines` the last line ends in
 * "..." instead.
 */
export function wrapReceiptText(text: string, width = RECEIPT_LINE_WIDTH, maxLines = RECEIPT_MAX_VALUE_LINES): string[] {
  const words = toLatin1(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (let word of words) {
    while (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length === 0) return [''];
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = `${last.slice(0, width - 3).trimEnd()}...`;
    return kept;
  }
  return lines;
}

function escapePdfText(text: string): string {
  return toLatin1(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** A value as one text line per wrapped line: the first sits 16pt under its label, the rest 15pt under the one before. */
function valueLines(value: string) {
  return wrapReceiptText(value).map((text, i) => ({ size: 13, text, gap: i === 0 ? 16 : 15 }));
}

export function buildReceiptPdf(input: ReceiptPdfInput): Buffer {
  const lines: Array<{ size: number; text: string; gap: number }> = [
    { size: 20, text: 'Bukti Donasi', gap: 0 },
    ...(input.betaSandbox
      ? [{ size: 10, text: 'Donasi uji (beta): tidak ada uang sungguhan yang berpindah.', gap: 24 }]
      : []),
    { size: 10, text: 'Campaign', gap: 34 },
    ...valueLines(input.campaignTitle),
    { size: 10, text: 'Donor', gap: 26 },
    ...valueLines(input.donorName),
    { size: 10, text: 'Jumlah', gap: 26 },
    { size: 13, text: input.amountLabel, gap: 16 },
    { size: 10, text: 'Tanggal', gap: 26 },
    { size: 13, text: input.dateLabel, gap: 16 },
    { size: 10, text: 'Diterima oleh', gap: 26 },
    ...valueLines(input.collectingEntityName),
  ];

  const ops = ['BT', '56 780 Td'];
  for (const line of lines) {
    if (line.gap) ops.push(`0 -${line.gap} Td`);
    ops.push(`/F1 ${line.size} Tf`, `(${escapePdfText(line.text)}) Tj`);
  }
  ops.push('ET');
  const stream = ops.join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return Buffer.from(out, 'latin1');
}
