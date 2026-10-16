import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { PaymentProviderNotConfiguredError } from '@/lib/payments';
import { resolveActivePaymentProvider } from '@/lib/payments/active-provider';
import { donationsEnabled, sandboxInProductionReason, DONATIONS_DISABLED_MESSAGE } from '@/lib/donations';
import { campaignAcceptsDonations, donationBlock } from '@/lib/campaign-lifecycle';
import { COLLECTING_ENTITY_SELECT } from '@/lib/collecting-entity';
import { COLLECTING_ENTITY_REFUSAL } from '@/lib/campaign-page-status';
import { checkRateLimit } from '@/lib/rate-limit-guard';
import { chargeDonation } from '@/lib/money/donation-charge';
import { attemptRetryable } from '@/lib/money/payment-result';
import { PROVIDER_METHOD_FOR, paymentInstructionsFor, type DonationPaymentMethod } from '@/lib/money/payment-method-map';

/**
 * A Donor retries payment on a Donation whose last attempt did not go through
 * -- one bad attempt (a failed charge, an expired QRIS link) must not cost the
 * Donation itself (CONTEXT.md, Payment; prd-compliance 18).
 *
 * This creates a NEW Payment on the SAME Donation rather than a new Donation:
 * the Prayer, the campaign it targets and the amount the Donor already
 * committed to all stay put, and the history of every attempt survives on
 * Payment rows. At most one of those Payments may ever reach PAID -- guarded at
 * the database level by a partial unique index (Payment_donationId_paid_key) --
 * but that index only stops the second CREDIT. A second live charge is money a
 * Donor can still pay with nothing to credit it to, so this module also makes
 * sure only one charge is ever open at a time:
 *
 * - **Serialised per Donation.** The whole attempt runs under a transaction-scoped
 *   advisory lock keyed on the Donation, taken with try-lock: a second request
 *   for the same Donation is refused at once (409) instead of waiting, so it
 *   never charges and never queues on a pool connection. The eligibility read
 *   happens after the lock, and the new Payment is committed before the lock is
 *   released, so the loser of a race always sees the winner's PENDING Payment.
 *   The cost is one pooled connection held for the length of one provider call
 *   per Donation being retried, bounded by the rate limit below.
 * - **A grace period after expiry.** A provider can still deliver `paid` for a
 *   charge shortly after its own expiry (ADR 0021, ticket 52 settle it late).
 *   Offering a second charge in that window is how a Donor ends up paying twice,
 *   so an attempt only becomes retryable a grace period after it expired
 *   (attemptRetryable, payment-result.ts).
 *
 * Shared by POST /api/donations/[id]/retry (a signed-in Donor's dashboard, the
 * Donation id as the address) and POST /api/donations/result/[token]/retry (the
 * payment result page, ticket 98, where the signed token is the credential).
 */

/** Retry attempts per client address per hour; each one that passes opens a charge at the provider. */
const RETRY_LIMIT = 30;
const RETRY_WINDOW_SECONDS = 60 * 60;

type RetryCampaign = Parameters<typeof campaignAcceptsDonations>[0] & { isDemo: boolean };

/** Why a new charge cannot be made for this Campaign right now, or null when it can. */
export function campaignRetryRefusal(campaign: RetryCampaign, now: Date): { status: number; error: string } | null {
  if (!donationsEnabled() || sandboxInProductionReason()) return { status: 503, error: DONATIONS_DISABLED_MESSAGE };
  if (campaign.isDemo) {
    return { status: 403, error: 'Ini adalah campaign contoh dan tidak dapat menerima donasi.' };
  }
  if (donationBlock(campaign, now)) return { status: 403, error: COLLECTING_ENTITY_REFUSAL };
  if (!campaignAcceptsDonations(campaign, now)) {
    return { status: 400, error: 'Campaign tidak aktif. Hanya campaign aktif yang dapat menerima donasi.' };
  }
  return null;
}

/** The Campaign fields {@link campaignRetryRefusal} reads. */
export const RETRY_CAMPAIGN_SELECT = {
  id: true,
  lifecycleStatus: true,
  deadline: true,
  title: true,
  isDemo: true,
  kind: true,
  category: true,
  ...COLLECTING_ENTITY_SELECT,
} as const;

export type RetryResult = { status: number; body: Record<string, unknown> };

const NOT_FOUND: RetryResult = { status: 404, body: { error: 'Donasi tidak ditemukan' } };
const UNAVAILABLE = 'Kami tidak dapat memproses pembayaran saat ini. Silakan coba lagi nanti.';

export interface RetryDonationParams {
  donationId: string;
  /** The requester's address, for the rate limit. */
  clientAddress: string;
  /** Whether this requester may retry this Donation; false answers the same 404 as a missing one. */
  authorize: (donation: { donorId: string | null }) => Promise<boolean>;
}

