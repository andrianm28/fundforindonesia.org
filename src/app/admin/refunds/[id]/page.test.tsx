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

/**
 * Ticket 50: the way back for a Refund (ticket 49's reject and fail routes)
 * gets its buttons on the page that already holds approve and complete.
 * Reject is offered while the Refund is not yet approved, fail once it is;
 * a Refund that has reached an end offers neither. The actor rules are the
 * form's own (AdminRefundResolveForm.test.tsx); what is pinned here is that
 * the page hands the form the right people.
 */
describe('AdminRefundDetailPage -- reject and fail (ticket 50)', () => {
  const APPROVED_REFUND = {
    ...REQUESTED_REFUND,
    status: 'APPROVED',
    approvedById: 'admin-2',
    approvedBy: { name: 'Admin Dua' },
  };

  /** The Refund's Campaign belongs to fundraiser-1, who holds the ADMIN assignment too. */
  const CAMPAIGN = { slug: 'wakaf-sumur', title: 'Wakaf Sumur', creatorId: 'fundraiser-1' };

  async function renderAs(viewerId: string, refund: object) {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: viewerId, assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(CAMPAIGN as never);
    vi.mocked(prisma.refund.findUnique).mockResolvedValue(refund as never);
    render(await AdminRefundDetailPage({ params: Promise.resolve({ id: 'refund-1' }) }));
  }

  it('offers Tolak next to Setujui on a REQUESTED Refund, for an Admin who did not request it', async () => {
    await renderAs('admin-2', REQUESTED_REFUND);

    expect(screen.getByRole('button', { name: /setujui refund/i })).toBeDefined();
    expect(screen.getByLabelText('Alasan penolakan')).toBeDefined();
    expect(screen.getByRole('button', { name: /tolak refund/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /tandai refund gagal/i })).toBeNull();
  });

  it('offers Tolak, and no approve form, on an AWAITING_DONOR_DETAILS Refund', async () => {
    await renderAs('admin-2', { ...REQUESTED_REFUND, status: 'AWAITING_DONOR_DETAILS' });

    expect(screen.getByRole('button', { name: /tolak refund/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /setujui refund/i })).toBeNull();
  });

  it('tells the Admin who requested the Refund that they cannot reject it, instead of a Tolak button', async () => {
    await renderAs('admin-1', REQUESTED_REFUND);

    expect(screen.getByText(/tidak bisa menolaknya sendiri/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /tolak refund/i })).toBeNull();
  });

  it("tells the Campaign's Fundraiser, an Admin too, that they cannot reject its Refund", async () => {
    await renderAs('fundraiser-1', REQUESTED_REFUND);

    expect(screen.getAllByText(/Fundraiser Campaign ini/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: /tolak refund/i })).toBeNull();
  });

  it("tells a Volunteer Trip's Fundraiser the same, naming the Trip", async () => {
    vi.mocked(prisma.volunteerTrip.findUnique).mockResolvedValue({
      slug: 'trip-lombok',
      title: 'Trip ke Lombok',
      fundraiserId: 'fundraiser-2',
    } as never);

    await renderAs('fundraiser-2', {
      ...REQUESTED_REFUND,
      payment: { amount: 250_000, donation: null, registration: { batch: { tripId: 'trip-1' } } },
    });

    expect(screen.getAllByText(/Fundraiser Volunteer Trip ini/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: /tolak refund/i })).toBeNull();
  });

  it('offers Tandai gagal next to Tandai selesai on an APPROVED Refund, for a third Admin', async () => {
    await renderAs('admin-3', APPROVED_REFUND);

    expect(screen.getByRole('button', { name: /tandai refund selesai/i })).toBeDefined();
    expect(screen.getByLabelText('Alasan kegagalan')).toBeDefined();
    expect(screen.getByRole('button', { name: /tandai refund gagal/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /tolak refund/i })).toBeNull();
  });

  it('tells the Admin who approved the Refund that they cannot mark it failed, instead of the button', async () => {
    await renderAs('admin-2', APPROVED_REFUND);

    expect(screen.getByText(/tidak bisa menandainya gagal sendiri/i)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('still offers Tandai gagal to the Admin who requested an APPROVED Refund, who may not complete it', async () => {
    await renderAs('admin-1', APPROVED_REFUND);

    expect(screen.getByText(/tidak bisa menandainya selesai sendiri/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /tandai refund selesai/i })).toBeNull();
    expect(screen.getByRole('button', { name: /tandai refund gagal/i })).toBeDefined();
  });

  it.each(['COMPLETED', 'REJECTED', 'FAILED', 'PROCESSING'])(
    'offers neither Tolak nor Tandai gagal once the Refund is %s',
    async (status) => {
      await renderAs('admin-4', { ...APPROVED_REFUND, status });

      expect(screen.queryByLabelText('Alasan penolakan')).toBeNull();
      expect(screen.queryByLabelText('Alasan kegagalan')).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
    },
  );
});

