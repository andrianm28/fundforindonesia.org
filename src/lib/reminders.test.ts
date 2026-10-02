import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock prisma wholesale, matching src/lib/money/escrow.test.ts: the fake tx
// below runs real claim/notify semantics so assertions check what was
// actually written, not merely that some function was called.
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findMany: vi.fn() },
    kindAuthorisation: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// The email content itself (escaping, wording) is covered by
// src/lib/mail/reminders.test.ts; these tests only need to know
// sendReportingFailure was reached with the right recipient and report tag.
vi.mock('@/lib/mail', () => ({
  sendReportingFailure: vi.fn().mockResolvedValue(true),
}));

import { sealUserEmail } from '@/lib/contact-fields';
import { prisma } from '@/lib/prisma';
import { sendReportingFailure } from '@/lib/mail';
import {
  sendCampaignDeadlineReminders,
  sendKindAuthorisationExpiryWarnings,
  CAMPAIGN_DEADLINE_REMINDER_DAYS,
  KIND_AUTHORISATION_EXPIRY_WARNING_DAYS,
} from './reminders';

const mockCampaignFindMany = prisma.campaign.findMany as unknown as Mock;
const mockKindAuthFindMany = prisma.kindAuthorisation.findMany as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockSendReportingFailure = sendReportingFailure as unknown as Mock;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-27T00:00:00.000Z');

type CampaignRow = {
  id: string;
  slug: string;
  title: string;
  deadline: Date | null;
  lifecycleStatus: string;
  creatorId: string;
  deadlineReminderSentAt: Date | null;
  // The Fundraiser's address is a ciphertext (ADR 0012), decrypted where the
  // reminder is addressed.
  creator: { emailCiphertext: string; emailKeyId: string; name: string };
};

/** A Campaign row whose Fundraiser has the given address, sealed as stored. */
function makeCampaignWithFundraiser(
  email: string,
  overrides: Partial<CampaignRow> = {},
): CampaignRow {
  return {
    id: 'campaign-1',
    slug: 'bantu-sekolah',
    title: 'Bantu Sekolah',
    deadline: new Date(NOW.getTime() + 2 * MS_PER_DAY),
    lifecycleStatus: 'ACTIVE',
    creatorId: 'fundraiser-1',
    deadlineReminderSentAt: null,
    creator: { name: 'Budi', ...sealUserEmail(email) },
    ...overrides,
  };
}

function makeCampaign(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return makeCampaignWithFundraiser('fundraiser@example.test', overrides);
}

/**
 * A fake "database" of Campaign rows, wired so `campaign.findMany` applies
 * the same where-shape sendCampaignDeadlineReminders queries with, and
 * `$transaction` hands the callback a tx whose `campaign.updateMany` /
 * `notification.create` mutate the same shared state.
 */
function makeCampaignDb(campaigns: CampaignRow[]) {
  const state = new Map(campaigns.map((c) => [c.id, { ...c }]));
  const notifications: Record<string, unknown>[] = [];

  mockCampaignFindMany.mockImplementation(
    async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
      const deadlineFilter = where.deadline as { gt: Date; lte: Date };
      const matches = Array.from(state.values()).filter(
        (c) =>
          c.lifecycleStatus === where.lifecycleStatus &&
          c.deadlineReminderSentAt === (where.deadlineReminderSentAt as null) &&
          c.deadline !== null &&
          c.deadline.getTime() > deadlineFilter.gt.getTime() &&
          c.deadline.getTime() <= deadlineFilter.lte.getTime(),
      );
      return matches.slice(0, take ?? matches.length).map((c) => ({
        id: c.id,
        slug: c.slug,
        title: c.title,
        deadline: c.deadline,
        creatorId: c.creatorId,
        creator: c.creator,
      }));
    },
  );

  mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      campaign: {
        updateMany: vi.fn(
          async ({ where, data }: { where: { id: string; deadlineReminderSentAt: null }; data: Record<string, unknown> }) => {
            const row = state.get(where.id);
            if (!row || row.deadlineReminderSentAt !== where.deadlineReminderSentAt) return { count: 0 };
            Object.assign(row, data);
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
    }),
  );

  return { state, notifications };
}

describe('sendCampaignDeadlineReminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it(`sends a reminder for an Active Campaign whose deadline is within ${CAMPAIGN_DEADLINE_REMINDER_DAYS} days`, async () => {
    const { state, notifications } = makeCampaignDb([makeCampaign()]);

    const result = await sendCampaignDeadlineReminders(NOW);

    expect(result).toEqual({ attemptedCount: 1, consideredCount: 1 });
    expect(state.get('campaign-1')!.deadlineReminderSentAt).toEqual(NOW);
    expect(notifications).toEqual([
      expect.objectContaining({
        type: 'campaign_deadline_reminder',
        userId: 'fundraiser-1',
        link: '/campaign/bantu-sekolah',
      }),
    ]);
    expect(mockSendReportingFailure).toHaveBeenCalledTimes(1);
    const [message, report] = mockSendReportingFailure.mock.calls[0];
    expect(message.to).toBe('fundraiser@example.test');
    expect(report).toMatchObject({ mail: 'campaign_deadline_reminder', campaignId: 'campaign-1' });
  });

  it('uses the seven-day lead time the PRD asks for (FFI-03)', () => {
    expect(CAMPAIGN_DEADLINE_REMINDER_DAYS).toBe(7);
  });

  it('reminds a Campaign whose deadline is five days out, and exactly seven days out', async () => {
    makeCampaignDb([
      makeCampaign({ id: 'campaign-5d', slug: 'campaign-5d', deadline: new Date(NOW.getTime() + 5 * MS_PER_DAY) }),
      makeCampaign({ id: 'campaign-7d', slug: 'campaign-7d', deadline: new Date(NOW.getTime() + 7 * MS_PER_DAY) }),
    ]);

    const result = await sendCampaignDeadlineReminders(NOW);

    expect(result).toEqual({ attemptedCount: 2, consideredCount: 2 });
  });

  it('does not remind a Campaign whose deadline is just past seven days out', async () => {
    makeCampaignDb([makeCampaign({ deadline: new Date(NOW.getTime() + 7 * MS_PER_DAY + 1) })]);

    const result = await sendCampaignDeadlineReminders(NOW);

    expect(result).toEqual({ attemptedCount: 0, consideredCount: 0 });
  });

  it('does not remind a Campaign whose deadline is further out than the reminder window', async () => {
    makeCampaignDb([makeCampaign({ deadline: new Date(NOW.getTime() + 10 * MS_PER_DAY) })]);

    const result = await sendCampaignDeadlineReminders(NOW);

    expect(result).toEqual({ attemptedCount: 0, consideredCount: 0 });
    expect(mockSendReportingFailure).not.toHaveBeenCalled();
  });

  it('does not remind a Campaign whose deadline has already passed', async () => {
    makeCampaignDb([makeCampaign({ deadline: new Date(NOW.getTime() - MS_PER_DAY) })]);

    const result = await sendCampaignDeadlineReminders(NOW);

    expect(result).toEqual({ attemptedCount: 0, consideredCount: 0 });
  });

  it('never reconsiders a Campaign that was already reminded', async () => {
    makeCampaignDb([makeCampaign({ deadlineReminderSentAt: new Date(NOW.getTime() - MS_PER_DAY) })]);

    const result = await sendCampaignDeadlineReminders(NOW);

    expect(result).toEqual({ attemptedCount: 0, consideredCount: 0 });
    expect(mockSendReportingFailure).not.toHaveBeenCalled();
  });

  it('does not remind again a Campaign already reminded under the old three-day rule, now inside the seven-day window', async () => {
    makeCampaignDb([
      makeCampaign({
        deadline: new Date(NOW.getTime() + 2 * MS_PER_DAY),
        deadlineReminderSentAt: new Date(NOW.getTime() - MS_PER_DAY),
      }),
    ]);

    const result = await sendCampaignDeadlineReminders(NOW);

    expect(result).toEqual({ attemptedCount: 0, consideredCount: 0 });
    expect(mockSendReportingFailure).not.toHaveBeenCalled();
  });

  it('sends exactly one reminder when two overlapping scheduler runs race for the same Campaign', async () => {
    const { notifications } = makeCampaignDb([makeCampaign()]);

    const [a, b] = await Promise.all([sendCampaignDeadlineReminders(NOW), sendCampaignDeadlineReminders(NOW)]);

    expect(a.attemptedCount + b.attemptedCount).toBe(1);
    expect(notifications).toHaveLength(1);
    expect(mockSendReportingFailure).toHaveBeenCalledTimes(1);
  });

  it("one Campaign's failure does not stop the rest of the sweep", async () => {
    const { notifications } = makeCampaignDb([
      makeCampaign({ id: 'campaign-bad', slug: 'campaign-bad' }),
      makeCampaign({ id: 'campaign-good', slug: 'campaign-good' }),
    ]);
    mockSendReportingFailure.mockRejectedValueOnce(new Error('mailer exploded'));

    const result = await sendCampaignDeadlineReminders(NOW);

    // Both were claimed and notified in-app (the transaction, not the best-
    // effort email, is what "sent" means here); only the email for the first
    // one blew up, and that must not have stopped the second from being
    // claimed and notified too.
    expect(result.consideredCount).toBe(2);
    expect(notifications).toHaveLength(2);
  });
});

type KindAuthorisationRow = {
  id: string;
  kind: 'DONATION' | 'ZAKAT' | 'WAKAF' | 'HIBAH';
  validFrom: Date;
  validTo: Date;
  expiryWarningSentAt: Date | null;
  partnerOrganisation: {
    name: string;
    fundraiserId: string;
    // Sealed, as stored (ADR 0012).
    fundraiser: { emailCiphertext: string; emailKeyId: string; name: string };
  };
};

