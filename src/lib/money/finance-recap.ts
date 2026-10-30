import { Prisma, type PrismaClient, type Kind } from '@/generated/prisma/client';

/**
 * Rekap keuangan per periode x Kind x Campaign (ticket 79; PRD section 9,
 * owner decision C15, 2026-10-04).
 *
 * Read-only over money: every number is a sum of LedgerEntry rows, never of
 * Payment, Donation, Payout or Campaign.collectedAmount, so the recap equals
 * the ledger by construction and a reader can check a cell by summing the
 * entries it names. Nothing in this file writes.
 *
 * PERIOD. One row per calendar month in Asia/Jakarta (WIB, UTC+7, no DST), the
 * same reading as formatIndonesianDate (src/lib/utils/date.ts): an entry
 * posted at 2026-09-30T17:00Z belongs to October. `from` and `to` are 'YYYY-MM'
 * months, both inclusive. The month is computed in Postgres, not in JS, so the
 * process timezone cannot move an entry across a month boundary. LedgerEntry.
 * createdAt is a `timestamp` WITHOUT time zone holding UTC, hence the two-step
 * `AT TIME ZONE 'UTC'` then `AT TIME ZONE 'Asia/Jakarta'`: the second alone
 * reads the stored UTC as if it were WIB and shifts the month back.
 *
 * MODE. Only real money (`LedgerEntry.sandbox = false`). Beta (sandbox) money
 * is excluded permanently from every published figure (counted-payment.ts).
 *
 * CAMPAIGN. A settlement's gateway, fee and ESCROW_HOLD legs are posted in one
 * transaction, but only the ESCROW_HOLD leg carries a campaignId. The recap
 * therefore attributes a leg to its own campaignId, else to the campaignId of
 * any other leg of the same transactionId (all legs of a transaction share one
 * createdAt, so the month is the same). Legs of a Volunteer Trip, and of a
 * Program, carry no campaignId; they fall into the row with campaignId null
 * ("Tanpa Campaign"), whose Kind is null.
 *
 * WHAT EACH COLUMN IS (classifyMovement is the one definition; a leg that
 * matches none of these is not in the recap, e.g. PROGRAM_BALANCE, escrow
 * releases, Campaign Transfers, withdrawals to the bank):
 *
 *   donasiDiterima     GATEWAY_CLEARING DEBIT of a settlement: the Gross the
 *                      Donors paid. Settlement = no refundId/payoutId/
 *                      providerWithdrawalId on the leg.
 *   biayaPenyedia      PROVIDER_FEE CREDIT of a settlement.
 *   biayaPlatform      PLATFORM_FEE CREDIT of a settlement.
 *   danaBersih         ESCROW_HOLD CREDIT of a settlement: the net owed to the
 *                      Campaign. donasiDiterima = biayaPenyedia + biayaPlatform
 *                      + danaBersih for every row (paymentSettledLegs).
 *   kontribusiManual   CAMPAIGN_BALANCE credit minus debit with a
 *                      manualContributionId (off-gateway money, reversals net).
 *   refundDisetujui    REFUND_CLEARING CREDIT with a refundId: Refunds approved
 *                      (the full amount owed back to the Donor).
 *   refundTertahan     FROZEN_BALANCE credit minus debit with a refundId:
 *                      Refunds requested and not yet decided; an approved or
 *                      rejected one nets to zero.
 *   biayaPlatformDikembalikan  PLATFORM_FEE DEBIT with a refundId: the Platform
 *                      Fee share handed back with a Refund (net of rejected).
 *   payout             CAMPAIGN_BALANCE/TRIP_BALANCE debit minus credit with a
 *                      payoutId: Payouts instructed, net of failed ones.
 */

export const FINANCE_RECAP_COLUMNS = [
  'donasiDiterima',
  'biayaPenyedia',
  'biayaPlatform',
  'danaBersih',
  'kontribusiManual',
  'refundDisetujui',
  'refundTertahan',
  'biayaPlatformDikembalikan',
  'payout',
] as const;

export type FinanceRecapColumn = (typeof FINANCE_RECAP_COLUMNS)[number];
export type FinanceRecapAmounts = Record<FinanceRecapColumn, number>;

export interface FinanceRecapRow extends FinanceRecapAmounts {
  /** 'YYYY-MM', WIB. */
  period: string;
  campaignId: string | null;
  kind: Kind | null;
  campaignTitle: string | null;
}

export interface FinanceRecap {
  rows: FinanceRecapRow[];
  totals: FinanceRecapAmounts;
}

export interface MovementSignature {
  account: string;
  direction: 'DEBIT' | 'CREDIT';
  hasRefund: boolean;
  hasPayout: boolean;
  hasManual: boolean;
  hasWithdrawal: boolean;
}

export function emptyAmounts(): FinanceRecapAmounts {
  return Object.fromEntries(FINANCE_RECAP_COLUMNS.map((c) => [c, 0])) as FinanceRecapAmounts;
}

