import { describe, it, expect } from 'vitest';
import { classifyMovement, parseRecapPeriod, splitZakatFromRecap, wibMonthOf, InvalidRecapPeriodError, type MovementSignature } from './finance-recap';
import { financeRecapCsv, neutraliseFormula } from './finance-recap-csv';
import { emptyAmounts, type FinanceRecap } from './finance-recap';

const leg = (over: Partial<MovementSignature>): MovementSignature => ({
  account: 'GATEWAY_CLEARING',
  direction: 'DEBIT',
  hasRefund: false,
  hasPayout: false,
  hasManual: false,
  hasWithdrawal: false,
  ...over,
});

describe('classifyMovement', () => {
  it('maps the four legs of a settlement to their columns', () => {
    expect(classifyMovement(leg({}))).toEqual({ column: 'donasiDiterima', sign: 1 });
    expect(classifyMovement(leg({ account: 'PROVIDER_FEE', direction: 'CREDIT' }))).toEqual({ column: 'biayaPenyedia', sign: 1 });
    expect(classifyMovement(leg({ account: 'PLATFORM_FEE', direction: 'CREDIT' }))).toEqual({ column: 'biayaPlatform', sign: 1 });
    expect(classifyMovement(leg({ account: 'ESCROW_HOLD', direction: 'CREDIT' }))).toEqual({ column: 'danaBersih', sign: 1 });
  });

  it('does not count a withdrawal to the bank or a payout completion as a donation', () => {
    expect(classifyMovement(leg({ direction: 'CREDIT', hasWithdrawal: true }))).toBeNull();
    expect(classifyMovement(leg({ direction: 'CREDIT', hasPayout: true }))).toBeNull();
    expect(classifyMovement(leg({ account: 'ESCROW_HOLD', direction: 'DEBIT' }))).toBeNull();
  });

  it('nets a Manual Contribution with its reversal, and a Payout with its failure', () => {
    // Counted once, on the intake side, whatever the target (Campaign or Program).
    expect(classifyMovement(leg({ account: 'MANUAL_INTAKE_CLEARING', direction: 'DEBIT', hasManual: true }))).toEqual({ column: 'kontribusiManual', sign: 1 });
    expect(classifyMovement(leg({ account: 'MANUAL_INTAKE_CLEARING', direction: 'CREDIT', hasManual: true }))).toEqual({ column: 'kontribusiManual', sign: -1 });
    expect(classifyMovement(leg({ account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', hasManual: true }))).toBeNull();
    expect(classifyMovement(leg({ account: 'CAMPAIGN_BALANCE', direction: 'DEBIT', hasPayout: true }))).toEqual({ column: 'payout', sign: 1 });
    expect(classifyMovement(leg({ account: 'TRIP_BALANCE', direction: 'CREDIT', hasPayout: true }))).toEqual({ column: 'payout', sign: -1 });
  });

  it('separates approved Refunds, frozen ones and the returned platform fee', () => {
    expect(classifyMovement(leg({ account: 'REFUND_CLEARING', direction: 'CREDIT', hasRefund: true }))).toEqual({ column: 'refundDisetujui', sign: 1 });
    expect(classifyMovement(leg({ account: 'FROZEN_BALANCE', direction: 'CREDIT', hasRefund: true }))).toEqual({ column: 'refundTertahan', sign: 1 });
    expect(classifyMovement(leg({ account: 'FROZEN_BALANCE', direction: 'DEBIT', hasRefund: true }))).toEqual({ column: 'refundTertahan', sign: -1 });
    expect(classifyMovement(leg({ account: 'PLATFORM_FEE', direction: 'DEBIT', hasRefund: true }))).toEqual({ column: 'biayaPlatformDikembalikan', sign: 1 });
    // A failed Refund undoes the approval; the paying debit does not.
    expect(classifyMovement(leg({ account: 'REFUND_CLEARING', direction: 'DEBIT', hasRefund: true, isRefundFailure: true }))).toEqual({ column: 'refundDisetujui', sign: -1 });
    // A refund's paid leg moves the clearing account, not the recap.
    expect(classifyMovement(leg({ account: 'REFUND_CLEARING', direction: 'DEBIT', hasRefund: true }))).toBeNull();
  });
});

describe('period', () => {
  it('starts a WIB month at 17:00 UTC the day before', () => {
    expect(parseRecapPeriod('2026-10', '2026-10')).toEqual({
      from: new Date('2026-09-30T17:00:00.000Z'),
      toExclusive: new Date('2026-10-31T17:00:00.000Z'),
    });
  });
  it('rejects a malformed or reversed range', () => {
    expect(() => parseRecapPeriod('2026-13', '2026-13')).toThrow(InvalidRecapPeriodError);
    expect(() => parseRecapPeriod('2026-10', '2026-09')).toThrow(InvalidRecapPeriodError);
  });
  it('names the WIB month of an instant', () => {
    expect(wibMonthOf(new Date('2026-09-30T17:00:00Z'))).toBe('2026-10');
    expect(wibMonthOf(new Date('2026-09-30T16:59:59Z'))).toBe('2026-09');
  });
});

describe('CSV', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx', ' =1+1', '  @SUM(A1)', '\n-1'])('neutralises %j', (cell) => {
    expect(neutraliseFormula(cell)).toBe(`'${cell}`);
  });
  it('leaves ordinary text alone', () => {
    expect(neutraliseFormula('Sumur Desa')).toBe('Sumur Desa');
  });

  it('writes the screen columns, neutralised titles, quoting and a Total row, with no donor field', () => {
    const recap: FinanceRecap = {
      rows: [
        { period: '2026-10', campaignId: 'c1', kind: 'ZAKAT', campaignTitle: '=cmd|"x", y', ...emptyAmounts(), donasiDiterima: 1000, payout: -5 },
        { period: '2026-10', campaignId: null, kind: null, campaignTitle: null, ...emptyAmounts(), payout: 7 },
      ],
      totals: { ...emptyAmounts(), donasiDiterima: 1000, payout: 2 },
    };
    const lines = financeRecapCsv(recap).split('\r\n');
    expect(lines[0]).toBe(
      'Periode,Jenis,Campaign,Donasi diterima,Biaya penyedia,Biaya platform,Dana bersih Campaign,Kontribusi manual,Refund disetujui,Refund tertahan,Biaya platform dikembalikan,Payout diinstruksikan (bersih dari gagal)',
    );
    expect(lines[1]).toBe(`2026-10,ZAKAT,"'=cmd|""x"", y",1000,0,0,0,0,0,0,0,-5`);
    expect(lines[2]).toBe('2026-10,,Tanpa Campaign (Volunteer Trip/Program),0,0,0,0,0,0,0,0,7');
    expect(lines[3]).toBe('Total,,,1000,0,0,0,0,0,0,0,2');
    expect(financeRecapCsv(recap)).not.toMatch(/donor|email|nama/i);
  });
});

describe('zakat apart from general donations (PKS pemenuhan 19, ADR 0028)', () => {
  const recap: FinanceRecap = {
    rows: [
      { period: '2026-11', campaignId: 'c1', kind: 'DONATION', campaignTitle: 'Banjir', ...emptyAmounts(), donasiDiterima: 1_000_000, danaBersih: 950_000, biayaPlatform: 50_000 },
      { period: '2026-11', campaignId: 'z1', kind: 'ZAKAT', campaignTitle: 'Zakat Yayasan', ...emptyAmounts(), donasiDiterima: 300_000, danaBersih: 300_000 },
      { period: '2026-11', campaignId: null, kind: null, campaignTitle: null, ...emptyAmounts(), kontribusiManual: 70_000 },
    ],
    totals: { ...emptyAmounts(), donasiDiterima: 1_300_000, danaBersih: 1_250_000, biayaPlatform: 50_000, kontribusiManual: 70_000 },
  };

  it('puts only the zakat Campaigns in the zakat half and everything else, trips and programs included, in the other', () => {
    const { zakat, general } = splitZakatFromRecap(recap);

    expect(zakat.rows.map((r) => r.campaignId)).toEqual(['z1']);
    expect(general.rows.map((r) => r.campaignId)).toEqual(['c1', null]);
    expect(zakat.totals.donasiDiterima).toBe(300_000);
    expect(general.totals.donasiDiterima).toBe(1_000_000);
  });

  it('gives two halves that add up to the whole, column by column', () => {
    const { zakat, general } = splitZakatFromRecap(recap);
    for (const column of Object.keys(recap.totals) as (keyof typeof recap.totals)[]) {
      expect(zakat.totals[column] + general.totals[column]).toBe(recap.totals[column]);
    }
  });

  it('has an empty zakat half, with zero totals, when there is no zakat', () => {
    const { zakat, general } = splitZakatFromRecap({ rows: [recap.rows[0]], totals: { ...emptyAmounts(), donasiDiterima: 1_000_000, danaBersih: 950_000, biayaPlatform: 50_000 } });
    expect(zakat).toEqual({ rows: [], totals: emptyAmounts() });
    expect(general.rows).toHaveLength(1);
  });

  it('writes both subtotals after the Total row of the CSV only when the period holds zakat', () => {
    const withZakat = financeRecapCsv(recap).trimEnd().split('\r\n');
    expect(withZakat.slice(-3)).toEqual([
      'Total,,,1300000,0,50000,1250000,70000,0,0,0,0',
      'Subtotal donasi umum (tanpa zakat),,,1000000,0,50000,950000,70000,0,0,0,0',
      'Subtotal zakat,,,300000,0,0,300000,0,0,0,0,0',
    ]);

    const without = financeRecapCsv({ rows: [recap.rows[0]], totals: splitZakatFromRecap(recap).general.totals }).trimEnd().split('\r\n');
    expect(without.some((l) => /Subtotal/.test(l))).toBe(false);
  });
});
