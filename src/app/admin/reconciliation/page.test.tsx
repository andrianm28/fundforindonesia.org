import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({})),
    partnerOrganisation: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/money/reconciliation-report', () => ({ buildReconciliationReport: vi.fn() }));
vi.mock('@/lib/money/payment-reconciliation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/money/payment-reconciliation')>()),
  listReconciliationQueue: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { prisma } from '@/lib/prisma';
import { buildReconciliationReport, type ReconciliationReport } from '@/lib/money/reconciliation-report';
import { listReconciliationQueue, type ReconciliationQueue } from '@/lib/money/payment-reconciliation';
import AdminReconciliationPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const AT = new Date('2026-10-29T03:00:00.000Z');

function cleanReport(over: Partial<ReconciliationReport> = {}): ReconciliationReport {
  return {
    generatedAt: AT.toISOString(),
    unbalancedTransactions: [],
    negativeBalances: [],
    tripNegativeBalances: [],
    preLedger: [],
    caveat: '',
    mismatches: [],
    strandedEscrow: [],
    tripStrandedEscrow: [],
    deferredEscrowWatchdog: [],
    tripDeferredEscrowWatchdog: [],
    subjectlessPayments: [],
    pendingRefunds: [],
    pendingManualContributions: [],
    orphanedCancelledRegistrationPayments: [],
    providerReconciliation: {
      pots: [{ provider: 'sumopod', debited: 1_000, credited: 0, balance: 1_000 }],
      providerBalanceTotal: 1_000,
      unattributedBalance: 0,
      perProviderIsExact: true,
      withdrawals: [],
      divergence: { totalDifference: 0, providersWithDivergence: [] },
      collectionAccountBalance: 0,
      collectedByKind: [],
      caveat: '',
    },
    stuckPayouts: { processing: [], approvedWithoutProviderRef: [] },
    ...over,
  };
}

function emptyQueue(over: Partial<ReconciliationQueue> = {}): ReconciliationQueue {
  return { webhookEvents: [], chargeWriteFailures: [], ...over };
}

async function renderPage(report: ReconciliationReport, queue: ReconciliationQueue = emptyQueue()) {
  vi.mocked(buildReconciliationReport).mockResolvedValue(report);
  vi.mocked(listReconciliationQueue).mockResolvedValue(queue);
  vi.mocked(prisma.partnerOrganisation.findMany).mockResolvedValue([{ id: 'po-1', name: 'Yayasan Indonesia Emas' }] as never);
  render(await AdminReconciliationPage());
}

function withdrawal(over: Record<string, unknown> = {}) {
  return {
    withdrawalId: 'w1',
    provider: 'sumopod',
    reference: 'WD-001',
    amount: 900_000,
    destinationName: 'YAY GENERASI JAYA INDO',
    collectingEntityId: null,
    providerBalanceBefore: 1_000_000,
    providerBalanceAfter: 100_000,
    providerMovedBy: 900_000,
    difference: 0,
    recordedAt: AT.toISOString(),
    ...over,
  };
}

describe('AdminReconciliationPage', () => {
  it('says the books are clean when the report has no finding and the queue is empty', async () => {
    await renderPage(cleanReport());

    const summary = screen.getByRole('region', { name: /ringkasan/i });
    expect(within(summary).getByText(/tidak ada temuan/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /antrean webhook/i })).toHaveTextContent(/tidak ada webhook/i);
  });

  it('shows each provider pot, and marks a provider with money but no recorded sweep as not yet checked', async () => {
    await renderPage(cleanReport());

    const providers = screen.getByRole('region', { name: /saldo per penyedia/i });
    const row = within(providers).getAllByText('sumopod')[0].closest('tr')!;
    expect(row.textContent).toContain('Rp1.000');
    expect(row.textContent).toMatch(/belum pernah dicek/i);
  });

  it('flags a sweep whose dashboard reading disagrees with the books, and counts it as a finding', async () => {
    const report = cleanReport();
    report.providerReconciliation.withdrawals = [
      {
        provider: 'sumopod',
        pot: report.providerReconciliation.pots[0],
        withdrawn: 900_000,
        providerMovedBy: 905_000,
        difference: 5_000,
        withdrawals: [withdrawal({ providerMovedBy: 905_000, difference: 5_000, providerBalanceAfter: 95_000 })],
      },
    ];
    report.providerReconciliation.divergence = { totalDifference: 5_000, providersWithDivergence: ['sumopod'] };
    await renderPage(report);

    const providers = screen.getByRole('region', { name: /saldo per penyedia/i });
    const sweep = within(providers).getByText('WD-001').closest('tr')!;
    expect(sweep.textContent).toContain('Rp5.000');
    expect(sweep.textContent).toMatch(/selisih/i);
    expect(screen.getByRole('region', { name: /ringkasan/i })).toHaveTextContent(/1 temuan/i);
  });

  it('marks a sweep that matches the dashboard as cocok', async () => {
    const report = cleanReport();
    report.providerReconciliation.withdrawals = [
      {
        provider: 'sumopod',
        pot: report.providerReconciliation.pots[0],
        withdrawn: 900_000,
        providerMovedBy: 900_000,
        difference: 0,
        withdrawals: [withdrawal()],
      },
    ];
    await renderPage(report);

    const sweep = screen.getByText('WD-001').closest('tr')!;
    expect(sweep.textContent).toMatch(/cocok/i);
  });

  it('lists ledger findings by name with their rows', async () => {
    await renderPage(
      cleanReport({
        negativeBalances: [{ campaignId: 'camp-1', account: 'ESCROW_HOLD', balance: -500 }],
        mismatches: [],
      }),
    );

    const summary = screen.getByRole('region', { name: /ringkasan/i });
    expect(summary).toHaveTextContent(/1 temuan/i);
    const row = within(summary).getByText(/saldo campaign negatif/i, { selector: 'td' }).closest('tr')!;
    expect(row.textContent).toContain('1');
    expect(screen.getByText('camp-1')).toBeInTheDocument();
  });

  it('shows the needs-review webhook queue with provider, kind, and time, and unresolved charge failures', async () => {
    await renderPage(
      cleanReport(),
      emptyQueue({
        webhookEvents: [
          { id: 'e1', provider: 'sumopod', providerEventId: 'evt-77', outcome: 'AMOUNT_MISMATCH', receivedAt: AT, processedAt: AT },
        ],
        chargeWriteFailures: [
          { id: 'c1', provider: 'sumopod', providerRef: 'don-9', subjectType: 'donation', amount: 25_000, createdAt: AT },
        ],
      }),
    );

    const queue = screen.getByRole('region', { name: /antrean webhook/i });
    const event = within(queue).getByText('evt-77').closest('tr')!;
    expect(event.textContent).toContain('sumopod');
    expect(event.textContent).toMatch(/nominal tidak cocok/i);
    expect(event.textContent).toContain('AMOUNT_MISMATCH');
    expect(event.textContent).toContain('29 Oktober 2026');
    expect(within(queue).getByText('don-9', { selector: 'td' }).closest('tr')!.textContent).toContain('Rp25.000');
    expect(screen.getByRole('region', { name: /ringkasan/i })).toHaveTextContent(/2 temuan/i);
  });

  it('offers the withdrawal form with registered Collecting Entities', async () => {
    await renderPage(cleanReport());

    const form = screen.getByRole('region', { name: /catat penarikan/i });
    expect(within(form).getByRole('option', { name: 'Yayasan Indonesia Emas' })).toBeInTheDocument();
    expect(within(form).getByRole('option', { name: 'sumopod' })).toBeInTheDocument();
  });
});
