import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    program: { findUnique: vi.fn() },
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { prisma } from '@/lib/prisma';
import AdminNewManualContributionPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Ticket 26: an Admin finds the Campaign or Program a Manual Contribution
 * targets by its slug -- the same handle a Campaign or a Program is ever
 * looked up by elsewhere (its public slug), not by a new search feature
 * this ticket does not ask for. Resolving to the target's id happens HERE,
 * server-side, so AdminManualContributionCreateForm can post the real id
 * POST /api/admin/manual-contributions expects, the same shape
 * /admin/refunds/new already uses for a Donation.
 */
describe('AdminNewManualContributionPage', () => {
  it('shows the search form with no query', async () => {
    render(await AdminNewManualContributionPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByLabelText(/slug campaign atau program/i)).toBeDefined();
  });

  it('resolves a Campaign by slug and shows the record form', async () => {
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
      id: 'campaign-1',
      title: 'Wakaf Sumur',
    } as never);

    render(
      await AdminNewManualContributionPage({ searchParams: Promise.resolve({ q: 'wakaf-sumur' }) }),
    );

    expect(prisma.campaign.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'wakaf-sumur' } }),
    );
    expect(screen.getByText('Wakaf Sumur')).toBeDefined();
    expect(screen.getByLabelText(/bukti transfer/i)).toBeDefined();
  });

  it('falls back to a Program by slug when no Campaign matches', async () => {
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.program.findUnique).mockResolvedValue({
      id: 'program-1',
      title: 'Program Pendidikan',
    } as never);

    render(
      await AdminNewManualContributionPage({ searchParams: Promise.resolve({ q: 'program-pendidikan' }) }),
    );

    expect(screen.getByText('Program Pendidikan')).toBeDefined();
  });

  it('shows a not-found message when neither matches', async () => {
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.program.findUnique).mockResolvedValue(null);

    render(
      await AdminNewManualContributionPage({ searchParams: Promise.resolve({ q: 'tidak-ada' }) }),
    );

    expect(screen.getByText(/tidak ditemukan/i)).toBeDefined();
  });
});
