import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
);
vi.mock('next/navigation', () => ({ notFound, useRouter: () => ({ refresh: vi.fn() }) }));

const ops = vi.hoisted(() => ({ resolveOperationsOrDefaults: vi.fn() }));
vi.mock('@/lib/operations', async (orig) => ({ ...(await orig<typeof import('@/lib/operations')>()), ...ops }));
vi.mock('@/lib/zakat-distributions', async (orig) => ({
  ...(await orig<typeof import('@/lib/zakat-distributions')>()),
  zakatPosition: vi.fn(),
  listZakatDistributions: vi.fn(),
}));
vi.mock('@/lib/money/finance-recap', async (orig) => ({
  ...(await orig<typeof import('@/lib/money/finance-recap')>()),
  financeRecap: vi.fn(),
}));

import { zakatPosition, listZakatDistributions } from '@/lib/zakat-distributions';
import { financeRecap, emptyAmounts } from '@/lib/money/finance-recap';
import AdminZakatPage from './page';

const on = { zakat: { enabled: true, nisabAmount: 85_000_000, recipientOrganisationId: 'org-1' } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(zakatPosition).mockResolvedValue({ received: 3_000_000, distributed: 1_000_000, remaining: 2_000_000 });
  vi.mocked(listZakatDistributions).mockResolvedValue([
    {
      id: 'z1',
      amount: 1_000_000,
      asnaf: 'FAKIR',
      distributedAt: new Date('2026-11-07T17:00:00.000Z'),
      recipientSummary: '25 keluarga di Desa Contoh',
      note: null,
      recordedAt: new Date('2026-11-09T01:00:00.000Z'),
      recordedBy: { name: 'Dewi Admin' },
    },
  ] as never);
  vi.mocked(financeRecap).mockResolvedValue({
    rows: [
      { period: '2026-11', campaignId: 'z1', kind: 'ZAKAT', campaignTitle: 'Zakat Yayasan', ...emptyAmounts(), donasiDiterima: 3_000_000 },
      { period: '2026-11', campaignId: 'c1', kind: 'DONATION', campaignTitle: 'Banjir', ...emptyAmounts(), donasiDiterima: 9_000_000 },
    ],
    totals: { ...emptyAmounts(), donasiDiterima: 12_000_000 },
  });
});
afterEach(cleanup);

describe('/admin/zakat', () => {
  it('is a 404 while the zakat module is off', async () => {
    ops.resolveOperationsOrDefaults.mockResolvedValue({ zakat: { enabled: false, nisabAmount: 0, recipientOrganisationId: null } });
    await expect(AdminZakatPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(zakatPosition).not.toHaveBeenCalled();
  });

  it('shows what was received, distributed and is left, with the records and the CSV link', async () => {
    ops.resolveOperationsOrDefaults.mockResolvedValue(on);
    render(await AdminZakatPage({ searchParams: Promise.resolve({ from: '2026-11', to: '2026-11' }) }));

    expect(screen.getByRole('heading', { level: 1, name: 'Zakat' })).toBeDefined();
    expect(screen.getByTestId('zakat-received').textContent).toMatch(/Rp3\.000\.000/);
    expect(screen.getByTestId('zakat-distributed').textContent).toMatch(/Rp1\.000\.000/);
    expect(screen.getByTestId('zakat-remaining').textContent).toMatch(/Rp2\.000\.000/);
    expect(screen.getByText('25 keluarga di Desa Contoh')).toBeDefined();
    expect(screen.getByRole('link', { name: /unduh csv/i }).getAttribute('href')).toBe(
      '/api/admin/zakat/transaksi?from=2026-11&to=2026-11',
    );
  });

  it('shows the zakat ledger figures apart from the general donations of the same period', async () => {
    ops.resolveOperationsOrDefaults.mockResolvedValue(on);
    render(await AdminZakatPage({ searchParams: Promise.resolve({ from: '2026-11', to: '2026-11' }) }));

    expect(screen.getByTestId('ledger-zakat').textContent).toMatch(/Rp3\.000\.000/);
    expect(screen.getByTestId('ledger-general').textContent).toMatch(/Rp9\.000\.000/);
  });
});
