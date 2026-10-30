import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    category: { findUnique: vi.fn() },
    verificationRequest: { count: vi.fn() },
    campaignUpdate: { count: vi.fn() },
    cancellationRequest: { count: vi.fn() },
  },
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import ManageCampaignPage from './page';

/** Tickets 72 and 65: the Fundraiser's screen for one of their Campaigns. */
const CAMPAIGN = {
  id: 'c1',
  slug: 'sumur',
  title: 'Sumur Desa',
  story: 'Cerita yang cukup panjang untuk lolos dari batas minimal lima puluh karakter itu.',
  coverImage: '/uploads/cover.jpg',
  kind: 'DONATION',
  targetAmount: 50_000_000,
  category: 'bencana-alam',
  deadline: new Date('2099-12-31T16:59:59.999Z'),
  collectingEntityId: 'mitra-1',
  creatorId: 'u1',
  lifecycleStatus: 'DRAFT',
};

const page = () => ManageCampaignPage({ params: Promise.resolve({ slug: 'sumur' }) });

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ own: null, sponsors: [] })),
  );
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as never);
  vi.mocked(prisma.campaign.findUnique).mockResolvedValue(CAMPAIGN as never);
  vi.mocked(prisma.category.findUnique).mockResolvedValue({ name: 'Bencana Alam' } as never);
  vi.mocked(prisma.verificationRequest.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.campaignUpdate.count).mockResolvedValue(1 as never);
  vi.mocked(prisma.cancellationRequest.count).mockResolvedValue(0 as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the Fundraiser manage page', () => {
  it('sends a signed-out visitor to sign in', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    await expect(page()).rejects.toThrow('NEXT_REDIRECT /login');
  });

  it('answers 404 for another Fundraiser, the same as for a Campaign that does not exist', async () => {
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ ...CAMPAIGN, creatorId: 'someone-else' } as never);
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');

    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(null as never);
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('does not let an Admin who is not the owner in', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } } as never);
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it.each(['DRAFT', 'REJECTED'])('offers the edit form for a %s Campaign', async (lifecycleStatus) => {
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ ...CAMPAIGN, lifecycleStatus } as never);

    render(await page());

    expect((screen.getByLabelText(/Judul Campaign/) as HTMLInputElement).value).toBe('Sumur Desa');
    expect((screen.getByLabelText(/Batas Waktu/) as HTMLInputElement).value).toBe('2099-12-31');
    expect(screen.getByTestId('edit-category').textContent).toContain('Bencana Alam');
    expect(screen.queryByRole('button', { name: 'Ajukan Perubahan' })).toBeNull();
  });

  it('offers the change request form for an Active Campaign, not the edit form', async () => {
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ ...CAMPAIGN, lifecycleStatus: 'ACTIVE' } as never);

    render(await page());

    expect(screen.getByRole('button', { name: 'Ajukan Perubahan' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Simpan Perubahan' })).toBeNull();
  });

  it('says a change request is waiting', async () => {
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ ...CAMPAIGN, lifecycleStatus: 'ACTIVE' } as never);
    vi.mocked(prisma.verificationRequest.count).mockResolvedValue(1 as never);

    render(await page());

    expect(screen.getByTestId('change-request-waiting')).toBeDefined();
  });

  it('treats an Active Campaign past its deadline as Expired: nothing to edit or ask', async () => {
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
      ...CAMPAIGN,
      lifecycleStatus: 'ACTIVE',
      deadline: new Date('2020-01-01T00:00:00Z'),
    } as never);

    render(await page());

    expect(screen.queryByRole('button', { name: 'Ajukan Perubahan' })).toBeNull();
    expect(screen.getByTestId('manage-not-editable')).toBeDefined();
  });

  it.each(['SUBMITTED', 'COMPLETED', 'SUSPENDED'])('explains that a %s Campaign has nothing to edit', async (lifecycleStatus) => {
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ ...CAMPAIGN, lifecycleStatus } as never);

    render(await page());

    expect(screen.getByTestId('manage-not-editable')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Simpan Perubahan' })).toBeNull();
  });

  describe('ending the Campaign (ticket 65)', () => {
    it('offers Tandai Selesai and Ajukan Pembatalan on an Active Campaign', async () => {
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ ...CAMPAIGN, lifecycleStatus: 'ACTIVE' } as never);

      render(await page());

      expect(screen.getByRole('button', { name: 'Tandai Selesai' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Ajukan Pembatalan' })).toBeDefined();
      expect(screen.queryByTestId('complete-needs-update')).toBeNull();
    });

    it('warns up front when the Campaign has no Campaign Update yet', async () => {
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ ...CAMPAIGN, lifecycleStatus: 'ACTIVE' } as never);
      vi.mocked(prisma.campaignUpdate.count).mockResolvedValue(0 as never);

      render(await page());

      expect(screen.getByTestId('complete-needs-update')).toBeDefined();
    });

    it('shows a waiting Cancellation request instead of the form', async () => {
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ ...CAMPAIGN, lifecycleStatus: 'ACTIVE' } as never);
      vi.mocked(prisma.cancellationRequest.count).mockResolvedValue(1 as never);

      render(await page());

      expect(screen.getByTestId('cancellation-waiting')).toBeDefined();
      expect(screen.queryByRole('button', { name: 'Ajukan Pembatalan' })).toBeNull();
    });

    it.each(['DRAFT', 'SUBMITTED', 'REJECTED', 'COMPLETED', 'CANCELLED', 'SUSPENDED'])(
      'offers neither on a %s Campaign',
      async (lifecycleStatus) => {
        vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ ...CAMPAIGN, lifecycleStatus } as never);

        render(await page());

        expect(screen.queryByRole('button', { name: 'Tandai Selesai' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Ajukan Pembatalan' })).toBeNull();
      },
    );

    it('offers neither on an Active Campaign past its deadline, which is Expired', async () => {
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
        ...CAMPAIGN,
        lifecycleStatus: 'ACTIVE',
        deadline: new Date('2020-01-01T00:00:00Z'),
      } as never);

      render(await page());

      expect(screen.queryByRole('button', { name: 'Tandai Selesai' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Ajukan Pembatalan' })).toBeNull();
    });
  });
});
