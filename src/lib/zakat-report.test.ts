import { describe, it, expect, vi } from 'vitest';
import { zakatTransactions, zakatTransactionsCsv, type ZakatTransactionRow } from './zakat-report';

/**
 * The zakat transactions report (PKS pemenuhan 19, ADR 0028): only Donations
 * on zakat Campaigns, so zakat is never mixed into the general donation
 * figures, and every text cell is safe to open in a spreadsheet.
 */

function row(over: Partial<ZakatTransactionRow> = {}): ZakatTransactionRow {
  return {
    donationId: 'don-1',
    paidAt: new Date('2026-11-08T17:30:00.000Z'), // 2026-11-09 00:30 WIB
    amount: 300_000,
    status: 'confirmed',
    paymentMethod: 'qris',
    campaignTitle: 'Zakat melalui Yayasan Contoh',
    recipientName: 'Yayasan Contoh Peduli',
    donorName: 'Sari',
    sandbox: false,
    ...over,
  };
}

const lines = (csv: string) => csv.trimEnd().split('\r\n');

describe('zakatTransactionsCsv', () => {
  it('writes a header, one line per transaction with the WIB date, and a closing total of real confirmed money only', () => {
    const csv = zakatTransactionsCsv([
      row(),
      row({ donationId: 'don-2', amount: 200_000, status: 'pending' }),
      row({ donationId: 'don-3', amount: 100_000, sandbox: true }),
      row({ donationId: 'don-4', amount: 50_000 }),
    ]);
    const out = lines(csv);

    expect(out[0]).toBe('Tanggal (WIB),ID donasi,Nominal,Status,Metode,Campaign zakat,Lembaga penerima,Muzaki,Mode');
    expect(out[1]).toBe('2026-11-09,don-1,300000,confirmed,qris,Zakat melalui Yayasan Contoh,Yayasan Contoh Peduli,Sari,Nyata');
    expect(out[3]).toContain('Uji beta');
    // Pending and beta money is listed but never summed.
    expect(out[5]).toBe('"Total diterima (terkonfirmasi, bukan uji)",,350000,,,,,,');
  });

  it('shows an anonymous muzaki as anonymous, never the name', () => {
    const out = lines(zakatTransactionsCsv([row({ donorName: null })]));
    expect(out[1]).toContain('(anonim)');
    expect(out[1]).not.toContain('Sari');
  });

  it.each(['=HYPERLINK("http://x","klik")', '+1+1', '-2+3', '@SUM(A1)', '\t=1+1', ' =1+1'])(
    'neutralises a text cell that a spreadsheet would run as a formula: %j',
    (hostile) => {
      const csv = zakatTransactionsCsv([row({ campaignTitle: hostile, donorName: hostile, recipientName: hostile })]);
      const line = lines(csv)[1];
      for (const cell of line.split(',')) expect(cell).not.toMatch(/^"?[=+@\-\t]/);
      expect(line).toContain("'");
    },
  );

  it('quotes a cell with a comma, a quote or a line break', () => {
    const line = lines(zakatTransactionsCsv([row({ campaignTitle: 'Zakat, "maal"' })]))[1];
    expect(line).toContain('"Zakat, ""maal"""');
  });

  it('is only a header and a zero total when there is nothing', () => {
    const out = lines(zakatTransactionsCsv([]));
    expect(out).toHaveLength(2);
    expect(out[1]).toBe('"Total diterima (terkonfirmasi, bukan uji)",,0,,,,,,');
  });
});

describe('zakatTransactions', () => {
  it('reads only Donations on zakat Campaigns inside the WIB months asked for, oldest first', async () => {
    const findMany = vi.fn(async () => [
      {
        id: 'don-1',
        amount: 300_000,
        paymentStatus: 'confirmed',
        paymentMethod: 'qris',
        createdAt: new Date('2026-11-08T17:30:00.000Z'),
        isAnonymous: false,
        anonymisedAt: null,
        guestName: null,
        donor: { name: 'Sari' },
        campaign: { title: 'Zakat melalui Yayasan Contoh', collectingEntity: { name: 'Yayasan Contoh Peduli' } },
        payments: [{ sandbox: false, paidAt: new Date('2026-11-08T17:31:00.000Z') }],
      },
      {
        id: 'don-2',
        amount: 100_000,
        paymentStatus: 'confirmed',
        paymentMethod: 'qris',
        createdAt: new Date('2026-11-09T01:00:00.000Z'),
        isAnonymous: true,
        anonymisedAt: null,
        guestName: 'Budi',
        donor: null,
        campaign: { title: 'Zakat melalui Yayasan Contoh', collectingEntity: null },
        payments: [{ sandbox: true, paidAt: null }],
      },
    ]);

    const rows = await zakatTransactions({ donation: { findMany } } as never, { from: '2026-11', to: '2026-11' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          campaign: { kind: 'ZAKAT' },
          createdAt: { gte: new Date('2026-10-31T17:00:00.000Z'), lt: new Date('2026-11-30T17:00:00.000Z') },
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(rows).toEqual([
      expect.objectContaining({ donationId: 'don-1', donorName: 'Sari', recipientName: 'Yayasan Contoh Peduli', sandbox: false }),
      // Anonymous on the Campaign page means anonymous here too; a missing entity is blank, not a crash.
      expect.objectContaining({ donationId: 'don-2', donorName: null, recipientName: '', sandbox: true }),
    ]);
  });

  it('shows the name of neither an anonymised Donor nor a Guest Donor who asked to stay anonymous', async () => {
    const base = {
      id: 'd',
      amount: 1000,
      paymentStatus: 'confirmed',
      paymentMethod: 'qris',
      createdAt: new Date('2026-11-09T01:00:00.000Z'),
      isAnonymous: false,
      donor: null,
      campaign: { title: 'Z', collectingEntity: null },
      payments: [],
    };
    const findMany = vi.fn(async () => [
      { ...base, anonymisedAt: new Date(), guestName: null },
      { ...base, guestName: 'Tamu', anonymisedAt: null },
    ]);
    const rows = await zakatTransactions({ donation: { findMany } } as never, { from: '2026-11', to: '2026-11' });
    expect(rows.map((r) => r.donorName)).toEqual([null, 'Tamu']);
  });
});
