import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// runScheduledJobs is pure orchestration over three already-tested phases
// (releaseMaturedEscrow: src/lib/money/escrow.test.ts; the two reminder
// sweeps: src/lib/reminders.test.ts). These tests only need to know it calls
// all three with the injected `now`, aggregates their results, and isolates
// one phase's failure from the others.
vi.mock('@/lib/money/escrow', () => ({
  releaseMaturedEscrow: vi.fn(),
}));
vi.mock('@/lib/reminders', () => ({
  sendCampaignDeadlineReminders: vi.fn(),
  sendKindAuthorisationExpiryWarnings: vi.fn(),
}));

import { releaseMaturedEscrow } from '@/lib/money/escrow';
import { sendCampaignDeadlineReminders, sendKindAuthorisationExpiryWarnings } from '@/lib/reminders';
import { runScheduledJobs } from './scheduled-jobs';

const mockReleaseMaturedEscrow = releaseMaturedEscrow as unknown as Mock;
const mockSendCampaignDeadlineReminders = sendCampaignDeadlineReminders as unknown as Mock;
const mockSendKindAuthorisationExpiryWarnings = sendKindAuthorisationExpiryWarnings as unknown as Mock;

const NOW = new Date('2026-09-27T00:00:00.000Z');

describe('runScheduledJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReleaseMaturedEscrow.mockResolvedValue({ releasedCount: 2, consideredCount: 2 });
    mockSendCampaignDeadlineReminders.mockResolvedValue({ sentCount: 1, consideredCount: 1 });
    mockSendKindAuthorisationExpiryWarnings.mockResolvedValue({ sentCount: 0, consideredCount: 0 });
  });

  it('takes the current time as an argument and drives every phase with it directly, never through a timer', async () => {
    await runScheduledJobs(NOW);

    expect(mockReleaseMaturedEscrow).toHaveBeenCalledWith(undefined, NOW);
    expect(mockSendCampaignDeadlineReminders).toHaveBeenCalledWith(NOW, undefined);
    expect(mockSendKindAuthorisationExpiryWarnings).toHaveBeenCalledWith(NOW, undefined);
  });

  it('aggregates every phase\'s result under its own key', async () => {
    const result = await runScheduledJobs(NOW);

    expect(result).toEqual({
      escrowRelease: { releasedCount: 2, consideredCount: 2 },
      campaignDeadlineReminders: { sentCount: 1, consideredCount: 1 },
      kindAuthorisationExpiryWarnings: { sentCount: 0, consideredCount: 0 },
    });
  });

  it('still runs the other two phases, and reports a zeroed result, when the escrow release phase throws', async () => {
    mockReleaseMaturedEscrow.mockRejectedValueOnce(new Error('db blip'));

    const result = await runScheduledJobs(NOW);

    expect(result.escrowRelease).toEqual({ releasedCount: 0, consideredCount: 0 });
    expect(result.campaignDeadlineReminders).toEqual({ sentCount: 1, consideredCount: 1 });
    expect(result.kindAuthorisationExpiryWarnings).toEqual({ sentCount: 0, consideredCount: 0 });
    expect(mockSendCampaignDeadlineReminders).toHaveBeenCalled();
    expect(mockSendKindAuthorisationExpiryWarnings).toHaveBeenCalled();
  });

  it('still runs the Kind Authorisation phase, and reports a zeroed result, when the Campaign deadline phase throws', async () => {
    mockSendCampaignDeadlineReminders.mockRejectedValueOnce(new Error('mailer exploded'));

    const result = await runScheduledJobs(NOW);

    expect(result.campaignDeadlineReminders).toEqual({ sentCount: 0, consideredCount: 0 });
    expect(result.kindAuthorisationExpiryWarnings).toEqual({ sentCount: 0, consideredCount: 0 });
    expect(mockSendKindAuthorisationExpiryWarnings).toHaveBeenCalled();
  });

  it('defaults `now` to the current time when called with no argument', async () => {
    await runScheduledJobs();

    const [, passedNow] = mockReleaseMaturedEscrow.mock.calls[0];
    expect(passedNow).toBeInstanceOf(Date);
  });
});
