import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// The failed notification queue phase (PKS pemenuhan 05) as the single
// scheduled entry point sees it: it runs with the injected `now` and Mailer,
// and its failure is isolated like every other phase's. What the phase itself
// does is tested against a real Postgres in
// src/__tests__/integration/failed-notification-queue-real-db.test.ts.
vi.mock('@/lib/money/escrow', () => ({ releaseMaturedEscrow: vi.fn() }));
vi.mock('@/lib/volunteer/refund-sweep', () => ({ sweepStuckLateSettlementRefunds: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/tim-csr', () => ({ anonymiseExpiredCompanies: vi.fn() }));
vi.mock('@/lib/reminders', () => ({
  sendCampaignDeadlineReminders: vi.fn(),
  sendKindAuthorisationExpiryWarnings: vi.fn(),
}));
vi.mock('@/lib/failed-notifications', () => ({ runNotificationQueuePhase: vi.fn() }));

import { anonymiseExpiredCompanies } from '@/lib/tim-csr';
import { releaseMaturedEscrow } from '@/lib/money/escrow';
import { runNotificationQueuePhase } from '@/lib/failed-notifications';
import { sendCampaignDeadlineReminders, sendKindAuthorisationExpiryWarnings } from '@/lib/reminders';
import { sweepStuckLateSettlementRefunds } from '@/lib/volunteer/refund-sweep';
import { runScheduledJobs, runScheduledJobsReport } from './scheduled-jobs';

const NOW = new Date('2026-11-10T08:00:00.000Z');
const queue = runNotificationQueuePhase as unknown as Mock;
const QUEUE_RESULT = { attemptedCount: 2, sentCount: 1, failedCount: 1, alertsSent: ['notification_queue'] };

describe('runScheduledJobs: the failed notification queue phase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (releaseMaturedEscrow as unknown as Mock).mockResolvedValue({ releasedCount: 0, consideredCount: 0 });
    (sendCampaignDeadlineReminders as unknown as Mock).mockResolvedValue({ attemptedCount: 0, consideredCount: 0 });
    (sendKindAuthorisationExpiryWarnings as unknown as Mock).mockResolvedValue({ attemptedCount: 0, consideredCount: 0 });
    (sweepStuckLateSettlementRefunds as unknown as Mock).mockResolvedValue({
      consideredCount: 0,
      attemptedCount: 0,
      refundedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    });
    (anonymiseExpiredCompanies as unknown as Mock).mockResolvedValue({ consideredCount: 0, anonymisedCount: 0 });
    queue.mockResolvedValue(QUEUE_RESULT);
  });

  it('runs with the injected time and Mailer and reports its result under notificationQueue', async () => {
    const mailer = { name: 'test', send: vi.fn() };

    const result = await runScheduledJobs(NOW, mailer);

    expect(queue).toHaveBeenCalledWith(NOW, mailer);
    expect(result.notificationQueue).toEqual(QUEUE_RESULT);
  });

  it('falls back to a zeroed result and is named as failed when it throws, and the phases before it still ran', async () => {
    queue.mockRejectedValueOnce(new Error('db blip'));

    const report = await runScheduledJobsReport(NOW);

    expect(report.ok).toBe(false);
    expect(report.failedPhases).toEqual(['notificationQueue']);
    expect(report.result.notificationQueue).toEqual({ attemptedCount: 0, sentCount: 0, failedCount: 0, alertsSent: [] });
    expect(anonymiseExpiredCompanies).toHaveBeenCalled();
  });

  it('does not stop the queue phase when an earlier phase throws', async () => {
    (releaseMaturedEscrow as unknown as Mock).mockRejectedValueOnce(new Error('x'));

    const report = await runScheduledJobsReport(NOW);

    expect(report.failedPhases).toEqual(['escrowRelease']);
    expect(queue).toHaveBeenCalled();
  });
});
