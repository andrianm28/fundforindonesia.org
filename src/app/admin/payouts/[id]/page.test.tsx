import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    payout: { findUnique: vi.fn() },
    campaign: { findUnique: vi.fn() },
    volunteerTrip: { findUnique: vi.fn() },
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
import AdminPayoutDetailPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DRAFT_PAYOUT = {
  id: 'payout-1',
  campaignId: 'campaign-1',
  volunteerTripId: null,
  amount: 5_000_000,
  description: 'Untuk material sumur',
  status: 'DRAFT',
  createdAt: new Date('2026-09-20T00:00:00.000Z'),
  requestedById: 'fundraiser-1',
  approvedById: null,
  approvedAt: null,
  approvedProvider: null,
  approvedProviderBalance: null,
  completedById: null,
  completedAt: null,
  proofImage: null,
  requestedBy: { name: 'Budi' },
  bankAccount: { bankCode: 'BCA', accountName: 'Budi Santoso' },
  balanceChecks: [] as Array<{
    id: string;
    provider: string;
    recordedBalance: number;
    checkedAt: Date;
    checkedBy: { name: string };
  }>,
};

describe('AdminPayoutDetailPage', () => {
  it('404s when the Payout does not exist', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.payout.findUnique).mockResolvedValue(null);

    await expect(AdminPayoutDetailPage({ params: Promise.resolve({ id: 'nope' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it('shows a DRAFT Campaign Payout with its Campaign, requester and bank account, and the approve form', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.payout.findUnique).mockResolvedValue(DRAFT_PAYOUT as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
      id: 'campaign-1',
      slug: 'sumur-desa',
      title: 'Sumur untuk Desa',
    } as never);

    render(await AdminPayoutDetailPage({ params: Promise.resolve({ id: 'payout-1' }) }));

    expect(screen.getByText('Sumur untuk Desa')).toBeDefined();
    expect(screen.getByText('Budi')).toBeDefined();
    expect(screen.getByText(/BCA.*Budi Santoso/)).toBeDefined();
    expect(screen.getByText(/Rp5\.000\.000/)).toBeDefined();
    // The approve form is rendered for a DRAFT payout when the viewer is a
    // different Admin than the requester.
    expect(screen.getByLabelText(/^penyedia pembayaran$/i)).toBeDefined();
  });

  it('never selects the Bank Account number into the page payload (ticket 89: it is opened only by the explicit reveal action)', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.payout.findUnique).mockResolvedValue(DRAFT_PAYOUT as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
      id: 'campaign-1',
      slug: 'sumur-desa',
      title: 'Sumur untuk Desa',
    } as never);

    render(await AdminPayoutDetailPage({ params: Promise.resolve({ id: 'payout-1' }) }));

    expect(prisma.payout.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          bankAccount: expect.objectContaining({
            select: expect.not.objectContaining({ accountNumberCiphertext: true }),
          }),
        }),
      }),
    );
  });

  it('resolves a Volunteer Trip Payout through the Trip lookup, not the Campaign one', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.payout.findUnique).mockResolvedValue({
      ...DRAFT_PAYOUT,
      campaignId: null,
      volunteerTripId: 'trip-1',
    } as never);
    vi.mocked(prisma.volunteerTrip.findUnique).mockResolvedValue({
      id: 'trip-1',
      slug: 'trip-lombok',
      title: 'Trip ke Lombok',
    } as never);

    render(await AdminPayoutDetailPage({ params: Promise.resolve({ id: 'payout-1' }) }));

    expect(screen.getByText('Trip ke Lombok')).toBeDefined();
    expect(prisma.campaign.findUnique).not.toHaveBeenCalled();
  });

  it('shows the complete form, with the approving Admin, for an APPROVED Payout', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-3', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.payout.findUnique).mockResolvedValue({
      ...DRAFT_PAYOUT,
      status: 'APPROVED',
      approvedById: 'admin-2',
      approvedAt: new Date('2026-09-21T00:00:00.000Z'),
      approvedProvider: 'sumopod',
      approvedProviderBalance: 8_000_000,
      approvedBy: { name: 'Admin Dua' },
    } as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
      id: 'campaign-1',
      slug: 'sumur-desa',
      title: 'Sumur untuk Desa',
    } as never);

    render(await AdminPayoutDetailPage({ params: Promise.resolve({ id: 'payout-1' }) }));

    expect(screen.getByText(/Admin Dua/)).toBeDefined();
    expect(screen.getByLabelText(/referensi transaksi/i)).toBeDefined();
  });

  it('shows a read-only summary, no form, for a COMPLETED Payout', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-4', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.payout.findUnique).mockResolvedValue({
      ...DRAFT_PAYOUT,
      status: 'COMPLETED',
      approvedById: 'admin-2',
      approvedAt: new Date('2026-09-21T00:00:00.000Z'),
      completedById: 'admin-3',
      completedAt: new Date('2026-09-22T00:00:00.000Z'),
      proofImage: 'TRX-001 — Ditransfer via BCA',
      approvedBy: { name: 'Admin Dua' },
      completedBy: { name: 'Admin Tiga' },
    } as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
      id: 'campaign-1',
      slug: 'sumur-desa',
      title: 'Sumur untuk Desa',
    } as never);

    render(await AdminPayoutDetailPage({ params: Promise.resolve({ id: 'payout-1' }) }));

    expect(screen.getByText(/TRX-001/)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says the Usage Report has not been sent yet, for a COMPLETED Campaign Payout with none', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-4', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.payout.findUnique).mockResolvedValue({
      ...DRAFT_PAYOUT,
      status: 'COMPLETED',
      approvedById: 'admin-2',
      completedById: 'admin-3',
      proofImage: 'TRX-001',
      approvedBy: { name: 'Admin Dua' },
      completedBy: { name: 'Admin Tiga' },
      usageReport: null,
    } as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
      id: 'campaign-1',
      slug: 'sumur-desa',
      title: 'Sumur untuk Desa',
    } as never);

    render(await AdminPayoutDetailPage({ params: Promise.resolve({ id: 'payout-1' }) }));

    expect(screen.getByText(/belum mengirim Usage Report/)).toBeDefined();
  });

  it('shows the Usage Report and a way to mark it dipertanyakan, for a COMPLETED Campaign Payout that has one', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-4', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.payout.findUnique).mockResolvedValue({
      ...DRAFT_PAYOUT,
      status: 'COMPLETED',
      approvedById: 'admin-2',
      completedById: 'admin-3',
      proofImage: 'TRX-001',
      approvedBy: { name: 'Admin Dua' },
      completedBy: { name: 'Admin Tiga' },
      usageReport: {
        id: 'ur-1',
        narrative: 'Dana dipakai untuk material sumur.',
        lineItems: [{ label: 'Material', amount: 5_000_000 }],
        beneficiaryCount: 30,
        photos: ['https://example.com/bukti.jpg'],
        disputedAt: null,
        disputedReason: null,
      },
    } as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
      id: 'campaign-1',
      slug: 'sumur-desa',
      title: 'Sumur untuk Desa',
    } as never);

    render(await AdminPayoutDetailPage({ params: Promise.resolve({ id: 'payout-1' }) }));

    expect(screen.getByText('Dana dipakai untuk material sumur.')).toBeDefined();
    expect(screen.getByRole('button', { name: /Tandai dipertanyakan/ })).toBeDefined();
  });

  it('shows the dispute reason for an already-disputed Usage Report, with no button to dispute it again', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-4', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.payout.findUnique).mockResolvedValue({
      ...DRAFT_PAYOUT,
      status: 'COMPLETED',
      approvedById: 'admin-2',
      completedById: 'admin-3',
      proofImage: 'TRX-001',
      approvedBy: { name: 'Admin Dua' },
      completedBy: { name: 'Admin Tiga' },
      usageReport: {
        id: 'ur-1',
        narrative: 'Dana dipakai untuk material sumur.',
        lineItems: [{ label: 'Material', amount: 5_000_000 }],
        beneficiaryCount: 30,
        photos: ['https://example.com/bukti.jpg'],
        disputedAt: new Date('2026-09-25T00:00:00.000Z'),
        disputedReason: 'Foto tidak sesuai narasi.',
      },
    } as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
      id: 'campaign-1',
      slug: 'sumur-desa',
      title: 'Sumur untuk Desa',
    } as never);

    render(await AdminPayoutDetailPage({ params: Promise.resolve({ id: 'payout-1' }) }));

    expect(screen.getByText(/Foto tidak sesuai narasi\./)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Tandai dipertanyakan/ })).toBeNull();
  });

  describe('balance check history (ticket 30)', () => {
    it('shows the "menunggu saldo penyedia" marker and the check history for a DRAFT Payout with an unresolved short check', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } } as never);
      vi.mocked(prisma.payout.findUnique).mockResolvedValue({
        ...DRAFT_PAYOUT,
        balanceChecks: [
          {
            id: 'check-2',
            provider: 'sumopod',
            recordedBalance: 3_000_000,
            checkedAt: new Date('2026-09-27T00:00:00.000Z'),
            checkedBy: { name: 'Admin Dua' },
          },
          {
            id: 'check-1',
            provider: 'sumopod',
            recordedBalance: 2_000_000,
            checkedAt: new Date('2026-09-25T00:00:00.000Z'),
            checkedBy: { name: 'Admin Dua' },
          },
        ],
      } as never);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
        id: 'campaign-1',
        slug: 'sumur-desa',
        title: 'Sumur untuk Desa',
      } as never);

      render(await AdminPayoutDetailPage({ params: Promise.resolve({ id: 'payout-1' }) }));

      expect(screen.getByText(/Menunggu saldo penyedia/)).toBeDefined();
      expect(screen.getByText(/Rp3\.000\.000/)).toBeDefined();
      expect(screen.getByText(/Rp2\.000\.000/)).toBeDefined();
    });

    it('shows no marker or history for a Payout that has never been checked', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } } as never);
      vi.mocked(prisma.payout.findUnique).mockResolvedValue(DRAFT_PAYOUT as never);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
        id: 'campaign-1',
        slug: 'sumur-desa',
        title: 'Sumur untuk Desa',
      } as never);

      render(await AdminPayoutDetailPage({ params: Promise.resolve({ id: 'payout-1' }) }));

      expect(screen.queryByText(/Menunggu saldo penyedia/)).toBeNull();
      expect(screen.queryByText(/Riwayat cek saldo/)).toBeNull();
    });

    it('keeps the history visible once the Payout is APPROVED, but drops the "menunggu" marker -- resolution is read off the status', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-3', assignments: ['ADMIN'] } } as never);
      vi.mocked(prisma.payout.findUnique).mockResolvedValue({
        ...DRAFT_PAYOUT,
        status: 'APPROVED',
        approvedById: 'admin-2',
        approvedAt: new Date('2026-09-28T00:00:00.000Z'),
        approvedProvider: 'sumopod',
        approvedProviderBalance: 8_000_000,
        approvedBy: { name: 'Admin Dua' },
        balanceChecks: [
          {
            id: 'check-1',
            provider: 'sumopod',
            recordedBalance: 2_000_000,
            checkedAt: new Date('2026-09-25T00:00:00.000Z'),
            checkedBy: { name: 'Admin Dua' },
          },
        ],
      } as never);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
        id: 'campaign-1',
        slug: 'sumur-desa',
        title: 'Sumur untuk Desa',
      } as never);

      render(await AdminPayoutDetailPage({ params: Promise.resolve({ id: 'payout-1' }) }));

      expect(screen.queryByText(/Menunggu saldo penyedia/)).toBeNull();
      expect(screen.getByText(/Rp2\.000\.000/)).toBeDefined();
    });
  });
});
