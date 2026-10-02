import type { PrismaClient, Kind, Payment } from '@/generated/prisma/client';
import { PaymentStatus } from '@/generated/prisma/client';
import type { ChargeResult, PaymentMethod, PaymentProvider } from '@/lib/payments';
import { canonicalPaymentProviderName } from '@/lib/payments/provider-names';
import { resolvePlatformFeeBasisForCampaign } from './platform-fee-config';
import { computePlatformFee } from './platform-fee';
import { ESCROW_HOLD_DAYS } from './escrow';
import { recordChargeWriteFailure } from './payment-reconciliation';

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
 * which is the caller's job, not this function's. The one exception is the
 * provider NAME, resolved before any of that: an adapter whose own name names
 * no registered provider is a defect in the build rather than an outcome this
 * Donation has, so it throws rather than inventing a reason to fail a donor's
 * Donation over.
 */
export interface ChargeDonationParams {
  db: Pick<PrismaClient, 'payment' | 'platformFeeRule' | 'platformFeeThreshold' | 'chargeWriteFailure'>;
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
  | { ok: false; reason: 'method_mismatch' }
  | { ok: false; reason: 'payment_write_failed' };

export async function chargeDonation(params: ChargeDonationParams): Promise<ChargeDonationResult> {
  const { db, provider, campaign, donationId, amount, orderId, paymentMethod } = params;

  // The name this Payment is recorded under, resolved through the registry
  // before anything is charged and before anything is written.
  //
  // `Payment.provider` is a join key rather than a label: providerBalances
  // groups by exact string equality and the reconciliation report is read per
  // provider, so "SumoPod" and "sumopod" are two pots to the ledger -- each
  // reconciling exactly, against nothing -- and a name no provider answers to is
  // a bucket no code can ever settle against. The registry locks its builder
  // KEYS, which is why a misspelt `readonly name` in an adapter compiled
  // silently; taking the string through canonicalPaymentProviderName is what
  // makes the column hold one value per provider whatever the adapter calls
  // itself.
  //
  // Thrown rather than returned, unlike every branch below: an adapter whose own
  // name names no provider is a defect in the build, not an outcome this Donation
  // can be marked `failed` for, and the caller's uncaught 500 is the honest
  // answer to it. Ahead of createCharge for the same reason the method check is:
  // a charge created and then abandoned at the provider is a live payment link a
  // donor can still pay into with nothing here expecting the money.
  const providerName = canonicalPaymentProviderName(provider.name);

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
      `[donations] provider ${providerName} declared ${provider.method} but charged ${charge.method} for donation ${donationId} (order ${orderId})`,
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

  // The charge now exists at the provider. If the Payment that records it
  // cannot be written, the money a donor may still pay into it would arrive with
  // nothing here expecting it: record the charge for reconciliation (ticket 52)
  // instead of letting the failure vanish into a bare 500.
  let payment: Payment;
  try {
    payment = await db.payment.create({
      data: {
        donationId,
        provider: providerName,
        method: charge.method,
        providerRef: orderId,
        amount,
        platformFee,
        escrowHoldDays: ESCROW_HOLD_DAYS,
        status: PaymentStatus.PENDING,
        expiresAt: charge.expiresAt,
      },
    });
  } catch (err) {
    await recordChargeWriteFailure(db, {
      provider: providerName,
      providerRef: orderId,
      subjectType: 'donation',
      subjectId: donationId,
      amount,
      error: err,
    });
    return { ok: false, reason: 'payment_write_failed' };
  }

  return { ok: true, charge, paymentId: payment.id, platformFee };
}