/** Which column a ledger leg adds to, and with which sign; null when none. */
export function classifyMovement(m: MovementSignature): { column: FinanceRecapColumn; sign: 1 | -1 } | null {
  const credit = m.direction === 'CREDIT';
  const settlement = !m.hasRefund && !m.hasPayout && !m.hasWithdrawal && !m.hasManual;

  if (settlement) {
    if (m.account === 'GATEWAY_CLEARING' && !credit) return { column: 'donasiDiterima', sign: 1 };
    if (m.account === 'PROVIDER_FEE' && credit) return { column: 'biayaPenyedia', sign: 1 };
    if (m.account === 'PLATFORM_FEE' && credit) return { column: 'biayaPlatform', sign: 1 };
    if (m.account === 'ESCROW_HOLD' && credit) return { column: 'danaBersih', sign: 1 };
  }
  if (m.hasManual && m.account === 'CAMPAIGN_BALANCE') {
    return { column: 'kontribusiManual', sign: credit ? 1 : -1 };
  }
  if (m.hasRefund) {
    if (m.account === 'REFUND_CLEARING' && credit) return { column: 'refundDisetujui', sign: 1 };
    if (m.account === 'FROZEN_BALANCE') return { column: 'refundTertahan', sign: credit ? 1 : -1 };
    if (m.account === 'PLATFORM_FEE' && !credit) return { column: 'biayaPlatformDikembalikan', sign: 1 };
    if (m.account === 'PLATFORM_FEE' && credit) return { column: 'biayaPlatformDikembalikan', sign: -1 };
  }
  if (m.hasPayout && (m.account === 'CAMPAIGN_BALANCE' || m.account === 'TRIP_BALANCE')) {
    return { column: 'payout', sign: credit ? -1 : 1 };
  }
  return null;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const WIB_OFFSET_MS = 7 * 3600_000;

export class InvalidRecapPeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRecapPeriodError';
  }
}

/** The instant a WIB month starts, as UTC. `monthsAfter` 1 gives its exclusive end. */
function wibMonthStart(month: string, monthsAfter = 0): Date {
  const m = MONTH.exec(month);
  if (!m) throw new InvalidRecapPeriodError(`Periode "${month}" harus berformat YYYY-MM.`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + monthsAfter, 1) - WIB_OFFSET_MS);
}

export function parseRecapPeriod(from: string, to: string): { from: Date; toExclusive: Date } {
  const start = wibMonthStart(from);
  const toExclusive = wibMonthStart(to, 1);
  if (toExclusive <= start) throw new InvalidRecapPeriodError('Periode akhir tidak boleh sebelum periode awal.');
  return { from: start, toExclusive };
}

/** The WIB month of an instant as 'YYYY-MM'. */
export function wibMonthOf(now: Date): string {
  const wib = new Date(now.getTime() + WIB_OFFSET_MS);
  return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, '0')}`;
}

interface RawRow {
  period: string;
  campaignId: string | null;
  account: string;
  direction: 'DEBIT' | 'CREDIT';
  hasRefund: boolean;
  hasPayout: boolean;
  hasManual: boolean;
  hasWithdrawal: boolean;
  total: bigint | number;
}

export async function financeRecap(
  db: Pick<PrismaClient, '$queryRaw' | 'campaign'>,
  range: { from: string; to: string },
): Promise<FinanceRecap> {
  const { from, toExclusive } = parseRecapPeriod(range.from, range.to);

  const raw = await db.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT period, "campaignId", account::text AS account, direction::text AS direction,
           "hasRefund", "hasPayout", "hasManual", "hasWithdrawal", SUM(amount) AS total
    FROM (
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS period,
             COALESCE("campaignId", MAX("campaignId") OVER (PARTITION BY "transactionId")) AS "campaignId",
             account, direction, amount,
             ("refundId" IS NOT NULL) AS "hasRefund",
             ("payoutId" IS NOT NULL) AS "hasPayout",
             ("manualContributionId" IS NOT NULL) AS "hasManual",
             ("providerWithdrawalId" IS NOT NULL) AS "hasWithdrawal"
      FROM "LedgerEntry"
      WHERE sandbox = false AND "createdAt" >= ${from} AND "createdAt" < ${toExclusive}
    ) legs
    GROUP BY period, "campaignId", account, direction, "hasRefund", "hasPayout", "hasManual", "hasWithdrawal"
  `);

  const byKey = new Map<string, FinanceRecapRow>();
  for (const r of raw) {
    const hit = classifyMovement(r);
    if (!hit) continue;
    const key = `${r.period}|${r.campaignId ?? ''}`;
    let row = byKey.get(key);
    if (!row) {
      row = { period: r.period, campaignId: r.campaignId, kind: null, campaignTitle: null, ...emptyAmounts() };
      byKey.set(key, row);
    }
    row[hit.column] += hit.sign * Number(r.total);
  }

  const ids = [...new Set([...byKey.values()].map((r) => r.campaignId).filter((x): x is string => !!x))];
  const campaigns = ids.length
    ? await db.campaign.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, kind: true } })
    : [];
  const meta = new Map(campaigns.map((c) => [c.id, c]));

  const rows = [...byKey.values()].map((row) => {
    const c = row.campaignId ? meta.get(row.campaignId) : undefined;
    return { ...row, kind: c?.kind ?? null, campaignTitle: c?.title ?? null };
  });
  rows.sort(
    (a, b) =>
      a.period.localeCompare(b.period) ||
      (a.kind ?? '~').localeCompare(b.kind ?? '~') ||
      (a.campaignTitle ?? '~').localeCompare(b.campaignTitle ?? '~') ||
      (a.campaignId ?? '').localeCompare(b.campaignId ?? ''),
  );

  const totals = emptyAmounts();
  for (const row of rows) for (const c of FINANCE_RECAP_COLUMNS) totals[c] += row[c];
  return { rows, totals };
}
