import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

// Ticket 45. This is the first and only production trigger for
// runScheduledJobs: before it, nothing in the repo called that function, so
// matured escrow was released only when a Fundraiser happened to request a
// Payout and no reminder was ever sent at all.
//
// The seam under test is the HTTP boundary. The three phases behind it are
// already covered where they live (src/lib/money/escrow.test.ts,
// src/lib/reminders.test.ts), so prisma and the mailer -- the two system
// boundaries -- are mocked and everything between is real: the route calls
// the real runScheduledJobs, which calls the real sweeps. "Runs nothing",
// "releases nothing on a second call" and "sends one reminder, not two" are
// then assertions about state that actually moved, not about which functions
// happened to be called.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    payment: { findMany: vi.fn() },
    campaign: { findMany: vi.fn() },
    kindAuthorisation: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/mail', () => ({
  sendReportingFailure: vi.fn().mockResolvedValue(true),
}));

import { sealUserEmail } from '@/lib/contact-fields';
import { prisma } from '@/lib/prisma';
import { sendReportingFailure } from '@/lib/mail';
import { POST } from './route';

const mockPaymentFindMany = prisma.payment.findMany as unknown as Mock;
const mockCampaignFindMany = prisma.campaign.findMany as unknown as Mock;
const mockKindAuthFindMany = prisma.kindAuthorisation.findMany as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockSendReportingFailure = sendReportingFailure as unknown as Mock;

const SECRET = 'correct-horse-battery-staple';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const FUNDRAISER_EMAIL = 'budi@example.test';

function post(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/internal/jobs/run', { method: 'POST', headers });
}

/**
 * An in-memory database holding one of everything the three phases look for:
 * a Payment whose 7-day hold has matured, a Campaign whose deadline is two
 * days out, and a Kind Authorisation expiring in ten days. Each claim
 * predicate (`escrowReleasedAt IS NULL`, `deadlineReminderSentAt IS NULL`,
 * `expiryWarningSentAt IS NULL`) is honoured against this shared state, and
 * every write is recorded, so a second call through the route has to find
 * genuinely nothing left to do.
 *
 * Times are relative to the live clock on purpose: the route reads the real
 * `new Date()`, and these horizons are days wide, so no fake timer is needed
 * to place a row inside or outside a sweep window.
 */
