import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/money/finance-recap', async (orig) => ({
  ...(await orig<typeof import('@/lib/money/finance-recap')>()),
  financeRecap: vi.fn(),
}));

import { financeRecap, emptyAmounts } from '@/lib/money/finance-recap';
import AdminFinancePage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminFinancePage', () => {
  it('shows a row per period x Kind x Campaign with a Total and a CSV link for the same period', async () => {
    vi.mocked(financeRecap).mockResolvedValue({
      rows: [
        { period: '2026-10', campaignId: 'c1', kind: 'WAKAF', campaignTitle: 'Sumur Desa', ...emptyAmounts(), donasiDiterima: 300_000, danaBersih: 277_500 },
      ],
      totals: { ...emptyAmounts(), donasiDiterima: 300_000, danaBersih: 277_500 },
    });

    render(await AdminFinancePage({ searchParams: Promise.resolve({ from: '2026-10', to: '2026-10' }) }));

    const row = screen.getByText('Sumur Desa').closest('tr')!;
    expect(within(row).getByText('WAKAF')).toBeDefined();
    expect(within(row).getByText('Rp300.000')).toBeDefined();
    expect(screen.getByText('Total').closest('tr')!.textContent).toContain('Rp277.500');
    expect(screen.getByRole('link', { name: /unduh csv/i }).getAttribute('href')).toBe(
      '/api/admin/finance/recap?from=2026-10&to=2026-10',
    );
    expect(financeRecap).toHaveBeenCalledWith(expect.anything(), { from: '2026-10', to: '2026-10' });
  });

  it('shows an empty state', async () => {
    vi.mocked(financeRecap).mockResolvedValue({ rows: [], totals: emptyAmounts() });
    render(await AdminFinancePage({ searchParams: Promise.resolve({ from: '2026-10' }) }));
    expect(screen.getByText(/tidak ada pergerakan/i)).toBeDefined();
  });

  it('reports a bad period instead of crashing, with no download link', async () => {
    const { InvalidRecapPeriodError } = await import('@/lib/money/finance-recap');
    vi.mocked(financeRecap).mockRejectedValue(new InvalidRecapPeriodError('Periode salah'));
    render(await AdminFinancePage({ searchParams: Promise.resolve({ from: 'x' }) }));
    expect(screen.getByRole('alert').textContent).toContain('Periode salah');
    expect(screen.queryByRole('link', { name: /unduh csv/i })).toBeNull();
  });
});
