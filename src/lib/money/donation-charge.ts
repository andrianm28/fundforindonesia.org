import type { PrismaClient, Kind } from '@/generated/prisma/client';
import { PaymentStatus } from '@/generated/prisma/client';
import type { ChargeResult, PaymentMethod, PaymentProvider } from '@/lib/payments';
import { resolvePlatformFeeBasisForCampaign } from './platform-fee-config';
import { computePlatformFee } from './platform-fee';
import { ESCROW_HOLD_DAYS } from './escrow';

/**
 * One attempt at charging a Donation: resolves and freezes the Platform Fee
 * and the Escrow Hold duration in force right now (CONTEXT.md, Platform Fee /
 * Escrow Hold; prd-compliance 17, 18), asks the provider for a charge, and
 * creates the Payment row that records the attempt.
 *
 * Shared by POST /api/donations (the first attempt on a Donation) and POST
 * /api/donations/[id]/retry (every attempt after a FAILED or EXPIRED one),
 * so the freeze -- and what happens when the provider itself fails -- can
 * never drift between the two: a retry's Payment must freeze exactly the
 * same way the first attempt's did, resolved fresh at ITS OWN creation time,
 * never copied from the Payment it replaces.
 *
 * Returns a discriminated result rather than throwing: every failure branch
 * here already has a Donation to mark `failed` and an HTTP answer to give,
 * which is the caller's job, not this function's.
 */
export interface ChargeDonationParams {
  db: Pick<PrismaClient, 'payment' | 'platformFeeRule' | 'platformFeeThreshold'>;
  provider: PaymentProvider;
  campaign: { id: string; kind: Kind; category: string };
  donationId: string;
  amount: number;
  orderId: string;
  paymentMethod: PaymentMethod;
}

export type ChargeDonationResult =
  | { ok: true; charge: ChargeResult; paymentId: string; platformFee: number }
  | { ok: false; reason: 'method_unavailable' }
  | { ok: false; reason: 'provider_error' }
  | { ok: false; reason: 'method_mismatch' };

export async function chargeDonation(params: ChargeDonationParams): Promise<ChargeDonationResult> {
  const { db, provider, campaign, donationId, amount, orderId, paymentMethod } = params;

  // Ask the provider whether it can serve what was picked BEFORE anything is
  // written and before a charge exists anywhere. Checking afterwards would
  // leave an abandoned charge at the provider -- a live payment link a donor
  // could still find and pay into, with nothing on this side expecting it.
  if (paymentMethod !== provider.method) {
    return { ok: false, reason: 'method_unavailable' };
  }

  let charge: ChargeResult;
  try {
    charge = await provider.createCharge({ orderId, grossAmount: amount, currency: 'IDR' });
  } catch (err) {
    console.error(`[donations] charge failed for donation ${donationId} (order ${orderId}):`, err);
    return { ok: false, reason: 'provider_error' };
  }

  // Narrowed against what the provider declared, not cast. A provider
  // answering with a shape this route did not prepare for must fail loudly
  // rather than write a Payment with no way to pay it.
  if (charge.method !== provider.method) {
    console.error(
      `[donations] provider ${provider.name} declared ${provider.method} but charged ${charge.method} for donation ${donationId} (order ${orderId})`,
    );
    return { ok: false, reason: 'method_mismatch' };
  }

  // Resolved and frozen here, at THIS Payment's creation -- never recomputed
  // at Settlement (prd-compliance 17), and never copied from a sibling
  // Payment on the same Donation: a retry re-resolves both, since a later
  // Admin change to either applies only to Payments created afterwards, this
  // one included.
  const { percentBps, thresholdAmount } = await resolvePlatformFeeBasisForCampaign(db, campaign);
  const platformFee = computePlatformFee({ grossAmount: amount, percentBps, thresholdAmount });

  const payment = await db.payment.create({
    data: {
      donationId,
      provider: provider.name,
      method: charge.method,
      providerRef: orderId,
      amount,
      platformFee,
      escrowHoldDays: ESCROW_HOLD_DAYS,
      status: PaymentStatus.PENDING,
      expiresAt: charge.expiresAt,
    },
  });

  return { ok: true, charge, paymentId: payment.id, platformFee };
}
