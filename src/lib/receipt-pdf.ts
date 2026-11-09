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
  return Array.from(text.replace(/[\r\n]+/g, ' '))
    .map((ch) => (ch.charCodeAt(0) <= 0xff ? ch : '?'))
    .join('');
}

function escapePdfText(text: string): string {
  return toLatin1(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function buildReceiptPdf(input: ReceiptPdfInput): Buffer {
  const lines: Array<{ size: number; text: string; gap: number }> = [
    { size: 20, text: 'Bukti Donasi', gap: 0 },
    ...(input.betaSandbox
      ? [{ size: 10, text: 'Donasi uji (beta): tidak ada uang sungguhan yang berpindah.', gap: 24 }]
      : []),
    { size: 10, text: 'Campaign', gap: 34 },
    { size: 13, text: input.campaignTitle, gap: 16 },
    { size: 10, text: 'Donor', gap: 26 },
    { size: 13, text: input.donorName, gap: 16 },
    { size: 10, text: 'Jumlah', gap: 26 },
    { size: 13, text: input.amountLabel, gap: 16 },
    { size: 10, text: 'Tanggal', gap: 26 },
    { size: 13, text: input.dateLabel, gap: 16 },
    { size: 10, text: 'Diterima oleh', gap: 26 },
    { size: 13, text: input.collectingEntityName, gap: 16 },
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
