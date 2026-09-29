import { releaseMaturedEscrow, type ReleaseSweepResult } from '@/lib/money/escrow';
import { sendCampaignDeadlineReminders, sendKindAuthorisationExpiryWarnings, type ReminderSweepResult } from '@/lib/reminders';
import type { Mailer } from '@/lib/mail';

export interface ScheduledJobsResult {
  escrowRelease: ReleaseSweepResult;
  campaignDeadlineReminders: ReminderSweepResult;
  kindAuthorisationExpiryWarnings: ReminderSweepResult;
}

const FALLBACK_RELEASE_SWEEP: ReleaseSweepResult = { releasedCount: 0, consideredCount: 0 };
const FALLBACK_REMINDER_SWEEP: ReminderSweepResult = { attemptedCount: 0, consideredCount: 0 };

/**
 * The single scheduled entry point (ticket 20; spec.md "Notification and
 * scheduling"). Three phases, each already bounded and idempotent on its
 * own:
 *
 * 1. Releases every matured Escrow Hold into Campaign Balance / Trip
 *    Balance across every Campaign and Trip (releaseMaturedEscrow,
 *    ./money/escrow.ts). The existing lazy sweep at the top of the Payout
 *    request handler stays a second, request-time path.
 * 2. Sends Campaign deadline reminders (sendCampaignDeadlineReminders,
 *    ./reminders.ts).
 * 3. Sends Kind Authorisation expiry warnings (sendKindAuthorisationExpiryWarnings,
 *    ./reminders.ts).
 *
 * WHO ACTUALLY CALLS THIS, stated here because this file claimed otherwise
 * for a long time. As of ticket 45 exactly one thing does: the route
 * `POST /api/internal/jobs/run` (src/app/api/internal/jobs/run/route.ts).
 * Before that route existed, nothing in this repo called this function --
 * not a route, not a workflow, not a cron entry -- and the only production
 * path to a matured hold was the lazy sweep inside the two Payout request
 * handlers, which releases for one Campaign (or Trip) at a time and only
 * when that Fundraiser asks to withdraw.
 *
 * So the sentence this comment used to make, that phase 1 "makes the 7-day
 * hold let go of money whether or not a Fundraiser ever asks for a Payout",
 * was false, and the two reminder sweeps sent nothing at all in production.
 * It is only true once a human installs the scheduler that calls the route
 * -- a host cron line or a scheduled GitHub Actions workflow, chosen and
 * recorded in ticket 45. That step is the owner's, on the production host
 * and in GitHub settings; it is not in the repo and no agent can take it.
 * Being callable is not being called: until that step is done, a matured
 * hold on a Campaign nobody has asked to pay out stays in ESCROW_HOLD.
 *
 * spec.md's own description of this entry point also names two further
 * phases -- Refund link expiry and the 60-day unclaimed-balance report --
 * neither of which ticket 20's own checklist asks for. Deliberately left out
 * of this change rather than silently dropped: the unclaimed-balance report
 * has nothing to hook into yet (Dormant Balance is unbuilt), and Refund link
 * expiry belongs to whichever ticket owns that policy. Both are meant to
 * join the phases below once their own tickets land, not be designed here.
 *
 * Takes the current time as its only required argument and does nothing
 * with timers itself: a caller (the route above, on whatever schedule the
 * owner configures) decides when and how often to invoke it, and a test
 * drives it directly with a fixed `now` -- never through a fake or real
 * timer.
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
