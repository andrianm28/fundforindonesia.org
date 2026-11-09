import { prisma } from '@/lib/prisma';
import { readUserEmail, SELECT_USER_EMAIL } from '@/lib/contact-fields';
import { isPrismaUniqueConstraintViolation } from '@/lib/prisma-errors';
import { donationsEnabled, sandboxInProductionReason } from '@/lib/donations';
import { donationsSwitchedOff } from '@/lib/operations';
import { campaignRetryRefusal, RETRY_CAMPAIGN_SELECT } from '@/lib/donation-retry';
import { PaymentProviderNotConfiguredError } from '@/lib/payments';
import { resolveActivePaymentProvider } from '@/lib/payments/active-provider';
import { createChargedDonation } from '@/lib/money/create-charged-donation';
import { sendReportingFailure, type Mailer } from '@/lib/mail';
import { recurringDonationBillEmail } from '@/lib/mail/recurring-donation';
import { publicUrl } from '@/lib/public-url';
import { currentCycleIndex, cycleDueDate } from './schedule';
import { cycleStatus } from './service';
import { recurringStopPath, signRecurringStopToken } from './stop-token';

/**
 * The scheduled phase that bills recurring donations (PKS pasal 4.7; ticket
 * pks-pemenuhan 18). Called by runScheduledJobs, so by POST
 * /api/internal/jobs/run, every few minutes.
 *
 * A bill is an ordinary Donation. For each ACTIVE recurring donation whose
 * current cycle has not been billed, this makes a normal PENDING Donation and a
 * payment link THROUGH createChargedDonation, the function POST /api/donations
 * itself uses: same row, same Payment, same Platform Fee and Escrow Hold freeze,
 * settled by the same webhook. There is no new money path and no card on file:
 * nothing is ever charged without the Donor opening the link and paying.
 *
 * GATES, the donation path's own, checked before anything is written or asked of
 * the provider: the environment switch, the sandbox interlock, the Admin's
 * switch (the webhook is never gated, and this is not the webhook), then per
 * recurring donation whether the Campaign still takes donations. Beyond those:
 * nothing while the previous cycle is still pending, nothing before the start
 * date, nothing once stopped.
 *
 * IDEMPOTENCY, insert-first. The cycle row is inserted BEFORE the Donation, and
 * the database's unique (recurringId, cycleIndex) lets exactly one run win it;
 * the loser gets a unique violation and does nothing. Running the job twice, or
 * two overlapping runs, therefore issues one bill per cycle. Only the cycle
 * that is due NOW is ever billed, never a backlog of the ones a long outage
 * skipped.
 *
 * FAILURE SHAPES, each chosen so that the failure under-bills rather than
 * double-bills:
 * - The provider refuses: the Donation is already closed out `failed` by
 *   createChargedDonation and is attached to the cycle, so the cycle reads as
 *   overdue and is not tried again this cycle (retrying would leave a failed
 *   Donation in the Donor's history every run). The next cycle bills normally.
 * - The job dies between claim and Donation: the cycle row stays without a
 *   Donation. It is never deleted or retried (the Donation may exist and be
 *   payable); after an hour it no longer blocks the next cycle.
 * - The email or inbox notice fails: the bill stands (it is payable from
 *   /akun/donasi-rutin); the email goes to the failed notification queue.
 */

export interface RecurringBillingResult {
  /** Recurring donations looked at. */
  consideredCount: number;
  /** Bills issued (a Donation with a payment link, the Donor told). */
  issuedCount: number;
  /** Looked at and left alone for any of the reasons above. */
  skippedCount: number;
  /** Cycles claimed whose bill could not be made (provider refused, or an unexpected error). */
  failedCount: number;
}

/** Recurring donations one run looks at; the phase runs often, so the rest wait for the next run. */
export const RECURRING_BILLING_BATCH = 2000;

/** The method a bill asks for: a payment link, which is what Sumopod's QRIS redirect is. */
const BILL_METHOD = 'qris_redirect' as const;

const NOTHING: RecurringBillingResult = { consideredCount: 0, issuedCount: 0, skippedCount: 0, failedCount: 0 };

