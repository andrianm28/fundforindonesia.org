import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    donation: { findUnique: vi.fn() },
    receipt: { findUnique: vi.fn() },
    payment: { findFirst: vi.fn() },
    campaign: { findUnique: vi.fn() },
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { prisma } from '@/lib/prisma';
import AdminNewRefundPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * ticket 23: an Admin creates a Refund for a Donation, found by its id or
 * its Receipt token (CONTEXT.md, Receipt) -- the two handles a Donation is
 * ever looked up by elsewhere in this codebase (donasi-saya, receipt/[token]).
 * Resolving to a Payment and Campaign slug here, server-side, is what lets
 * the create form below post to the existing
 * POST /api/campaigns/[slug]/refunds route unchanged.
 */
describe('AdminNewRefundPage', () => {
  it('shows a search form with no query yet', async () => {
    render(await AdminNewRefundPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByLabelText(/id donasi atau token resi/i)).toBeDefined();
    expect(screen.queryByLabelText(/jumlah refund/i)).toBeNull();
  });

  it('resolves a Donation by id and shows the create form with its Campaign and paid Payment', async () => {
    vi.mocked(prisma.donation.findUnique).mockResolvedValue({
      id: 'donation-1',
      campaign: { id: 'campaign-1', slug: 'wakaf-sumur', title: 'Wakaf Sumur', kind: 'WAKAF' },
    } as never);
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({ id: 'payment-1', amount: 500_000 } as never);

    render(await AdminNewRefundPage({ searchParams: Promise.resolve({ q: 'donation-1' }) }));

    expect(screen.getByText('Wakaf Sumur')).toBeDefined();
    expect(screen.getByText(/Rp500\.000/)).toBeDefined();
    expect(screen.getByLabelText(/jumlah refund/i)).toBeDefined();
  });

  it('falls back to a Receipt token lookup when no Donation matches the id', async () => {
    vi.mocked(prisma.donation.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.receipt.findUnique).mockResolvedValue({
      donation: {
        id: 'donation-2',
        campaign: { id: 'campaign-2', slug: 'zakat-fitrah', title: 'Zakat Fitrah', kind: 'ZAKAT' },
      },
    } as never);
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({ id: 'payment-2', amount: 100_000 } as never);

    render(await AdminNewRefundPage({ searchParams: Promise.resolve({ q: 'rcpt-token-abc' }) }));

    expect(screen.getByText('Zakat Fitrah')).toBeDefined();
    expect(screen.getByLabelText(/jumlah refund/i)).toBeDefined();
  });

  it('shows a not-found message when neither lookup matches', async () => {
    vi.mocked(prisma.donation.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.receipt.findUnique).mockResolvedValue(null);

    render(await AdminNewRefundPage({ searchParams: Promise.resolve({ q: 'nope' }) }));

    expect(screen.getByText(/tidak ditemukan/i)).toBeDefined();
    expect(screen.queryByLabelText(/jumlah refund/i)).toBeNull();
  });

  it('shows a message, no create form, when the Donation has no paid Payment yet', async () => {
    vi.mocked(prisma.donation.findUnique).mockResolvedValue({
      id: 'donation-3',
      campaign: { id: 'campaign-1', slug: 'wakaf-sumur', title: 'Wakaf Sumur', kind: 'WAKAF' },
    } as never);
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(null);

    render(await AdminNewRefundPage({ searchParams: Promise.resolve({ q: 'donation-3' }) }));

    expect(screen.getByText(/belum ada payment yang lunas/i)).toBeDefined();
    expect(screen.queryByLabelText(/jumlah refund/i)).toBeNull();
  });

  it('hints the technical-failure-only rule for a restricted Kind (server enforces; this is a hint)', async () => {
    vi.mocked(prisma.donation.findUnique).mockResolvedValue({
      id: 'donation-1',
      campaign: { id: 'campaign-1', slug: 'wakaf-sumur', title: 'Wakaf Sumur', kind: 'WAKAF' },
    } as never);
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({ id: 'payment-1', amount: 500_000 } as never);

    render(await AdminNewRefundPage({ searchParams: Promise.resolve({ q: 'donation-1' }) }));

    expect(screen.getByText(/salah bayar/i)).toBeDefined();
  });
});
