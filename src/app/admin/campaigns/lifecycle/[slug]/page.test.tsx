import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    campaignFlag: { findMany: vi.fn() },
    cancellationRequest: { findFirst: vi.fn() },
    campaignStatusChange: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import AdminCampaignLifecyclePage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ACTIVE_CAMPAIGN = {
  id: 'campaign-1',
  slug: 'sumur-desa',
  title: 'Sumur untuk Desa',
  lifecycleStatus: 'ACTIVE',
  deadline: new Date('2027-01-01T00:00:00.000Z'),
  creatorId: 'fundraiser-1',
};

describe('AdminCampaignLifecyclePage (ticket 25)', () => {
  it('404s when the Campaign does not exist', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(null);

    await expect(
      AdminCampaignLifecyclePage({ params: Promise.resolve({ slug: 'nope' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows the Campaign, its open Flags, and the suspend form for an effectively ACTIVE Campaign', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(ACTIVE_CAMPAIGN as never);
    vi.mocked(prisma.campaignFlag.findMany).mockResolvedValue([
      { id: 'flag-1', reason: 'Laporan donatur mencurigakan.' },
    ] as never);
    vi.mocked(prisma.cancellationRequest.findFirst).mockResolvedValue(null);

    render(await AdminCampaignLifecyclePage({ params: Promise.resolve({ slug: 'sumur-desa' }) }));

    expect(screen.getByText('Sumur untuk Desa')).toBeDefined();
    expect(screen.getByText('Laporan donatur mencurigakan.')).toBeDefined();
    expect(screen.getByLabelText(/alasan suspension/i)).toBeDefined();
    expect(prisma.campaignStatusChange.findFirst).not.toHaveBeenCalled();
  });

  it('shows the lift form for a SUSPENDED Campaign, looking up who imposed it', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
      ...ACTIVE_CAMPAIGN,
      lifecycleStatus: 'SUSPENDED',
    } as never);
    vi.mocked(prisma.campaignFlag.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.cancellationRequest.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.campaignStatusChange.findFirst).mockResolvedValue({ actorId: 'admin-9' } as never);

    render(await AdminCampaignLifecyclePage({ params: Promise.resolve({ slug: 'sumur-desa' }) }));

    expect(screen.getByLabelText(/alasan pencabutan/i)).toBeDefined();
  });

  it('shows a note instead of the lift form for the Admin who imposed the Suspension', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-9', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
      ...ACTIVE_CAMPAIGN,
      lifecycleStatus: 'SUSPENDED',
    } as never);
    vi.mocked(prisma.campaignFlag.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.cancellationRequest.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.campaignStatusChange.findFirst).mockResolvedValue({ actorId: 'admin-9' } as never);

    render(await AdminCampaignLifecyclePage({ params: Promise.resolve({ slug: 'sumur-desa' }) }));

    expect(screen.queryByLabelText(/alasan pencabutan/i)).toBeNull();
    expect(screen.getByText(/admin lain/i)).toBeDefined();
  });

  it('shows a pending Cancellation request with its Fundraiser reason', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(ACTIVE_CAMPAIGN as never);
    vi.mocked(prisma.campaignFlag.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.cancellationRequest.findFirst).mockResolvedValue({
      id: 'req-1',
      reason: 'Sudah tidak butuh dana lagi.',
      requestedBy: { name: 'Budi' },
    } as never);

    render(await AdminCampaignLifecyclePage({ params: Promise.resolve({ slug: 'sumur-desa' }) }));

    expect(screen.getByText('Sudah tidak butuh dana lagi.')).toBeDefined();
  });

  it('shows a note instead of any action form when the Admin is this Campaign\'s own Fundraiser', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'fundraiser-1', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(ACTIVE_CAMPAIGN as never);
    vi.mocked(prisma.campaignFlag.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.cancellationRequest.findFirst).mockResolvedValue(null);

    render(await AdminCampaignLifecyclePage({ params: Promise.resolve({ slug: 'sumur-desa' }) }));

    expect(screen.queryByLabelText(/alasan suspension/i)).toBeNull();
    expect(screen.getByText(/milik anda sendiri/i)).toBeDefined();
  });
});
