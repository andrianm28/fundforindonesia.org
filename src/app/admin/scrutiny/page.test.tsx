import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignAuditMarker: { findMany: vi.fn() },
    donationReviewMarker: { findMany: vi.fn() },
    payment: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import AdminScrutinyPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function givenAdmin() {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } } as never);
}

function givenRows({
  audit = [],
  donations = [],
  sandboxPayments = [],
}: {
  audit?: unknown[];
  donations?: unknown[];
  /** What the sandbox-Gross lookup (src/lib/money/counted-payment.ts) finds. */
  sandboxPayments?: unknown[];
}) {
  vi.mocked(prisma.campaignAuditMarker.findMany).mockResolvedValue(audit as never);
  vi.mocked(prisma.donationReviewMarker.findMany).mockResolvedValue(donations as never);
  vi.mocked(prisma.payment.findMany).mockResolvedValue(sandboxPayments as never);
}

function donationMarker(over: Record<string, unknown> = {}) {
  return {
    id: 'dm-1',
    donationId: 'donation-1',
    amount: 60_000_000,
    threshold: 50_000_000,
    flaggedAt: new Date('2026-10-01T03:00:00.000Z'),
    campaign: { title: 'Bantu Korban Banjir', slug: 'bantu-korban-banjir' },
    ...over,
  };
}

function auditMarker(over: Record<string, unknown> = {}) {
  return {
    id: 'am-1',
    threshold: 500_000_000,
    placedAt: new Date('2026-10-02T03:00:00.000Z'),
    campaign: {
      id: 'campaign-1',
      title: 'Sumur untuk Desa',
      slug: 'sumur-untuk-desa',
      collectedAmount: 520_000_000,
    },
    ...over,
  };
}

/**
 * Ticket 67 (plan A-3): the read-only Admin screen over the two markers the
 * System writes at Settlement (src/lib/scrutiny.ts, prd-compliance 38):
 * Penanda Audit (a Campaign) and Penanda Donasi (a single Donation). The seams
 * are the page itself, given a session and the rows Prisma would answer, and
 * the sidebar link. The screen changes nothing and names no donor.
 */
