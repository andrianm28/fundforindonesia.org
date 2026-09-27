import { releaseMaturedEscrow, type ReleaseSweepResult } from '@/lib/money/escrow';
import { sendCampaignDeadlineReminders, sendKindAuthorisationExpiryWarnings, type ReminderSweepResult } from '@/lib/reminders';
import type { Mailer } from '@/lib/mail';

export interface ScheduledJobsResult {
  escrowRelease: ReleaseSweepResult;
  campaignDeadlineReminders: ReminderSweepResult;
  kindAuthorisationExpiryWarnings: ReminderSweepResult;
}

const FALLBACK_RELEASE_SWEEP: ReleaseSweepResult = { releasedCount: 0, consideredCount: 0 };
const FALLBACK_REMINDER_SWEEP: ReminderSweepResult = { sentCount: 0, consideredCount: 0 };

/**
 * The single scheduled entry point (ticket 20; spec.md "Notification and
 * scheduling"). Three phases, each already bounded and idempotent on its
 * own:
 *
 * 1. Releases every matured Escrow Hold into Campaign Balance / Trip
 *    Balance across every Campaign and Trip (releaseMaturedEscrow,
 *    ./money/escrow.ts). The existing lazy sweep at the top of the Payout
 *    request handler stays a second, request-time path -- this is what
 *    makes the 7-day hold let go of money whether or not a Fundraiser ever
 *    asks for a Payout.
 * 2. Sends Campaign deadline reminders (sendCampaignDeadlineReminders,
 *    ./reminders.ts).
 * 3. Sends Kind Authorisation expiry warnings (sendKindAuthorisationExpiryWarnings,
 *    ./reminders.ts).
 *
 * Takes the current time as its only required argument and does nothing
 * with timers itself: a caller (a cron-triggered route, a container
 * scheduler) decides when and how often to invoke it, and a test drives it
 * directly with a fixed `now` -- never through a fake or real timer.
 *
 * The three phases are isolated from one another: one phase throwing (a
 * database blip, a bug uncaught by its own per-row handling) is logged and
 * falls back to a zeroed result for that phase only, so the other two still
 * run and still report what they actually did. This is the same
 * one-bad-row-must-not-block-the-rest rule every phase already applies
 * internally (releaseMaturedEscrow to one Payment; the reminder sweeps to
 * one Campaign or one Kind Authorisation), carried one level up so one
 * failing phase cannot silently skip the others in the same run.
 */
export async function runScheduledJobs(now: Date = new Date(), mailer?: Mailer): Promise<ScheduledJobsResult> {
  const escrowRelease = await runPhase('escrowRelease', FALLBACK_RELEASE_SWEEP, () =>
    releaseMaturedEscrow(undefined, now),
  );
  const campaignDeadlineReminders = await runPhase('campaignDeadlineReminders', FALLBACK_REMINDER_SWEEP, () =>
    sendCampaignDeadlineReminders(now, mailer),
  );
  const kindAuthorisationExpiryWarnings = await runPhase(
    'kindAuthorisationExpiryWarnings',
    FALLBACK_REMINDER_SWEEP,
    () => sendKindAuthorisationExpiryWarnings(now, mailer),
  );

  return { escrowRelease, campaignDeadlineReminders, kindAuthorisationExpiryWarnings };
}

async function runPhase<T>(name: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    console.error(`runScheduledJobs: phase "${name}" failed`, err);
    return fallback;
  }
}
