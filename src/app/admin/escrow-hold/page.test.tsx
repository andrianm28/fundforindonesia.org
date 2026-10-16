import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: { escrowHoldSetting: { findMany: vi.fn() } },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { prisma } from '@/lib/prisma';
import AdminEscrowHoldPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function row(over: Record<string, unknown>) {
  return {
    id: 'r',
    scope: 'DEFAULT',
    category: null,
    days: 7,
    setById: 'a1',
    setBy: { name: 'Admin Satu' },
    setAt: new Date('2026-10-01T03:00:00.000Z'),
    ...over,
  };
}

function givenRows(rows: unknown[]) {
  vi.mocked(prisma.escrowHoldSetting.findMany).mockResolvedValue(rows as never);
}

describe('AdminEscrowHoldPage', () => {
  it('labels the 7-day fallback as not set by an Admin when there are no rows', async () => {
    givenRows([]);
    render(await AdminEscrowHoldPage());

    const current = screen.getByRole('region', { name: /lama yang berlaku/i });
    expect(within(current).getByText(/7 hari \(bawaan, belum diatur\)/)).toBeInTheDocument();
    expect(screen.getByText(/belum ada perubahan/i)).toBeInTheDocument();
  });

  it('shows the newest row per key as in force, with its actor, and all rows in the history', async () => {
    givenRows([
      row({ id: 'n', days: 10, setBy: { name: 'Admin Dua' }, setAt: new Date('2026-10-05T03:00:00.000Z') }),
      row({ id: 'c', scope: 'CATEGORY', category: 'bencana', days: 3 }),
      row({ id: 'o', days: 14, setAt: new Date('2026-10-02T03:00:00.000Z') }),
    ]);
    render(await AdminEscrowHoldPage());

    const current = screen.getByRole('region', { name: /lama yang berlaku/i });
    const defaultRow = within(current).getByText(/^Default/).closest('tr')!;
    expect(defaultRow.textContent).toContain('10 hari');
    expect(defaultRow.textContent).toContain('Admin Dua');
    expect(defaultRow.textContent).not.toContain('14 hari');
    expect(within(current).getByText('bencana').closest('tr')!.textContent).toContain('3 hari');

    const history = screen.getByRole('region', { name: /riwayat perubahan/i });
    expect(within(history).getAllByRole('row')).toHaveLength(1 + 3);
  });
});
