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
    expect(screen.getByText(/Dikembalikan ke Donor/)).toBeTruthy();
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
