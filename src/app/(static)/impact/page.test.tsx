import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ledgerFixture, makeImpactDb, type ImpactDbData } from '../../../../tests/support/in-memory-impact-db';

/**
 * The public Impact & Transparency page (ticket 25; PRD FFI-14). What a
 * visitor is promised is that the six lines add up exactly to the collected
 * figure, so the test reads the amounts off the rendered rows and adds them
 * up itself rather than trusting the number the page printed as its total.
 */

const holder = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('../../../../tests/support/in-memory-impact-db').makeImpactDb>,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_target, key: string) => (holder.db.prisma as Record<string, unknown>)[key] }),
}));

import ImpactPage from './page';

const CAMPAIGN = { id: 'campaign-1', title: 'Pemulihan Gudang', isDemo: false, location: 'Jawa Barat' };

function settledOnly(): Partial<ImpactDbData> {
  const ledger = ledgerFixture();
  ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 3_000, platformFee: 5_000 });
  return {
    campaigns: [CAMPAIGN],
    payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
    ledgerEntries: ledger.rows,
  };
}

async function renderPage(searchParams: Record<string, string> = {}) {
  return render(await ImpactPage({ searchParams: Promise.resolve(searchParams) }));
}

/** The rupiah the page prints for one of the six lines, parsed back to a number. */
function renderedLine(label: string): number {
  const cell = screen.getByTestId(`impact-line-${label}`);
  const text = cell.textContent ?? '';
  const digits = text.replace(/[^0-9]/g, '');
  return Number(digits);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ImpactPage', () => {
  it('shows the collected figure and six lines that add up to it', async () => {
    holder.db = makeImpactDb(settledOnly());

    await renderPage();

    expect(screen.getByTestId('impact-collected').textContent).toContain('Rp100.000');

    // 92 000 held in Escrow Hold, 5 000 Platform Fee, 3 000 Provider Fee.
    const rendered = screen
      .getAllByTestId(/^impact-line-/)
      .map((row) => Number((row.textContent ?? '').replace(/[^0-9]/g, '')));
    expect(rendered).toHaveLength(6);
    expect(rendered.reduce((total, amount) => total + amount, 0)).toBe(100_000);
    expect(rendered).toEqual([0, 0, 92_000, 0, 5_000, 3_000]);
  });

  it('names every line, so a visitor can see where the money went', async () => {
    holder.db = makeImpactDb(settledOnly());

    await renderPage();

    expect(screen.getByText(/Tersalurkan ke Fundraiser/)).toBeTruthy();
    // Matched on the leading verb, not the tail: this test is about every line
    // being NAMED, and the returned line's name now opens with "Disediakan".
    expect(screen.getByText(/^Refund/)).toBeTruthy();
    // The label names the kind, not the stage: "Dikembalikan" would claim the
    // money is home when refundPaidLegs has no production caller at all.
    expect(screen.queryByText(/^Dikembalikan/)).toBeNull();
    expect(screen.queryByText(/dikomit/)).toBeNull();
    expect(screen.getByText(/Ditahan di Escrow Hold/)).toBeTruthy();
    expect(screen.getByText(/Tersedia di Campaign Balance/)).toBeTruthy();
    expect(screen.getByText(/Platform Fee yang tidak dikembalikan/)).toBeTruthy();
    expect(screen.getByText(/Provider Fee yang diterima/)).toBeTruthy();
  });

  it('shows a refunded Donation as a returned line while still counting it as collected', async () => {
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 3_000, platformFee: 5_000 });
    ledger.refundRequest({
      refundId: 'refund-1',
      campaignId: 'campaign-1',
      amount: 100_000,
      source: 'ESCROW_HOLD',
      platformFeePortion: 5_000,
      providerFeePortion: 3_000,
    });
    ledger.refundApproval({
      refundId: 'refund-1',
      campaignId: 'campaign-1',
      amount: 100_000,
      source: 'ESCROW_HOLD',
      shortfall: 0,
    });
    holder.db = makeImpactDb({
      campaigns: [CAMPAIGN],
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      refunds: [{ id: 'refund-1', paymentId: 'payment-1' }],
      ledgerEntries: ledger.rows,
    });

    await renderPage();

    expect(screen.getByTestId('impact-collected').textContent).toContain('Rp100.000');
    expect(renderedLine('returnedToDonors')).toBe(100_000);
  });

  it('tells a Donor that the returned line includes money not yet sent to them', async () => {
    // The returned line is REFUND_CLEARING plus the Frozen Balance of Refunds
    // nobody has approved yet, so at this moment none of the 100 000 has been
    // transferred to anybody. Any label that opens with a completed-tense verb
    // is a claim about the Donor's bank account that the ledger does not
    // support, and it is the one claim on this page a Donor would notice being
    // wrong. The three assertions below are the regression guards, and they are
    // about the WORDING rather than the figure, because the figure was already
    // right and still misread.
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 3_000, platformFee: 5_000 });
    ledger.refundRequest({
      refundId: 'refund-1',
      campaignId: 'campaign-1',
      amount: 100_000,
      source: 'ESCROW_HOLD',
      platformFeePortion: 5_000,
      providerFeePortion: 3_000,
    });
    holder.db = makeImpactDb({
      campaigns: [CAMPAIGN],
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      refunds: [{ id: 'refund-1', paymentId: 'payment-1' }],
      ledgerEntries: ledger.rows,
    });

    await renderPage();

    expect(renderedLine('returnedToDonors')).toBe(100_000);
    // The label names the kind and stops there. A completed-tense verb
    // ("Dikembalikan") is false for every rupiah in this line today:
    // refundPaidLegs has no production caller, so nothing here has been
    // transferred. The stage belongs in the sentence under the table, where it
    // is read next to the number rather than standing in for it.
    expect(screen.getByText(/^Refund/)).toBeTruthy();
    expect(screen.queryByText(/^Dikembalikan/)).toBeNull();
    expect(screen.queryByText(/dikomit/)).toBeNull();
    // And the disclosure is in the paragraph under the table and in the notes,
    // which are the two places a Donor actually reads -- not only in a label
    // too short to carry it.
    expect(screen.getByText(/tidak berarti uangnya sudah sampai di rekening Donor/)).toBeTruthy();
    expect(screen.getByText(/sudah disiapkan untuk dikembalikan tetapi belum ditransfer/)).toBeTruthy();
  });

  it('stops telling a Donor their refund is frozen inside a dispute window', async () => {
    // The Escrow Hold line is now money still inside the waiting period and
    // nothing else: a Refund's freeze has moved to the returned line, so the
    // old label claimed a dispute window around money a Donor is simply owed.
    // A Donor reading that would think their own refund was contested.
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 3_000, platformFee: 5_000 });
    ledger.refundRequest({
      refundId: 'refund-1',
      campaignId: 'campaign-1',
      amount: 100_000,
      source: 'ESCROW_HOLD',
      platformFeePortion: 5_000,
      providerFeePortion: 3_000,
    });
    holder.db = makeImpactDb({
      campaigns: [CAMPAIGN],
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      refunds: [{ id: 'refund-1', paymentId: 'payment-1' }],
      ledgerEntries: ledger.rows,
    });

    await renderPage();

    expect(renderedLine('heldInEscrowHold')).toBe(0);
    expect(screen.queryByText(/dibekukan menunggu Refund/)).toBeNull();
    expect(screen.getByText(/Ditahan di Escrow Hold/)).toBeTruthy();
  });

  it('keeps the platform money the platform absorbs out of the collected lines and says so', async () => {
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 3_000, platformFee: 5_000 });
    ledger.refundRequest({
      refundId: 'refund-1',
      campaignId: 'campaign-1',
      amount: 100_000,
      source: 'ESCROW_HOLD',
      platformFeePortion: 5_000,
      providerFeePortion: 3_000,
    });
    ledger.refundApproval({
      refundId: 'refund-1',
      campaignId: 'campaign-1',
      amount: 100_000,
      source: 'ESCROW_HOLD',
      shortfall: 0,
    });
    holder.db = makeImpactDb({
      campaigns: [CAMPAIGN],
      payments: [{ id: 'payment-1', campaignId: 'campaign-1' }],
      refunds: [{ id: 'refund-1', paymentId: 'payment-1' }],
      ledgerEntries: ledger.rows,
    });

    await renderPage();

    // The provider never returns its fee on a Gross refund, so the platform
    // carries it -- shown apart from the six lines, which is what makes the
    // six add up to the collected figure.
    expect(screen.getByTestId('impact-platform-cost').textContent).toContain('Rp3.000');
  });

  it('reads zero beneficiaries rather than inventing one, and explains why', async () => {
    holder.db = makeImpactDb(settledOnly());

    await renderPage();

    expect(screen.getByTestId('impact-beneficiaries').textContent).toContain('0 orang');
    expect(screen.getAllByText(/Usage Report/).length).toBeGreaterThan(0);
  });

  it('filters by location, and says which location is being shown', async () => {
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 0, platformFee: 0 });
    ledger.settle({ paymentId: 'payment-2', campaignId: 'campaign-2', gross: 500_000, providerFee: 0, platformFee: 0 });
    holder.db = makeImpactDb({
      campaigns: [CAMPAIGN, { id: 'campaign-2', title: 'Beasiswa Anak Pesisir', isDemo: false, location: 'Bali' }],
      payments: [
        { id: 'payment-1', campaignId: 'campaign-1' },
        { id: 'payment-2', campaignId: 'campaign-2' },
      ],
      ledgerEntries: ledger.rows,
    });

    await renderPage({ location: 'Bali' });

    expect(screen.getByTestId('impact-collected').textContent).toContain('Rp500.000');
    expect(screen.getByTestId('impact-location-filter').textContent).toContain('Bali');
  });

  it('counts no Demo Campaign, so the totals here agree with a catalogue that shows none', async () => {
    // The same exclusion the catalogue applies to what it lists
    // (src/lib/subject-guard.ts) has to apply to what this page adds up, or
    // the page would report money a visitor cannot find anywhere
    // (CONTEXT.md, Demo Campaign; prd-compliance 26).
    const ledger = ledgerFixture();
    ledger.settle({ paymentId: 'payment-demo', campaignId: 'campaign-demo', gross: 25_000_000, providerFee: 0, platformFee: 0 });
    ledger.settle({ paymentId: 'payment-1', campaignId: 'campaign-1', gross: 100_000, providerFee: 3_000, platformFee: 5_000 });
    holder.db = makeImpactDb({
      campaigns: [
        { id: 'campaign-demo', title: 'Bantu korban bencana (contoh)', isDemo: true, location: 'Jawa Barat' },
        CAMPAIGN,
      ],
      payments: [
        { id: 'payment-demo', campaignId: 'campaign-demo' },
        { id: 'payment-1', campaignId: 'campaign-1' },
      ],
      ledgerEntries: ledger.rows,
    });

    await renderPage();

    expect(screen.getByTestId('impact-collected').textContent).toContain('Rp100.000');
    const rendered = screen
      .getAllByTestId(/^impact-line-/)
      .map((row) => Number((row.textContent ?? '').replace(/[^0-9]/g, '')));
    expect(rendered.reduce((total, amount) => total + amount, 0)).toBe(100_000);
  });

  it('shows no figures at all, loudly, when the six lines cannot be reconciled', async () => {
    // A Payout instructed out of a Campaign that never settled a Payment.
    const ledger = ledgerFixture();
    ledger.raw([
      { account: 'GATEWAY_CLEARING', direction: 'DEBIT', amount: 500_000 },
      { account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount: 500_000, campaignId: 'campaign-1' },
    ]);
    ledger.payoutInstruction({ payoutId: 'payout-1', campaignId: 'campaign-1', amount: 500_000 });
    holder.db = makeImpactDb({
      campaigns: [CAMPAIGN],
      payouts: [{ id: 'payout-1', campaignId: 'campaign-1', amount: 500_000, status: 'APPROVED' }],
      ledgerEntries: ledger.rows,
    });

    await renderPage();

    expect(screen.getByTestId('impact-does-not-reconcile')).toBeTruthy();
    expect(screen.queryByTestId('impact-collected')).toBeNull();
    expect(screen.queryAllByTestId(/^impact-line-/)).toHaveLength(0);
  });
});