export async function runRecurringDonationBilling(
  now: Date = new Date(),
  mailer?: Mailer,
): Promise<RecurringBillingResult> {
  // The gates the donation route runs, in its order, before anything else.
  if (!donationsEnabled()) return { ...NOTHING };
  const blocked = sandboxInProductionReason();
  if (blocked) {
    console.error(`[recurring-donations] issuing no bills: ${blocked}`);
    return { ...NOTHING };
  }
  if (await donationsSwitchedOff(prisma)) return { ...NOTHING };

  let provider;
  try {
    const active = await resolveActivePaymentProvider(prisma);
    if (!active.enabledMethods.includes(BILL_METHOD)) return { ...NOTHING };
    provider = active.provider;
  } catch (err) {
    if (err instanceof PaymentProviderNotConfiguredError) return { ...NOTHING };
    throw err;
  }

  const due = await prisma.recurringDonation.findMany({
    where: { status: 'ACTIVE', startDate: { lte: now } },
    orderBy: { createdAt: 'asc' },
    take: RECURRING_BILLING_BATCH,
    select: {
      id: true,
      amount: true,
      period: true,
      startDate: true,
      donorId: true,
      campaign: { select: RETRY_CAMPAIGN_SELECT },
      donor: { select: { name: true, ...SELECT_USER_EMAIL } },
      cycles: {
        orderBy: { cycleIndex: 'desc' },
        take: 1,
        select: { cycleIndex: true, createdAt: true, donation: { select: { paymentStatus: true } } },
      },
    },
  });

  const result: RecurringBillingResult = { ...NOTHING, consideredCount: due.length };

  for (const recurring of due) {
    try {
      const index = currentCycleIndex(recurring.startDate, recurring.period, now);
      const last = recurring.cycles[0];
      const skip =
        index === null ||
        // This cycle (or a later one) already has its row: billed, or claimed by another run.
        (last !== undefined && last.cycleIndex >= index) ||
        // The previous cycle is still waiting to be paid: do not pile a second bill on it.
        (last !== undefined && cycleStatus(last, now) === 'PENDING') ||
        // The Campaign no longer takes donations (ended, suspended, permit lapsed, demo).
        campaignRetryRefusal(recurring.campaign, now) !== null ||
        // A wakaf bill cannot carry the Donor's explicit ikrar.
        recurring.campaign.kind === 'WAKAF';
      if (skip || index === null) {
        result.skippedCount += 1;
        continue;
      }

      // Signed before the claim: it throws only when the signing secret is
      // missing in production, and that must stop the bill before it exists.
      const stopUrl = publicUrl(recurringStopPath(signRecurringStopToken(recurring.id, now.getTime())));

      const dueDate = cycleDueDate(recurring.startDate, recurring.period, index);
      let cycleId: string;
      try {
        const claim = await prisma.recurringDonationCycle.create({
          data: { recurringId: recurring.id, cycleIndex: index, dueDate },
          select: { id: true },
        });
        cycleId = claim.id;
      } catch (err) {
        if (!isPrismaUniqueConstraintViolation(err)) throw err;
        result.skippedCount += 1; // another run won this cycle
        continue;
      }

      const created = await createChargedDonation({
        provider,
        campaign: recurring.campaign,
        method: BILL_METHOD,
        donation: {
          amount: recurring.amount,
          isAnonymous: false,
          paymentMethod: 'qris',
          message: null,
          donorId: recurring.donorId,
          trafficSource: null,
          ikrarConfirmed: false,
        },
      });
      // Attached either way: a refused bill is a failed Donation on this cycle.
      await prisma.recurringDonationCycle.update({ where: { id: cycleId }, data: { donationId: created.donation.id } });

      if (!created.ok || created.charge.method !== BILL_METHOD) {
        console.error(`[recurring-donations] bill for recurring ${recurring.id} cycle ${index} not issued`);
        result.failedCount += 1;
        continue;
      }
      result.issuedCount += 1;

      await tellDonor({
        recurring,
        dueDate,
        payUrl: created.charge.redirectUrl,
        payBefore: created.charge.expiresAt ?? null,
        stopUrl,
        mailer,
      });
    } catch (err) {
      // One recurring donation's failure must not stop the rest.
      console.error(`[recurring-donations] recurring ${recurring.id} failed:`, err);
      result.failedCount += 1;
    }
  }

  return result;
}

/** The email and the inbox notice. Neither can undo the bill, so neither throws. */
async function tellDonor(params: {
  recurring: { id: string; amount: number; donorId: string; campaign: { id: string; title: string }; donor: Parameters<typeof readUserEmail>[0] & { name: string } };
  dueDate: Date;
  payUrl: string;
  payBefore: Date | null;
  stopUrl: string;
  mailer?: Mailer;
}): Promise<void> {
  const { recurring, dueDate, payUrl, payBefore, stopUrl, mailer } = params;

  try {
    await prisma.notification.create({
      data: {
        type: 'recurring_donation_bill',
        title: 'Tagihan Donasi Rutin',
        message: `Donasi rutin Anda untuk "${recurring.campaign.title}" sudah bisa dibayar. Buka halaman donasi rutin untuk membayar atau menghentikannya.`,
        userId: recurring.donorId,
        link: '/akun/donasi-rutin',
      },
    });
  } catch (err) {
    console.error(`[recurring-donations] inbox notice for recurring ${recurring.id} failed:`, err);
  }

  let to: string | null = null;
  try {
    to = readUserEmail(recurring.donor);
  } catch (err) {
    console.error(`[recurring-donations] cannot read the address of the Donor of recurring ${recurring.id}:`, err);
  }
  if (!to) return;
  await sendReportingFailure(
    recurringDonationBillEmail({
      to,
      donorName: recurring.donor.name,
      campaignTitle: recurring.campaign.title,
      amount: recurring.amount,
      dueDate,
      payUrl,
      payBefore,
      stopUrl,
    }),
    { mail: 'recurring_donation_bill', recurringId: recurring.id },
    mailer,
  );
}
