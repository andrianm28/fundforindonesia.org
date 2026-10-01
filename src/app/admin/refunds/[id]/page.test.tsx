import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    refund: { findUnique: vi.fn() },
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
import { sealRefundDonorAccountNumber } from '@/lib/contact-fields';
import AdminRefundDetailPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const REQUESTED_REFUND = {
  id: 'refund-1',
  amount: 250_000,
  reason: 'salah bayar',
  status: 'REQUESTED',
  createdAt: new Date('2026-09-20T00:00:00.000Z'),
  requestedById: 'admin-1',
  approvedById: null,
  requestedBy: { name: 'Admin Satu' },
  approvedBy: null,
  payment: {
    amount: 250_000,
    donation: { campaignId: 'campaign-1' },
    registration: null,
  },
};

describe('AdminRefundDetailPage', () => {
  it('404s when the Refund does not exist', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.refund.findUnique).mockResolvedValue(null);

    await expect(AdminRefundDetailPage({ params: Promise.resolve({ id: 'nope' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it('shows a REQUESTED Refund with its subject, amount, reason and the approve form', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.refund.findUnique).mockResolvedValue(REQUESTED_REFUND as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ slug: 'wakaf-sumur', title: 'Wakaf Sumur' } as never);

    render(await AdminRefundDetailPage({ params: Promise.resolve({ id: 'refund-1' }) }));

    expect(screen.getByText('Wakaf Sumur')).toBeDefined();
    expect(screen.getByText(/Rp250\.000/)).toBeDefined();
    expect(screen.getByText('salah bayar')).toBeDefined();
    expect(screen.getByText('Admin Satu')).toBeDefined();
    expect(screen.getByRole('button', { name: /setujui refund/i })).toBeDefined();
  });

  it('shows the two-person rule notice instead of the form when the viewer requested it', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.refund.findUnique).mockResolvedValue(REQUESTED_REFUND as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ slug: 'wakaf-sumur', title: 'Wakaf Sumur' } as never);

    render(await AdminRefundDetailPage({ params: Promise.resolve({ id: 'refund-1' }) }));

    expect(screen.getByText(/tidak bisa menyetujuinya sendiri/i)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('resolves a Volunteer Trip Refund through the Trip lookup, not the Campaign one', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.refund.findUnique).mockResolvedValue({
      ...REQUESTED_REFUND,
      payment: { amount: 250_000, donation: null, registration: { batch: { tripId: 'trip-1' } } },
    } as never);
    vi.mocked(prisma.volunteerTrip.findUnique).mockResolvedValue({ slug: 'trip-lombok', title: 'Trip ke Lombok' } as never);

    render(await AdminRefundDetailPage({ params: Promise.resolve({ id: 'refund-1' }) }));

    expect(screen.getByText('Trip ke Lombok')).toBeDefined();
    expect(prisma.campaign.findUnique).not.toHaveBeenCalled();
  });

  it('shows the approving Admin and the complete form (ticket 31) for a third Admin, once APPROVED', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-3', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.refund.findUnique).mockResolvedValue({
      ...REQUESTED_REFUND,
      status: 'APPROVED',
      approvedById: 'admin-2',
      approvedBy: { name: 'Admin Dua' },
    } as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ slug: 'wakaf-sumur', title: 'Wakaf Sumur' } as never);

    render(await AdminRefundDetailPage({ params: Promise.resolve({ id: 'refund-1' }) }));

    expect(screen.getByText(/Admin Dua/)).toBeDefined();
    expect(screen.getByRole('button', { name: /tandai refund selesai/i })).toBeDefined();
  });

  it('shows the two-person rule notice instead of the complete form when the viewer approved this Refund', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.refund.findUnique).mockResolvedValue({
      ...REQUESTED_REFUND,
      status: 'APPROVED',
      approvedById: 'admin-2',
      approvedBy: { name: 'Admin Dua' },
    } as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ slug: 'wakaf-sumur', title: 'Wakaf Sumur' } as never);

    render(await AdminRefundDetailPage({ params: Promise.resolve({ id: 'refund-1' }) }));

    expect(screen.getByText(/tidak bisa menandainya selesai sendiri/i)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the recorded destination masked -- bank code and name plaintext, only the account number tail (Q7(c))', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-3', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.refund.findUnique).mockResolvedValue({
      ...REQUESTED_REFUND,
      status: 'APPROVED',
      approvedById: 'admin-2',
      approvedBy: { name: 'Admin Dua' },
      donorBankCode: 'BCA',
      donorAccountName: 'Budi Santoso',
      ...sealRefundDonorAccountNumber('1234567890'),
    } as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ slug: 'wakaf-sumur', title: 'Wakaf Sumur' } as never);

    render(await AdminRefundDetailPage({ params: Promise.resolve({ id: 'refund-1' }) }));

    expect(screen.getByText('BCA', { exact: false })).toBeDefined();
    expect(screen.getByText('Budi Santoso', { exact: false })).toBeDefined();
    expect(screen.getByText('****7890', { exact: false })).toBeDefined();
    // The plaintext number never renders anywhere on the page.
    expect(screen.queryByText('1234567890', { exact: false })).toBeNull();
  });

  it('shows a read-only summary with the completing Admin, no form, once COMPLETED', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-4', assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.refund.findUnique).mockResolvedValue({
      ...REQUESTED_REFUND,
      status: 'COMPLETED',
      approvedById: 'admin-2',
      approvedBy: { name: 'Admin Dua' },
      completedById: 'admin-3',
      completedBy: { name: 'Admin Tiga' },
      proofImage: 'TRX-778899 — ditransfer ke rekening Donor',
    } as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ slug: 'wakaf-sumur', title: 'Wakaf Sumur' } as never);

    render(await AdminRefundDetailPage({ params: Promise.resolve({ id: 'refund-1' }) }));

    expect(screen.getByText(/Admin Tiga/)).toBeDefined();
    // UAT round 2: the completion reference and note were stored but never shown.
    expect(screen.getByText('Referensi transaksi')).toBeDefined();
    expect(screen.getByText('TRX-778899')).toBeDefined();
    expect(screen.getByText('Catatan')).toBeDefined();
    expect(screen.getByText('ditransfer ke rekening Donor')).toBeDefined();
    expect(document.querySelector('a[href], img[src]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
