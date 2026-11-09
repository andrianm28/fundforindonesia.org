import type { PrismaClient } from '@/generated/prisma/client';
import { campaignAcceptsDonations, donationBlock } from '@/lib/campaign-lifecycle';
import { RETRY_CAMPAIGN_SELECT } from '@/lib/donation-retry';
import { zakatCheckoutRefusal } from '@/lib/zakat';
import { MAX_DONATION_AMOUNT, MIN_DONATION_AMOUNT } from '@/lib/donations';
import { verifyRecurringStopToken } from './stop-token';
import type { RecurringPeriod } from './schedule';

/**
 * What a Donor does with a recurring donation (PKS pasal 4.7): register one,
 * see their cycles, stop one. Billing is the job's (./billing.ts).
 *
 * Nothing here takes money or touches a provider, so none of it is gated by the
 * donation switch: a Donor may register or stop while donations are off; the
 * job simply issues no bill until they are back on.
 */

type ServiceDb = Pick<PrismaClient, 'recurringDonation' | 'campaign' | 'siteSetting'>;

/** Active recurring donations one Donor may hold, so one account cannot queue unbounded bills. */
export const MAX_ACTIVE_RECURRING_PER_DONOR = 20;

const HOUR_MS = 3_600_000;
/** A cycle row with no Donation this long after it was claimed is abandoned (the job died between claim and Donation). */
export const CLAIM_GRACE_MS = HOUR_MS;

/**
 * How long past a payment link's expiry a still-pending cycle waits before it
 * counts as overdue: room for a late expiry or paid webhook to arrive first.
 */
export const PENDING_EXPIRY_MARGIN_MS = 6 * HOUR_MS;
/** For a pending Donation whose Payment has no known expiry: counted from the claim. */
export const UNKNOWN_EXPIRY_GRACE_MS = 48 * HOUR_MS;

export type CycleStatus = 'PAID' | 'PENDING' | 'OVERDUE';

/**
 * A cycle's status, read from what the existing webhook already wrote (the
 * Donation's paymentStatus), never stored:
 *
 * - `confirmed` (a Payment reached PAID) is paid;
 * - `failed` (the last open Payment expired or failed, or the provider refused
 *   the bill) is overdue;
 * - `pending` is pending, and so is a claim whose Donation is still being
 *   created. A claim that never got a Donation is overdue once it is clearly
 *   abandoned.
 */
export function cycleStatus(
  cycle: { createdAt: Date; donation: { paymentStatus: string; payments?: Array<{ expiresAt: Date | null }> } | null },
  now: Date,
): CycleStatus {
  if (!cycle.donation) return now.getTime() - cycle.createdAt.getTime() > CLAIM_GRACE_MS ? 'OVERDUE' : 'PENDING';
  if (cycle.donation.paymentStatus === 'confirmed') return 'PAID';
  if (cycle.donation.paymentStatus === 'failed') return 'OVERDUE';
  // Still pending. The webhook is what normally closes an expired link out, but
  // a provider that never sends an expiry webhook would leave this pending
  // forever, and "the previous cycle is pending" stops billing. So a link that
  // is long expired counts as overdue here. The Donation itself is left alone:
  // if the Donor pays late, the webhook still records it.
  const expiries = (cycle.donation.payments ?? []).map((p) => p.expiresAt?.getTime() ?? null);
  const known = expiries.filter((t): t is number => t !== null);
  const lastOpenUntil =
    known.length > 0 && known.length === expiries.length
      ? Math.max(...known)
      : cycle.createdAt.getTime() + UNKNOWN_EXPIRY_GRACE_MS;
  return now.getTime() > lastOpenUntil + PENDING_EXPIRY_MARGIN_MS ? 'OVERDUE' : 'PENDING';
}

/** The calendar date (YYYY-MM-DD) in Jakarta at `now`. */
function wibDate(now: Date): string {
  return new Date(now.getTime() + 7 * HOUR_MS).toISOString().slice(0, 10);
}

/**
 * The Campaign a recurring donation may target, as `{ id, title }`, or null.
 * It must take donations now: a `wakaf` Campaign needs the Donor's explicit
 * ikrar each time, which a bill cannot carry, and a Demo Campaign never takes
 * money. Used to register and to name the Campaign on the registration page.
 */
export async function findRegistrableCampaign(
  db: ServiceDb,
  campaignId: string,
  now: Date,
): Promise<{ id: string; title: string } | null> {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId }, select: RETRY_CAMPAIGN_SELECT });
  if (
    !campaign ||
    campaign.isDemo ||
    campaign.kind === 'WAKAF' ||
    donationBlock(campaign, now) ||
    !campaignAcceptsDonations(campaign, now) ||
    // A zakat Campaign the zakat checkout would refuse (module off, or not the
    // configured recipient) cannot be registered either (ADR 0028).
    (await zakatCheckoutRefusal(db, campaign)) !== null
  ) {
    return null;
  }
  return { id: campaign.id, title: campaign.title };
}

