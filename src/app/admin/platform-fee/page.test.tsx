import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformFeeRule: { findMany: vi.fn() },
    platformFeeThreshold: { findMany: vi.fn() },
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { prisma } from '@/lib/prisma';
import AdminPlatformFeePage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function rule(over: Record<string, unknown>) {
  return {
    id: 'r',
    scope: 'KIND',
    kind: null,
    category: null,
    campaignId: null,
    campaign: null,
    percentBps: 0,
    setById: 'a1',
    setBy: { name: 'Admin Satu' },
    setAt: new Date('2026-09-20T03:00:00.000Z'),
    ...over,
  };
}

function givenRows(rules: unknown[], thresholds: unknown[]) {
  vi.mocked(prisma.platformFeeRule.findMany).mockResolvedValue(rules as never);
  vi.mocked(prisma.platformFeeThreshold.findMany).mockResolvedValue(thresholds as never);
}

/**
 * Ticket 88: shows the Platform Fee rules in force and their history, read
 * the way resolvePlatformFeeBasis reads them -- the latest row per scope and
 * key wins; with no row a Kind resolves to 0. Every number on this page comes
 * from a row, none from the page itself.
 */
describe('AdminPlatformFeePage', () => {
  it('says a Kind nobody has set is not set, and invents no number for it', async () => {
    givenRows([], []);

    render(await AdminPlatformFeePage());

    const current = screen.getByRole('region', { name: /aturan yang berlaku/i });
    for (const kind of ['donation', 'zakat', 'wakaf', 'hibah']) {
      expect(within(current).getByText(kind).closest('tr')!.textContent).toMatch(/belum diatur/i);
    }
    expect(within(current).queryByText(/\d+(,\d+)?%/)).toBeNull();
    expect(within(current).getByText(/ambang pembebasan/i).closest('tr')!.textContent).toMatch(/belum diatur/i);
  });

  it('shows the latest row per Kind as the one in force, not an older one', async () => {
    givenRows(
      [
        rule({ id: 'new', kind: 'DONATION', percentBps: 250, setAt: new Date('2026-09-20T03:00:00.000Z') }),
        rule({ id: 'old', kind: 'DONATION', percentBps: 700, setAt: new Date('2026-09-10T03:00:00.000Z') }),
      ],
      [],
    );

    render(await AdminPlatformFeePage());

    const current = screen.getByRole('region', { name: /aturan yang berlaku/i });
    const row = within(current).getByText('donation').closest('tr')!;
    expect(row.textContent).toMatch(/2,5%/);
    expect(row.textContent).not.toMatch(/7%/);
    expect(row.textContent).toMatch(/Admin Satu/);
  });

  it('shows Category and Campaign overrides (latest per key) and the latest threshold', async () => {
    givenRows(
      [
        rule({ id: 'c1', scope: 'CATEGORY', category: 'Bencana', percentBps: 0 }),
        rule({
          id: 'c2',
          scope: 'CAMPAIGN',
          campaignId: 'camp-1',
          campaign: { title: 'Sumur Desa', slug: 'sumur-desa' },
          percentBps: 100,
        }),
      ],
      [
        { id: 't2', amount: 75_000, setById: 'a1', setBy: { name: 'Admin Satu' }, setAt: new Date('2026-09-20T03:00:00.000Z') },
        { id: 't1', amount: 40_000, setById: 'a2', setBy: { name: 'Admin Dua' }, setAt: new Date('2026-09-10T03:00:00.000Z') },
      ],
    );

    render(await AdminPlatformFeePage());

    const current = screen.getByRole('region', { name: /aturan yang berlaku/i });
    expect(within(current).getByText('Bencana').closest('tr')!.textContent).toMatch(/0%/);
    expect(within(current).getByText(/Sumur Desa/).closest('tr')!.textContent).toMatch(/1%/);
    const threshold = within(current).getByText(/ambang pembebasan/i).closest('tr')!;
    expect(threshold.textContent).toMatch(/75\.000/);
    expect(threshold.textContent).not.toMatch(/40\.000/);
  });

  it('lists every row in the history, newest first, with who and when', async () => {
    givenRows(
      [
        rule({ id: 'new', kind: 'DONATION', percentBps: 250, setAt: new Date('2026-09-20T03:00:00.000Z') }),
        rule({
          id: 'old',
          kind: 'DONATION',
          percentBps: 700,
          setBy: { name: 'Admin Dua' },
          setAt: new Date('2026-09-10T03:00:00.000Z'),
        }),
      ],
      [{ id: 't1', amount: 40_000, setById: 'a2', setBy: { name: 'Admin Tiga' }, setAt: new Date('2026-09-15T03:00:00.000Z') }],
    );

    render(await AdminPlatformFeePage());

    const history = screen.getByRole('region', { name: /riwayat/i });
    const rows = within(history).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toMatch(/2,5%.*Admin Satu|Admin Satu.*2,5%/);
    expect(rows[1].textContent).toMatch(/Admin Tiga/);
    expect(rows[1].textContent).toMatch(/40\.000/);
    expect(rows[2].textContent).toMatch(/Admin Dua/);
    expect(rows[2].textContent).toMatch(/7%/);
    expect(rows[2].textContent).toMatch(/2026/);
  });

  it('renders the form that posts to the existing route', async () => {
    givenRows([], []);

    render(await AdminPlatformFeePage());

    expect(screen.getByLabelText(/^Yang diubah/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /simpan/i })).toBeDefined();
  });
});