function makeKindAuthorisation(overrides: Partial<KindAuthorisationRow> = {}): KindAuthorisationRow {
  return {
    id: 'kind-auth-1',
    kind: 'ZAKAT',
    validFrom: new Date(NOW.getTime() - 30 * MS_PER_DAY),
    validTo: new Date(NOW.getTime() + 10 * MS_PER_DAY),
    expiryWarningSentAt: null,
    partnerOrganisation: {
      name: 'Yayasan Contoh',
      fundraiserId: 'fundraiser-org-1',
      fundraiser: { name: 'Siti', ...sealUserEmail('org@example.test') },
    },
    ...overrides,
  };
}

function makeKindAuthorisationDb(rows: KindAuthorisationRow[]) {
  const state = new Map(rows.map((r) => [r.id, { ...r }]));
  const notifications: Record<string, unknown>[] = [];

  mockKindAuthFindMany.mockImplementation(
    async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
      const validFromFilter = where.validFrom as { lte: Date };
      const validToFilter = where.validTo as { gt: Date; lte: Date };
      const matches = Array.from(state.values()).filter(
        (r) =>
          r.expiryWarningSentAt === (where.expiryWarningSentAt as null) &&
          r.validFrom.getTime() <= validFromFilter.lte.getTime() &&
          r.validTo.getTime() > validToFilter.gt.getTime() &&
          r.validTo.getTime() <= validToFilter.lte.getTime(),
      );
      return matches.slice(0, take ?? matches.length).map((r) => ({
        id: r.id,
        kind: r.kind,
        validTo: r.validTo,
        partnerOrganisation: r.partnerOrganisation,
      }));
    },
  );

  mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      kindAuthorisation: {
        updateMany: vi.fn(
          async ({ where, data }: { where: { id: string; expiryWarningSentAt: null }; data: Record<string, unknown> }) => {
            const row = state.get(where.id);
            if (!row || row.expiryWarningSentAt !== where.expiryWarningSentAt) return { count: 0 };
            Object.assign(row, data);
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
    }),
  );

  return { state, notifications };
}

describe('sendKindAuthorisationExpiryWarnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it(`warns a Partner Organisation whose Kind Authorisation expires within ${KIND_AUTHORISATION_EXPIRY_WARNING_DAYS} days`, async () => {
    const { state, notifications } = makeKindAuthorisationDb([makeKindAuthorisation()]);

    const result = await sendKindAuthorisationExpiryWarnings(NOW);

    expect(result).toEqual({ attemptedCount: 1, consideredCount: 1 });
    expect(state.get('kind-auth-1')!.expiryWarningSentAt).toEqual(NOW);
    expect(notifications).toEqual([
      expect.objectContaining({ type: 'kind_authorisation_expiry_warning', userId: 'fundraiser-org-1' }),
    ]);
    const [message, report] = mockSendReportingFailure.mock.calls[0];
    expect(message.to).toBe('org@example.test');
    expect(report).toMatchObject({ mail: 'kind_authorisation_expiry_warning', kindAuthorisationId: 'kind-auth-1' });
  });

  it('does not warn about an authorisation expiring further out than the warning window', async () => {
    makeKindAuthorisationDb([makeKindAuthorisation({ validTo: new Date(NOW.getTime() + 60 * MS_PER_DAY) })]);

    const result = await sendKindAuthorisationExpiryWarnings(NOW);

    expect(result).toEqual({ attemptedCount: 0, consideredCount: 0 });
  });

  it('does not warn about an authorisation that has already lapsed', async () => {
    makeKindAuthorisationDb([
      makeKindAuthorisation({
        validFrom: new Date(NOW.getTime() - 60 * MS_PER_DAY),
        validTo: new Date(NOW.getTime() - MS_PER_DAY),
      }),
    ]);

    const result = await sendKindAuthorisationExpiryWarnings(NOW);

    expect(result).toEqual({ attemptedCount: 0, consideredCount: 0 });
  });

  it('does not warn about an authorisation not valid yet', async () => {
    makeKindAuthorisationDb([
      makeKindAuthorisation({
        validFrom: new Date(NOW.getTime() + MS_PER_DAY),
        validTo: new Date(NOW.getTime() + 5 * MS_PER_DAY),
      }),
    ]);

    const result = await sendKindAuthorisationExpiryWarnings(NOW);

    expect(result).toEqual({ attemptedCount: 0, consideredCount: 0 });
  });

  it('never reconsiders an authorisation already warned about', async () => {
    makeKindAuthorisationDb([makeKindAuthorisation({ expiryWarningSentAt: new Date(NOW.getTime() - MS_PER_DAY) })]);

    const result = await sendKindAuthorisationExpiryWarnings(NOW);

    expect(result).toEqual({ attemptedCount: 0, consideredCount: 0 });
  });

  it('sends exactly one warning when two overlapping scheduler runs race for the same authorisation', async () => {
    const { notifications } = makeKindAuthorisationDb([makeKindAuthorisation()]);

    const [a, b] = await Promise.all([
      sendKindAuthorisationExpiryWarnings(NOW),
      sendKindAuthorisationExpiryWarnings(NOW),
    ]);

    expect(a.attemptedCount + b.attemptedCount).toBe(1);
    expect(notifications).toHaveLength(1);
  });
});