describe('AdminScrutinyPage', () => {
  it('lists a Penanda Donasi with the Campaign it was made to, the amount and the limit it passed', async () => {
    givenAdmin();
    givenRows({ donations: [donationMarker()] });

    render(await AdminScrutinyPage());

    const section = screen.getByRole('region', { name: /penanda donasi/i });
    const row = within(section).getByText('Bantu Korban Banjir').closest('tr')!;
    expect(row.textContent).toMatch(/Rp60\.000\.000/);
    expect(row.textContent).toMatch(/Rp50\.000\.000/);
    expect(row.textContent).toContain('donation-1');
    const link = within(row).getByRole('link', { name: 'Bantu Korban Banjir' });
    expect(link.getAttribute('href')).toBe('/campaign/bantu-korban-banjir');
  });

  it('lists a Penanda Audit with the Campaign, the Gross it has gathered and the limit it passed', async () => {
    givenAdmin();
    givenRows({ audit: [auditMarker()] });

    render(await AdminScrutinyPage());

    const section = screen.getByRole('region', { name: /penanda audit/i });
    const row = within(section).getByText('Sumur untuk Desa').closest('tr')!;
    expect(row.textContent).toMatch(/Rp520\.000\.000/);
    expect(row.textContent).toMatch(/Rp500\.000\.000/);
    const link = within(row).getByRole('link', { name: 'Sumur untuk Desa' });
    expect(link.getAttribute('href')).toBe('/campaign/sumur-untuk-desa');
  });

  // Beta data (ticket 92): Campaign.collectedAmount is a lifetime counter that
  // sandbox Payments also incremented, and a marker's own cumulativeGross was
  // read from it at Settlement, so neither may be printed as a Gross. The
  // figure is the counter less the sandbox Gross, the way every other real
  // figure is read (src/lib/money/counted-payment.ts).
  it('shows the Gross without test money: sandbox Payments are taken off the counter, and the marker\'s own snapshot is not used', async () => {
    givenAdmin();
    givenRows({
      audit: [
        auditMarker({
          cumulativeGross: 590_000_000,
          campaign: { id: 'campaign-1', title: 'Sumur untuk Desa', slug: 'sumur-untuk-desa', collectedAmount: 580_000_000 },
        }),
      ],
      sandboxPayments: [{ amount: 40_000_000, donation: { campaignId: 'campaign-1' } }],
    });

    render(await AdminScrutinyPage());

    const row = screen.getByText('Sumur untuk Desa').closest('tr')!;
    expect(row.textContent).toMatch(/Rp540\.000\.000/);
    expect(row.textContent).not.toMatch(/580\.000\.000|590\.000\.000/);
  });

  it('leaves out a Penanda Audit that only test money pushed over the limit', async () => {
    givenAdmin();
    givenRows({
      audit: [
        auditMarker({
          campaign: { id: 'campaign-1', title: 'Hanya Donasi Uji', slug: 'hanya-donasi-uji', collectedAmount: 520_000_000 },
        }),
      ],
      sandboxPayments: [{ amount: 60_000_000, donation: { campaignId: 'campaign-1' } }],
    });

    render(await AdminScrutinyPage());

    expect(screen.queryByText('Hanya Donasi Uji')).toBeNull();
    const section = screen.getByRole('region', { name: /penanda audit/i });
    expect(within(section).getByText(/belum ada penanda audit/i)).toBeDefined();
  });

  it('says so when a list has no marker', async () => {
    givenAdmin();
    givenRows({});

    render(await AdminScrutinyPage());

    expect(screen.getByText(/belum ada penanda audit/i)).toBeDefined();
    expect(screen.getByText(/belum ada penanda donasi/i)).toBeDefined();
  });

  // The screen is for what a Donation's size says about the Campaign, not about
  // the person: no name, no contact detail, no Donor link. The rows below
  // deliberately carry the places such a thing could be read from, so the test
  // fails the day a column starts printing one. A Donation made anonymously
  // (isAnonymous, or anonymised since) keeps its name hidden because this page
  // never has one to show.
  it('prints nothing that identifies a Donor, anonymous or not', async () => {
    givenAdmin();
    givenRows({
      donations: [
        donationMarker({
          donation: {
            isAnonymous: true,
            guestName: 'Budi Rahasia',
            guestEmailHmac: 'abc123hmac',
            donor: { name: 'Siti Donatur', email: 'siti@example.org' },
          },
        }),
        donationMarker({
          id: 'dm-2',
          donationId: 'donation-2',
          donation: { isAnonymous: false, guestName: 'Joko Terang', donor: null },
        }),
      ],
    });

    render(await AdminScrutinyPage());

    const text = document.body.textContent ?? '';
    for (const personal of ['Budi Rahasia', 'Siti Donatur', 'siti@example.org', 'abc123hmac', 'Joko Terang']) {
      expect(text).not.toContain(personal);
    }
  });

  // Ordering and the cut-off belong to the database, so the contract is the
  // query itself: the newest markers first, a bounded number of them, the same
  // 100 GET /api/admin/scrutiny answers.
  it('asks for the newest markers first, 100 at most, of each kind', async () => {
    givenAdmin();
    givenRows({});

    await AdminScrutinyPage();

    expect(prisma.campaignAuditMarker.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { placedAt: 'desc' }, take: 100 }),
    );
    expect(prisma.donationReviewMarker.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { flaggedAt: 'desc' }, take: 100 }),
    );
  });

  // Beta data (ticket 92): a Donation settled by a sandbox Payment is test data.
  // Whether a Donation counts is the Payment's say, through the one predicate
  // (countedPaymentWhere), and the proof against a real database is in
  // src/__tests__/integration/admin-scrutiny-page-real-db.test.ts; this pins
  // that the question is asked at all, in the query, so the 100-row cut-off
  // applies to markers that are shown.
  it('only asks for Penanda Donasi whose Donation settled with a Payment that counts', async () => {
    givenAdmin();
    givenRows({});

    await AdminScrutinyPage();

    expect(prisma.donationReviewMarker.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          donation: {
            payments: {
              some: expect.objectContaining({ sandbox: false, status: { in: ['PAID', 'REFUNDED'] } }),
            },
          },
        },
      }),
    );
  });

  // Admin power comes only from the ADMIN assignment (ADR 0005). The /admin
  // layout and the proxy already turn these viewers away; the page answers 404
  // on its own as well, because a layout does not re-run on a client
  // navigation, and reads nothing before it has.
  it.each([
    ['nobody signed in', null],
    ['a Verifier: the VERIFIER assignment is not Admin', { user: { id: 'ver-1', assignments: ['VERIFIER'] } }],
    ['someone with the ADMIN Role but not the ADMIN assignment', { user: { id: 'u-1', role: 'ADMIN', assignments: [] } }],
  ])('404s for %s, and reads no marker', async (_who, session) => {
    vi.mocked(getServerSession).mockResolvedValue(session as never);
    givenRows({ donations: [donationMarker()] });

    await expect(AdminScrutinyPage()).rejects.toThrow('NEXT_NOT_FOUND');

    expect(prisma.donationReviewMarker.findMany).not.toHaveBeenCalled();
    expect(prisma.campaignAuditMarker.findMany).not.toHaveBeenCalled();
  });
});