/**
 * Ticket 55: what the way back left on the Refund is readable (who, when,
 * why), and approve/complete say the same sentence to the subject's
 * Fundraiser that reject and fail already say.
 */
describe('AdminRefundDetailPage -- resolution and Fundraiser (ticket 55)', () => {
  const CAMPAIGN = { slug: 'wakaf-sumur', title: 'Wakaf Sumur', creatorId: 'fundraiser-1' };
  const APPROVED = {
    ...REQUESTED_REFUND,
    status: 'APPROVED',
    approvedById: 'admin-2',
    approvedBy: { name: 'Admin Dua' },
  };

  async function renderAs(viewerId: string, refund: object) {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: viewerId, assignments: ['ADMIN'] } } as never);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(CAMPAIGN as never);
    vi.mocked(prisma.refund.findUnique).mockResolvedValue(refund as never);
    render(await AdminRefundDetailPage({ params: Promise.resolve({ id: 'refund-1' }) }));
  }

  it('shows who rejected a REJECTED Refund, when, and why', async () => {
    await renderAs('admin-4', {
      ...REQUESTED_REFUND,
      status: 'REJECTED',
      rejectedById: 'admin-2',
      rejectedBy: { name: 'Admin Dua' },
      rejectedAt: new Date('2026-09-25T03:00:00.000Z'),
      rejectionReason: 'Donor membatalkan permintaan',
    });

    expect(screen.getByText('Ditolak oleh')).toBeDefined();
    expect(screen.getByText('Admin Dua')).toBeDefined();
    expect(screen.getByText(/25 Sep 2026/)).toBeDefined();
    expect(screen.getByText('Donor membatalkan permintaan')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows who marked a FAILED Refund failed, when, and why', async () => {
    await renderAs('admin-4', {
      ...APPROVED,
      status: 'FAILED',
      failedById: 'admin-3',
      failedBy: { name: 'Admin Tiga' },
      failedAt: new Date('2026-09-26T03:00:00.000Z'),
      failureReason: 'Rekening Donor ditutup',
    });

    expect(screen.getByText('Ditandai gagal oleh')).toBeDefined();
    expect(screen.getByText('Admin Tiga')).toBeDefined();
    expect(screen.getByText(/26 Sep 2026/)).toBeDefined();
    expect(screen.getByText('Rekening Donor ditutup')).toBeDefined();
    expect(screen.queryByText('Ditolak oleh')).toBeNull();
  });

  it('shows no resolution block for a Refund that has not ended that way', async () => {
    await renderAs('admin-2', REQUESTED_REFUND);

    expect(screen.queryByText('Ditolak oleh')).toBeNull();
    expect(screen.queryByText('Ditandai gagal oleh')).toBeNull();
  });

  it("replaces Setujui with the explaining sentence for the Campaign's Fundraiser", async () => {
    await renderAs('fundraiser-1', REQUESTED_REFUND);

    expect(screen.queryByRole('button', { name: /setujui refund/i })).toBeNull();
    expect(screen.queryByLabelText('Kode bank')).toBeNull();
    expect(screen.getAllByText(/Fundraiser Campaign ini/).length).toBeGreaterThanOrEqual(2);
  });

  it("replaces Tandai selesai with the explaining sentence for the Campaign's Fundraiser", async () => {
    await renderAs('fundraiser-1', APPROVED);

    expect(screen.queryByRole('button', { name: /tandai refund selesai/i })).toBeNull();
    expect(screen.queryByLabelText('Nomor rekening (ketik ulang)')).toBeNull();
    expect(screen.getAllByText(/Fundraiser Campaign ini/).length).toBeGreaterThanOrEqual(2);
  });
});