export type CreateRecurringError = 'amount_out_of_range' | 'start_in_past' | 'campaign_unavailable' | 'too_many';

export async function createRecurringDonation(
  db: ServiceDb,
  params: { donorId: string; campaignId: string; amount: number; period: RecurringPeriod; startDate: Date; now: Date },
): Promise<{ ok: true; id: string } | { ok: false; error: CreateRecurringError }> {
  const { donorId, campaignId, amount, period, startDate, now } = params;

  // The same bounds as a single Donation: one minimum and one maximum.
  if (!Number.isInteger(amount) || amount < MIN_DONATION_AMOUNT || amount > MAX_DONATION_AMOUNT) {
    return { ok: false, error: 'amount_out_of_range' };
  }
  if (Number.isNaN(startDate.getTime()) || startDate.toISOString().slice(0, 10) < wibDate(now)) {
    return { ok: false, error: 'start_in_past' };
  }

  // The target must be a Campaign that takes donations now. A `wakaf` Campaign
  // needs the Donor's explicit ikrar each time, which a bill cannot carry, and a
  // Demo Campaign never takes money.
  if (!(await findRegistrableCampaign(db, campaignId, now))) {
    return { ok: false, error: 'campaign_unavailable' };
  }

  const active = await db.recurringDonation.count({ where: { donorId, status: 'ACTIVE' } });
  if (active >= MAX_ACTIVE_RECURRING_PER_DONOR) return { ok: false, error: 'too_many' };

  const row = await db.recurringDonation.create({
    data: { donorId, campaignId, amount, period, startDate },
    select: { id: true },
  });
  return { ok: true, id: row.id };
}

/**
 * Stops a recurring donation. `donorId` is given when a signed-in Donor asks
 * (their own only; anyone else's answers the same not_found as a missing one);
 * the signed-link path omits it because the link is the credential. Stopping an
 * already stopped one succeeds and changes nothing.
 */
export async function stopRecurringDonation(
  db: ServiceDb,
  params: { id: string; donorId?: string },
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; error: 'not_found' }> {
  const where = { id: params.id, ...(params.donorId ? { donorId: params.donorId } : {}) };
  const stopped = await db.recurringDonation.updateMany({
    where: { ...where, status: 'ACTIVE' },
    data: { status: 'STOPPED', stoppedAt: now },
  });
  if (stopped.count > 0) return { ok: true };
  const existing = await db.recurringDonation.findFirst({ where, select: { id: true } });
  return existing ? { ok: true } : { ok: false, error: 'not_found' };
}

/** Stops through the signed link in a bill email: no session, the token bound to the id is the credential. */
export async function stopRecurringDonationByToken(
  db: ServiceDb,
  token: unknown,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; error: 'not_found' }> {
  const id = verifyRecurringStopToken(token, now.getTime());
  if (!id) return { ok: false, error: 'not_found' };
  return stopRecurringDonation(db, { id }, now);
}

const CYCLES_SHOWN = 12;

export interface RecurringDonationView {
  id: string;
  campaign: { id: string; slug: string; title: string };
  amount: number;
  period: RecurringPeriod;
  startDate: Date;
  status: 'ACTIVE' | 'STOPPED';
  stoppedAt: Date | null;
  cycles: Array<{ cycleIndex: number; dueDate: Date; status: CycleStatus; payUrl: string | null }>;
}

/** A Donor's recurring donations with their most recent cycles, newest first. */
export async function listRecurringDonations(
  db: ServiceDb,
  donorId: string,
  now: Date = new Date(),
): Promise<RecurringDonationView[]> {
  const rows = await db.recurringDonation.findMany({
    where: { donorId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      amount: true,
      period: true,
      startDate: true,
      status: true,
      stoppedAt: true,
      campaign: { select: { id: true, slug: true, title: true } },
      cycles: {
        orderBy: { cycleIndex: 'desc' },
        take: CYCLES_SHOWN,
        select: {
          cycleIndex: true,
          dueDate: true,
          createdAt: true,
          donation: {
            select: {
              paymentStatus: true,
              payments: {
                where: { status: 'PENDING' },
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { redirectUrl: true, expiresAt: true },
              },
            },
          },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    campaign: row.campaign,
    amount: row.amount,
    period: row.period,
    startDate: row.startDate,
    status: row.status,
    stoppedAt: row.stoppedAt,
    cycles: row.cycles.map((cycle) => {
      const status = cycleStatus(cycle, now);
      return {
        cycleIndex: cycle.cycleIndex,
        dueDate: cycle.dueDate,
        status,
        // Only an open bill has a link worth showing.
        payUrl: status === 'PENDING' ? (cycle.donation?.payments[0]?.redirectUrl ?? null) : null,
      };
    }),
  }));
}
