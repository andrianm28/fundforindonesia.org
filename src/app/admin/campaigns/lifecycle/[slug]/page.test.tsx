import { render, screen, cleanup, within } from '@testing-library/react';
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
  isUrgent: false,
};

/** An open Flag row as the page reads it: the Verifier is a relation, the instant a Date. */
function flagRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'flag-1',
    reason: 'Laporan donatur mencurigakan.',
    createdAt: new Date('2026-10-07T20:30:00.000Z'),
    verifier: { name: 'Sari' },
    ...overrides,
  };
}

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
    vi.mocked(prisma.campaignFlag.findMany).mockResolvedValue([flagRow()] as never);
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

/**
 * rilis-1-benda 66: the Flag and Urgent halves of the screen. The page reads
 * what the Admin needs to decide (who raised each open Flag, and when; whether
 * the Campaign is Urgent) and asks the lifecycle module's own lists whether
 * Urgent can be set; it decides nothing about who may act.
 */
describe('AdminCampaignLifecyclePage -- Flags and Urgent (rilis-1-benda 66)', () => {
  function asAdmin(id = 'admin-2') {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id, assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.cancellationRequest.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.campaignFlag.findMany).mockResolvedValue([] as never);
  }

  async function renderPage() {
    render(await AdminCampaignLifecyclePage({ params: Promise.resolve({ slug: 'sumur-desa' }) }));
  }

  it('shows each open Flag with the Verifier who raised it and when, in WIB', async () => {
    asAdmin();
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(ACTIVE_CAMPAIGN as never);
    vi.mocked(prisma.campaignFlag.findMany).mockResolvedValue([
      flagRow(),
      flagRow({ id: 'flag-2', reason: 'Rekening tidak cocok.', createdAt: new Date('2026-10-08T01:00:00.000Z'), verifier: { name: 'Dewi' } }),
    ] as never);

    await renderPage();

    const first = within(screen.getByText('Laporan donatur mencurigakan.').closest('li')!);
    expect(first.getByText(/Sari/)).toBeDefined();
    // 20:30 UTC on 7 October is 03:30 on 8 October in Jakarta.
    expect(first.getByText(/8 Oktober 2026/)).toBeDefined();
    expect(first.getByText(/03\.30 WIB/)).toBeDefined();
    expect(within(screen.getByText('Rekening tidak cocok.').closest('li')!).getByText(/Dewi/)).toBeDefined();
  });

  it('asks only for the Flags still open on this Campaign', async () => {
    asAdmin();
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(ACTIVE_CAMPAIGN as never);

    await renderPage();

    expect(prisma.campaignFlag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { campaignId: 'campaign-1', resolution: null } }),
    );
  });

  it('lists the open Flags of a Campaign that has since been cancelled, so they can still be dismissed', async () => {
    asAdmin();
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ ...ACTIVE_CAMPAIGN, lifecycleStatus: 'CANCELLED' } as never);
    vi.mocked(prisma.campaignFlag.findMany).mockResolvedValue([flagRow()] as never);

    await renderPage();

    expect(screen.getByRole('button', { name: /tolak flag/i })).toBeDefined();
    expect(screen.queryByLabelText(/alasan suspension/i)).toBeNull();
  });

  it("does not hand an Admin the Verifier's Flags on their own Campaign", async () => {
    asAdmin('fundraiser-1');
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(ACTIVE_CAMPAIGN as never);
    vi.mocked(prisma.campaignFlag.findMany).mockResolvedValue([flagRow()] as never);

    await renderPage();

    expect(screen.queryByText('Laporan donatur mencurigakan.')).toBeNull();
    expect(screen.queryByText(/Sari/)).toBeNull();
    expect(screen.queryByRole('button', { name: /tolak flag/i })).toBeNull();
  });

  it('offers to set Urgent on an Active Campaign that is not Urgent', async () => {
    asAdmin();
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(ACTIVE_CAMPAIGN as never);

    await renderPage();

    expect(screen.getByRole('button', { name: /^pasang urgent$/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /^lepas urgent$/i })).toBeNull();
  });

  it('offers to clear Urgent on an Urgent Campaign', async () => {
    asAdmin();
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ ...ACTIVE_CAMPAIGN, isUrgent: true } as never);

    await renderPage();

    expect(screen.getByRole('button', { name: /^lepas urgent$/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /^pasang urgent$/i })).toBeNull();
  });

  it('still offers to clear Urgent once the deadline has passed, though Urgent can no longer be set', async () => {
    asAdmin();
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
      ...ACTIVE_CAMPAIGN,
      deadline: new Date('2020-01-01T00:00:00.000Z'),
      isUrgent: true,
    } as never);

    await renderPage();

    expect(screen.getByRole('button', { name: /^lepas urgent$/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /^pasang urgent$/i })).toBeNull();
  });

  it.each(['DRAFT', 'SUBMITTED', 'REJECTED', 'SUSPENDED', 'CANCELLED', 'COMPLETED'])(
    'offers no Urgent control on a %s Campaign that is not Urgent',
    async (lifecycleStatus) => {
      asAdmin();
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ ...ACTIVE_CAMPAIGN, lifecycleStatus } as never);
      vi.mocked(prisma.campaignStatusChange.findFirst).mockResolvedValue({ actorId: 'admin-9' } as never);

      await renderPage();

      expect(screen.queryByRole('button', { name: /urgent/i })).toBeNull();
    },
  );
});
