import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: { campaignTransfer: { findMany: vi.fn() } },
}));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/components/admin/AdminCampaignTransferDecisionForm', () => ({
  AdminCampaignTransferDecisionForm: (p: { transferId: string; actorId: string; requestedById: string }) => (
    <div>
      form {p.transferId} actor {p.actorId} requester {p.requestedById}
    </div>
  ),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import AdminCampaignTransfersPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const pending = {
  id: 'ct-1',
  amount: 1_500_000,
  reason: 'Campaign sumber ditangguhkan',
  status: 'PENDING',
  createdAt: new Date('2026-10-20T00:00:00.000Z'),
  decidedAt: null,
  decisionReason: null,
  requestedById: 'admin-1',
  requestedBy: { name: 'Admin Satu' },
  decidedBy: null,
  source: { title: 'Wakaf Sumur A', kind: 'WAKAF' },
  target: { title: 'Wakaf Sumur B', kind: 'WAKAF' },
};

describe('AdminCampaignTransfersPage', () => {
  it('lists a PENDING transfer with source, target, amount and reason, and the decision form', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2' } } as never);
    vi.mocked(prisma.campaignTransfer.findMany).mockResolvedValueOnce([pending] as never).mockResolvedValueOnce([] as never);

    render(await AdminCampaignTransfersPage());

    expect(screen.getByRole('heading', { level: 1, name: /transfer antar campaign/i })).toBeDefined();
    const row = screen.getByText('Wakaf Sumur A').closest('tr')!;
    expect(within(row).getByText('Wakaf Sumur B')).toBeDefined();
    expect(within(row).getByText(/Rp\s?1\.500\.000/)).toBeDefined();
    expect(within(row).getByText('Campaign sumber ditangguhkan')).toBeDefined();
    expect(within(row).getByText('Admin Satu')).toBeDefined();
    expect(within(row).getByText(/form ct-1 actor admin-2 requester admin-1/)).toBeDefined();
  });

  it('queries PENDING for the queue, oldest first', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2' } } as never);
    vi.mocked(prisma.campaignTransfer.findMany).mockResolvedValue([] as never);

    render(await AdminCampaignTransfersPage());

    const first = vi.mocked(prisma.campaignTransfer.findMany).mock.calls[0][0] as { where: unknown; orderBy: unknown };
    expect(first.where).toEqual({ status: 'PENDING' });
    expect(first.orderBy).toEqual({ createdAt: 'asc' });
  });

  it('shows empty states for the queue and the history', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2' } } as never);
    vi.mocked(prisma.campaignTransfer.findMany).mockResolvedValue([] as never);

    render(await AdminCampaignTransfersPage());

    expect(screen.getByText(/tidak ada transfer yang menunggu keputusan/i)).toBeDefined();
    expect(screen.getByText(/belum ada transfer yang diputuskan/i)).toBeDefined();
  });

  it('lists decided transfers read-only with status, decider and reason', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2' } } as never);
    vi.mocked(prisma.campaignTransfer.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          ...pending,
          id: 'ct-2',
          status: 'REJECTED',
          decidedAt: new Date('2026-10-21T00:00:00.000Z'),
          decisionReason: 'tujuan tidak cocok',
          decidedBy: { name: 'Admin Dua' },
        },
      ] as never);

    render(await AdminCampaignTransfersPage());

    const row = screen.getByText('tujuan tidak cocok').closest('tr')!;
    expect(within(row).getByText('Ditolak')).toBeDefined();
    expect(within(row).getByText('Admin Dua')).toBeDefined();
    expect(within(row).queryByText(/^form /)).toBeNull();
  });
});