export async function retryDonationPayment(params: RetryDonationParams): Promise<RetryResult> {
  const { donationId, authorize } = params;

  if (!donationsEnabled()) return { status: 503, body: { error: DONATIONS_DISABLED_MESSAGE } };
  const blocked = sandboxInProductionReason();
  if (blocked) {
    console.error(`[donations/retry] refusing every retry: ${blocked}`);
    return { status: 503, body: { error: DONATIONS_DISABLED_MESSAGE } };
  }

  // Fail-open like the donation route: a limiter outage must not stop a Donor
  // paying. The lock below, not this limit, is what keeps charges single.
  const limited = await checkRateLimit({
    scope: 'donation-retry',
    subject: params.clientAddress,
    limit: RETRY_LIMIT,
    windowSeconds: RETRY_WINDOW_SECONDS,
    onUnavailable: 'open',
  });
  if (!limited.ok) {
    return { status: 429, body: { error: 'Terlalu banyak percobaan pembayaran dari jaringan ini. Coba lagi nanti.' } };
  }

  return prisma.$transaction(
    async (tx) => {
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${`donation-retry:${donationId}`}::text)) AS locked`;
      if (!lock?.locked) {
        return { status: 409, body: { error: 'Pembayaran ulang untuk donasi ini sedang diproses. Tunggu sebentar.' } };
      }

      const donation = await tx.donation.findUnique({
        where: { id: donationId },
        select: {
          id: true,
          amount: true,
          paymentMethod: true,
          donorId: true,
          campaign: { select: RETRY_CAMPAIGN_SELECT },
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, status: true, expiresAt: true },
          },
        },
      });
      if (!donation || !(await authorize(donation))) return NOT_FOUND;

      const { campaign } = donation;
      const now = new Date();
      const refusal = campaignRetryRefusal(campaign, now);
      if (refusal) return { status: refusal.status, body: { error: refusal.error } };

      const latest = donation.payments[0];
      if (!latest) {
        // Nothing to retry: every Payment on a Donation is created by this same
        // money layer, so a Donation with none is a data problem, not a
        // Donor-facing 409 they can act on.
        return { status: 409, body: { error: 'Belum ada percobaan pembayaran untuk donasi ini' } };
      }

      if (!attemptRetryable(latest, now)) {
        const message =
          latest.status === 'PAID' || latest.status === 'REFUNDED'
            ? 'Donasi ini sudah dibayar.'
            : 'Pembayaran sebelumnya masih berlaku. Selesaikan pembayaran atau tunggu hingga kedaluwarsa sebelum mencoba lagi.';
        return { status: 409, body: { error: message } };
      }

      // A PENDING Payment past its expiry and grace is expired in effect; the
      // flip is best-effort, since the eligibility decision already stands and
      // the next reader corrects the status.
      if (latest.status === 'PENDING') {
        try {
          await tx.payment.updateMany({ where: { id: latest.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
        } catch (err) {
          console.error(`[donations/retry] lazy expiry failed for payment ${latest.id}:`, err);
        }
      }

      let provider;
      let enabledMethods;
      try {
        ({ provider, enabledMethods } = await resolveActivePaymentProvider(prisma));
      } catch (err) {
        if (err instanceof PaymentProviderNotConfiguredError) return { status: 503, body: { error: UNAVAILABLE } };
        throw err;
      }

      const wantedMethod = PROVIDER_METHOD_FOR[donation.paymentMethod as DonationPaymentMethod];
      if (!wantedMethod || !enabledMethods.includes(wantedMethod)) {
        return { status: 503, body: { error: 'Metode pembayaran ini belum tersedia. Silakan pilih metode lain.' } };
      }

      // A fresh, distinct providerRef for this attempt -- Payment.providerRef is
      // unique, so a retry cannot reuse a prior attempt's order id. Still
      // traceable back to the Donation without a join, since it is prefixed with
      // the Donation's own id.
      const orderId = `${donation.id}-r${randomUUID().slice(0, 8)}`;

      // Written through the root client, not `tx`: the Payment commits on its
      // own, before this transaction (and its lock) ends, so the charge is on
      // record even if anything after it fails.
      const charged = await chargeDonation({
        db: prisma,
        provider,
        campaign,
        donationId: donation.id,
        amount: donation.amount,
        orderId,
        paymentMethod: wantedMethod,
      });

      if (!charged.ok) {
        console.error(`[donations/retry] charge failed for donation ${donation.id}: ${charged.reason}`);
        const error =
          charged.reason === 'method_unavailable'
            ? 'Metode pembayaran ini belum tersedia. Silakan pilih metode lain.'
            : UNAVAILABLE;
        return { status: 503, body: { error } };
      }

      return {
        status: 201,
        body: {
          donationId: donation.id,
          amount: donation.amount,
          paymentMethod: donation.paymentMethod,
          campaignTitle: campaign.title,
          paymentInstructions: paymentInstructionsFor(charged.charge),
        },
      };
    },
    // Long enough for one provider call; a second request never waits on the
    // lock (try-lock), only on getting a connection.
    { maxWait: 5_000, timeout: 60_000 },
  );
}
