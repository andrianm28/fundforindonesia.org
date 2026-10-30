import { FINANCE_RECAP_COLUMNS, type FinanceRecap } from './finance-recap';

/** Header labels, shared by the screen and the CSV so the columns cannot drift apart. */
export const FINANCE_RECAP_HEADERS = {
  period: 'Periode',
  kind: 'Jenis',
  campaign: 'Campaign',
  donasiDiterima: 'Donasi diterima',
  biayaPenyedia: 'Biaya penyedia',
  biayaPlatform: 'Biaya platform',
  danaBersih: 'Dana bersih Campaign',
  kontribusiManual: 'Kontribusi manual',
  refundDisetujui: 'Refund disetujui',
  refundTertahan: 'Refund tertahan',
  biayaPlatformDikembalikan: 'Biaya platform dikembalikan',
  payout: 'Payout diinstruksikan (bersih dari gagal)',
} as const;

export const NO_CAMPAIGN_LABEL = 'Tanpa Campaign (Volunteer Trip/Program)';

/**
 * Spreadsheet formula injection: a text cell that starts with = + - @ (also after leading whitespace), a tab or
 * a carriage return is run as a formula by Excel and Sheets. Prefix it with an
 * apostrophe, which they show as nothing and treat as "this is text".
 * Applied to every TEXT cell (Campaign titles are user input); amounts are
 * written as bare integers and never pass through here.
 */
export function neutraliseFormula(text: string): string {
  return /^\s*[=+\-@]|^[\t\r]/.test(text) ? `'${text}` : text;
}

function quote(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const textCell = (text: string) => quote(neutraliseFormula(text));

/**
 * The recap as CSV: the same columns, in the same order, as the screen, plus a
 * closing Total row. Campaign titles and ids are the only free text; no Donor
 * field (name, email, message) exists in the recap's data at all.
 */
export function financeRecapCsv(recap: FinanceRecap): string {
  const header = [
    FINANCE_RECAP_HEADERS.period,
    FINANCE_RECAP_HEADERS.kind,
    FINANCE_RECAP_HEADERS.campaign,
    ...FINANCE_RECAP_COLUMNS.map((c) => FINANCE_RECAP_HEADERS[c]),
  ].map(textCell);
  const lines = [header.join(',')];
  for (const row of recap.rows) {
    lines.push(
      [
        textCell(row.period),
        textCell(row.kind ?? ''),
        textCell(row.campaignTitle ?? NO_CAMPAIGN_LABEL),
        ...FINANCE_RECAP_COLUMNS.map((c) => String(row[c])),
      ].join(','),
    );
  }
  lines.push(
    [textCell('Total'), '', '', ...FINANCE_RECAP_COLUMNS.map((c) => String(recap.totals[c]))].join(','),
  );
  return lines.join('\r\n') + '\r\n';
}
