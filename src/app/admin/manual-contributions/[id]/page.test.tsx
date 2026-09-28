import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    manualContribution: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import AdminManualContributionDetailPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseContribution = {
  id: 'mc-1',
  amount: 250_000,
  proofReference: 'bukti.pdf',
  note: 'transfer tunai',
  status: 'PENDING',
  recordedById: 'admin-1',
  decidedById: null,
  decidedAt: null,
  decisionReason: null,
  reversedById: null,
  reversedAt: null,
  createdAt: new Date('2026-09-20T00:00:00.000Z'),
  recordedBy: { name: 'Admin Satu' },
  decidedBy: null,
  reversedBy: null,
  campaign: { title: 'Wakaf Sumur' },
  program: null,
};

/**
 * Ticket 26: one Manual Contribution, for the Admin acting on it -- record
 * (elsewhere) -> approve/reject (a different Admin) -> reverse (a third).
 * The form half of /admin/manual-contributions, which only lists.
 */
describe('AdminManualContributionDetailPage', () => {
  it('shows the subject, amount, proof and note', async () => {
    vi.mocked(prisma.manualContribution.findUnique).mockResolvedValue(baseContribution as never);
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2' } } as never);

    render(await AdminManualContributionDetailPage({ params: Promise.resolve({ id: 'mc-1' }) }));

    expect(screen.getByText('Wakaf Sumur')).toBeDefined();
    expect(screen.getByText(/Rp250\.000/)).toBeDefined();
    expect(screen.getByText('bukti.pdf')).toBeDefined();
    expect(screen.getByText('transfer tunai')).toBeDefined();
  });

  it('renders the decision form for a PENDING record', async () => {
    vi.mocked(prisma.manualContribution.findUnique).mockResolvedValue(baseContribution as never);
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2' } } as never);

    render(await AdminManualContributionDetailPage({ params: Promise.resolve({ id: 'mc-1' }) }));

    expect(screen.getByRole('button', { name: /setujui/i })).toBeDefined();
  });

  it('404s when the record does not exist', async () => {
    vi.mocked(prisma.manualContribution.findUnique).mockResolvedValue(null);
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2' } } as never);

    await expect(
      AdminManualContributionDetailPage({ params: Promise.resolve({ id: 'missing' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows the Program title for a Program-targeted contribution', async () => {
    vi.mocked(prisma.manualContribution.findUnique).mockResolvedValue({
      ...baseContribution,
      campaign: null,
      program: { title: 'Program Pendidikan' },
    } as never);
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-2' } } as never);

    render(await AdminManualContributionDetailPage({ params: Promise.resolve({ id: 'mc-1' }) }));

    expect(screen.getByText('Program Pendidikan')).toBeDefined();
  });
});
