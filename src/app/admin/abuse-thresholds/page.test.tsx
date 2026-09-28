import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    abuseThreshold: { findMany: vi.fn() },
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { prisma } from '@/lib/prisma';
import AdminAbuseThresholdsPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Ticket 27: reads and edits the four limits in src/lib/abuse-thresholds.ts
 * (CONTEXT.md, Verifikasi Tambahan / Penanda Audit / Penanda Donasi), the
 * append-only rows setAbuseThreshold writes and resolveAbuseThresholds
 * reads -- both the Admin's own row and the PRD default when nobody has set
 * one. Petunjuk Duplikat's title similarity is a different table and stays
 * out of scope (ticket 04's answer, Fase 3).
 */
describe('AdminAbuseThresholdsPage', () => {
  it('shows the PRD default for a limit nobody has set', async () => {
    vi.mocked(prisma.abuseThreshold.findMany).mockResolvedValue([] as never);

    render(await AdminAbuseThresholdsPage());

    // ABUSE_THRESHOLD_DEFAULTS.donationReviewAmount = 50_000_000
    expect(screen.getByLabelText(/penanda donasi/i)).toHaveValue('50000000');
    // ABUSE_THRESHOLD_DEFAULTS.campaignReviewGross = 100_000_000
    expect(screen.getByLabelText(/verifikasi tambahan/i)).toHaveValue('100000000');
    // ABUSE_THRESHOLD_DEFAULTS.campaignAuditGross = 500_000_000
    expect(screen.getByLabelText(/penanda audit/i)).toHaveValue('500000000');
    // ABUSE_THRESHOLD_DEFAULTS.activeCampaignsPerFundraiser = 3
    expect(screen.getByLabelText(/batas campaign active/i)).toHaveValue('3');
  });

  it("shows an Admin's latest row for a limit that has been set", async () => {
    vi.mocked(prisma.abuseThreshold.findMany).mockResolvedValue([
      {
        kind: 'DONATION_REVIEW_AMOUNT',
        value: 75_000_000,
        setById: 'admin-1',
        setAt: new Date('2026-09-20T00:00:00.000Z'),
      },
    ] as never);

    render(await AdminAbuseThresholdsPage());

    expect(screen.getByLabelText(/penanda donasi/i)).toHaveValue('75000000');
  });
});