function makeDb() {
  const now = new Date();
  const payment = {
    id: 'payment-1',
    status: 'PAID',
    amount: 100_000,
    providerFee: 0,
    donationId: 'donation-1',
    registrationId: null,
    escrowReleaseAt: new Date(now.getTime() - MS_PER_DAY),
    escrowReleasedAt: null as Date | null,
    donation: { campaignId: 'campaign-1' },
    registration: null,
  };
  const campaign = {
    id: 'campaign-1',
    slug: 'bantu-sekolah',
    title: 'Bantu Sekolah',
    // Two days out: inside CAMPAIGN_DEADLINE_REMINDER_DAYS, and in the
    // future, so the subject is still ACTIVE and its escrow is not frozen.
    deadline: new Date(now.getTime() + 2 * MS_PER_DAY),
    lifecycleStatus: 'ACTIVE',
    creatorId: 'fundraiser-1',
    deadlineReminderSentAt: null as Date | null,
    creator: { name: 'Budi', ...sealUserEmail(FUNDRAISER_EMAIL) },
  };
  const authorisation = {
    id: 'authorisation-1',
    kind: 'ZAKAT',
    validFrom: new Date(now.getTime() - MS_PER_DAY),
    validTo: new Date(now.getTime() + 10 * MS_PER_DAY),
    expiryWarningSentAt: null as Date | null,
    partnerOrganisation: {
      name: 'Yayasan Merdeka',
      fundraiserId: 'fundraiser-1',
      fundraiser: { name: 'Budi', ...sealUserEmail(FUNDRAISER_EMAIL) },
    },
  };

  const ledger: Record<string, unknown>[] = [];
  const notifications: Record<string, unknown>[] = [];

  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
    campaign: {
      findUnique: vi.fn(async () => ({
        creatorId: 'fundraiser-1',
        isDemo: false,
        lifecycleStatus: 'ACTIVE',
        deadline: null,
        kind: 'DONATION',
        collectingEntityId: null,
      })),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string; deadlineReminderSentAt: null }; data: Record<string, unknown> }) => {
          if (campaign.id !== where.id || campaign.deadlineReminderSentAt !== where.deadlineReminderSentAt) {
            return { count: 0 };
          }
          Object.assign(campaign, data);
          return { count: 1 };
        },
      ),
    },
    payment: {
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string; escrowReleasedAt: null }; data: Record<string, unknown> }) => {
          if (payment.id !== where.id || payment.escrowReleasedAt !== where.escrowReleasedAt) return { count: 0 };
          Object.assign(payment, data);
          return { count: 1 };
        },
      ),
    },
    kindAuthorisation: {
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string; expiryWarningSentAt: null }; data: Record<string, unknown> }) => {
          if (authorisation.id !== where.id || authorisation.expiryWarningSentAt !== where.expiryWarningSentAt) {
            return { count: 0 };
          }
          Object.assign(authorisation, data);
          return { count: 1 };
        },
      ),
    },
    notification: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        notifications.push(data);
        return data;
      }),
    },
    // No Refund against this Payment: nothing is in flight and nothing has
    // already taken a share, so the sweep releases the full net.
    refund: { findMany: vi.fn().mockResolvedValue([]) },
    ledgerEntry: {
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        ledger.push(...data);
        return { count: data.length };
      }),
    },
  };

  mockPaymentFindMany.mockImplementation(
    async ({ where }: { where: { status: string; escrowReleaseAt: { lte: Date }; escrowReleasedAt: null } }) => {
      const matches =
        payment.status === where.status &&
        payment.escrowReleasedAt === where.escrowReleasedAt &&
        payment.escrowReleaseAt.getTime() <= where.escrowReleaseAt.lte.getTime();
      return matches ? [{ ...payment }] : [];
    },
  );

  mockCampaignFindMany.mockImplementation(
    async ({ where }: { where: { lifecycleStatus: string; deadline: { gt: Date; lte: Date }; deadlineReminderSentAt: null } }) => {
      const matches =
        campaign.lifecycleStatus === where.lifecycleStatus &&
        campaign.deadlineReminderSentAt === where.deadlineReminderSentAt &&
        campaign.deadline.getTime() > where.deadline.gt.getTime() &&
        campaign.deadline.getTime() <= where.deadline.lte.getTime();
      return matches ? [{ ...campaign }] : [];
    },
  );

  mockKindAuthFindMany.mockImplementation(
    async ({ where }: { where: { validFrom: { lte: Date }; validTo: { gt: Date; lte: Date }; expiryWarningSentAt: null } }) => {
      const matches =
        authorisation.expiryWarningSentAt === where.expiryWarningSentAt &&
        authorisation.validFrom.getTime() <= where.validFrom.lte.getTime() &&
        authorisation.validTo.getTime() > where.validTo.gt.getTime() &&
        authorisation.validTo.getTime() <= where.validTo.lte.getTime();
      return matches ? [{ ...authorisation }] : [];
    },
  );

  mockTransaction.mockImplementation(async (cb: (client: unknown) => unknown) => cb(tx));

  return { ledger, notifications, campaign, authorisation, payment };
}

