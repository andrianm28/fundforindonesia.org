import { prisma } from '@/lib/prisma';
import type { Donation, Kind, Prisma } from '@/generated/prisma/client';
import type { ChargeResult, PaymentMethod, PaymentProvider } from '@/lib/payments';
import { chargeDonation, type ChargeDonationResult } from '@/lib/money/donation-charge';

/**
 * The one place a NEW Donation and its first charge come into being: commit a
 * PENDING Donation, then ask the provider for a charge on it, and close the
 * Donation out as `failed` if the charge cannot be made.
 *
 * Shared by POST /api/donations (a Donor at the donate page) and the recurring
 * donation job (src/lib/recurring-donations/billing.ts, PKS pasal 4.7), so a
 * recurring bill is an ordinary Donation by construction: the same row, the
 * same Payment, the same Platform Fee and Escrow Hold freeze, the same webhook
 * settling it. There is no second money path; this function is the first one,
 * moved out of the route so a second caller cannot drift from it.
 *
 * What stays with the CALLER, because it is about the request and not the
 * Donation: every gate (the donation switch, the sandbox interlock, the Admin's
 * switch, the Campaign's eligibility), building the provider and checking it
 * can serve the method, and the Prayer. Gates run BEFORE this, so nothing is
 * written for a Donation that was never allowed.
 *
 * The Donation is committed before the provider is called, on purpose (see the
 * route's original comment, kept in POST /api/donations): holding a pooled
 * connection across an HTTP round trip is how provider latency exhausts the
 * pool. The case this opens is a Donation with no Payment, which is visible and
 * is marked `failed` here.
 */
export interface CreateChargedDonationParams {
  provider: PaymentProvider;
  campaign: { id: string; kind: Kind; category: string };
  /** The provider-side method already checked against the provider's enabled methods. */
  method: PaymentMethod;
  /** The Donation row's columns; paymentStatus is always 'pending' here. */
  donation: Omit<Prisma.DonationUncheckedCreateInput, 'paymentStatus' | 'campaignId'> & { amount: number };
}

export type CreateChargedDonationResult =
  | { ok: true; donation: Donation; charge: ChargeResult; paymentId: string }
  | { ok: false; reason: Extract<ChargeDonationResult, { ok: false }>['reason']; donation: Donation };

export async function createChargedDonation(params: CreateChargedDonationParams): Promise<CreateChargedDonationResult> {
  const { provider, campaign, method } = params;

  // No ledger entries here: a pending payment has moved no money, and posting
  // on creation is how a campaign would show funds for a donation never paid.
  const donation = await prisma.donation.create({
    data: { ...params.donation, paymentStatus: 'pending', campaignId: campaign.id },
  });

  // The donation id IS the provider's order id -- the webhook gets only an
  // order id back and finds this Payment by providerRef.
  const charged = await chargeDonation({
    db: prisma,
    provider,
    campaign,
    donationId: donation.id,
    amount: params.donation.amount,
    orderId: donation.id,
    paymentMethod: method,
  });

  if (!charged.ok) {
    // Left at 'pending' it would sit in the donor's history as an unfinished
    // payment they can neither complete nor understand, so it is closed out.
    console.error(`[donations] charge failed for donation ${donation.id}: ${charged.reason}`);
    await prisma.donation.update({ where: { id: donation.id }, data: { paymentStatus: 'failed' } });
    return { ok: false, reason: charged.reason, donation };
  }

  return { ok: true, donation, charge: charged.charge, paymentId: charged.paymentId };
}