describe('POST /api/internal/jobs/run -- the secret', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JOBS_SECRET = SECRET;
    // Nothing has matured: these tests are about who is allowed in, so any
    // call into the database at all is the failure.
    mockPaymentFindMany.mockResolvedValue([]);
    mockCampaignFindMany.mockResolvedValue([]);
    mockKindAuthFindMany.mockResolvedValue([]);
  });

  afterEach(() => {
    delete process.env.JOBS_SECRET;
  });

  it('refuses a request with no secret at all, and runs nothing', async () => {
    const response = await POST(post());

    expect(response.status).toBe(401);
    expect(mockPaymentFindMany).not.toHaveBeenCalled();
    expect(mockCampaignFindMany).not.toHaveBeenCalled();
    expect(mockKindAuthFindMany).not.toHaveBeenCalled();
    expect(mockSendReportingFailure).not.toHaveBeenCalled();
  });

  it('refuses a request whose secret is wrong, and runs nothing', async () => {
    const response = await POST(post({ 'x-jobs-secret': 'not-the-secret' }));

    expect(response.status).toBe(401);
    expect(mockPaymentFindMany).not.toHaveBeenCalled();
    expect(mockSendReportingFailure).not.toHaveBeenCalled();
  });

  it('refuses everything when JOBS_SECRET is not configured, rather than running unauthenticated', async () => {
    delete process.env.JOBS_SECRET;

    const response = await POST(post());

    expect(response.status).toBe(503);
    expect(mockPaymentFindMany).not.toHaveBeenCalled();
  });

  it('never caches the response, refused or not', async () => {
    const refused = await POST(post());

    expect(refused.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('POST /api/internal/jobs/run -- an authorised run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JOBS_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.JOBS_SECRET;
  });

  it('runs all three phases and reports each phase\'s own counts', async () => {
    makeDb();

    const response = await POST(post({ 'x-jobs-secret': SECRET }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      result: {
        escrowRelease: { releasedCount: 1, consideredCount: 1 },
        campaignDeadlineReminders: { attemptedCount: 1, consideredCount: 1 },
        kindAuthorisationExpiryWarnings: { attemptedCount: 1, consideredCount: 1 },
      },
    });
  });

  it('releases the matured hold out of escrow and credits the campaign balance', async () => {
    const db = makeDb();

    await POST(post({ 'x-jobs-secret': SECRET }));

    // The two legs escrowReleaseLegs posts: out of ESCROW_HOLD, into the
    // Campaign's withdrawable balance. The hold is the money; this is the
    // whole point of the route existing.
    expect(db.ledger).toEqual([
      expect.objectContaining({ account: 'ESCROW_HOLD', direction: 'DEBIT', amount: 100_000, campaignId: 'campaign-1' }),
      expect.objectContaining({ account: 'CAMPAIGN_BALANCE', direction: 'CREDIT', amount: 100_000, campaignId: 'campaign-1' }),
    ]);
  });

  it('reports counts only: no secret, no email address, no name, no title', async () => {
    makeDb();

    const response = await POST(post({ 'x-jobs-secret': SECRET }));
    const body = JSON.stringify(await response.json());

    expect(body).not.toContain(SECRET);
    expect(body).not.toContain(FUNDRAISER_EMAIL);
    expect(body).not.toContain('Budi');
    expect(body).not.toContain('Bantu Sekolah');
  });
});

describe('POST /api/internal/jobs/run -- a repeated call', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JOBS_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.JOBS_SECRET;
  });

  it('releases nothing and sends nothing the second time, however often it is called', async () => {
    const db = makeDb();

    await POST(post({ 'x-jobs-secret': SECRET }));
    const second = await POST(post({ 'x-jobs-secret': SECRET }));
    const third = await POST(post({ 'x-jobs-secret': SECRET }));

    // Three runs, one set of effects. This is what makes a scheduler safe to
    // retry, to run twice on the hour, and to overlap itself.
    expect(db.ledger).toHaveLength(2);
    expect(db.notifications).toHaveLength(2);
    expect(mockSendReportingFailure).toHaveBeenCalledTimes(2);
    expect(await second.json()).toEqual({
      ok: true,
      result: {
        escrowRelease: { releasedCount: 0, consideredCount: 0 },
        campaignDeadlineReminders: { attemptedCount: 0, consideredCount: 0 },
        kindAuthorisationExpiryWarnings: { attemptedCount: 0, consideredCount: 0 },
      },
    });
    expect((await third.json()).result.escrowRelease.releasedCount).toBe(0);
  });

  it('leaves money that has not matured alone', async () => {
    const db = makeDb();
    // The hold matures in six days: still escrow, still nobody's to withdraw.
    db.payment.escrowReleaseAt = new Date(Date.now() + 6 * MS_PER_DAY);

    await POST(post({ 'x-jobs-secret': SECRET }));

    expect(db.ledger).toEqual([]);
    expect(db.payment.escrowReleasedAt).toBeNull();
  });
});
