import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getPaymentProvider, PaymentProviderNotConfiguredError } from '@/lib/payments';
import {
  donationsEnabled,
  sandboxInProductionReason,
  DONATIONS_DISABLED_MESSAGE,
} from '@/lib/donations';
import { campaignAcceptsDonations, donationBlock } from '@/lib/campaign-lifecycle';
import { COLLECTING_ENTITY_SELECT } from '@/lib/collecting-entity';
import { COLLECTING_ENTITY_REFUSAL } from '@/lib/campaign-page-status';
import { chargeDonation } from '@/lib/money/donation-charge';
import { PROVIDER_METHOD_FOR, type DonationPaymentMethod } from '@/lib/money/payment-method-map';

/**
 * A Donor retries payment on a Donation whose last attempt did not go
 * through -- one bad attempt (a failed charge, an expired QRIS link) must
 * not cost the Donation itself (CONTEXT.md, Payment; prd-compliance 18).
 *
 * This creates a NEW Payment on the SAME Donation rather than a new
 * Donation: the Prayer, the campaign it targets and the amount the Donor
 * already committed to all stay put, and the history of every attempt
 * survives on Payment rows (schema.prisma, Payment.donationId). At most one
 * of those Payments may ever reach PAID -- guarded at the database level by
 * a partial unique index (Payment_donationId_paid_key), not only by the
 * eligibility check below, so a genuine race between two attempts settling
 * at once still cannot double-credit the campaign (see the settlement
 * webhook's SiblingPaymentAlreadySettledError handling).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!donationsEnabled()) {
    return NextResponse.json({ error: DONATIONS_DISABLED_MESSAGE }, { status: 503 });
  }

  const blocked = sandboxInProductionReason();
  if (blocked) {
    console.error(`[donations/retry] refusing every retry: ${blocked}`);
    return NextResponse.json({ error: DONATIONS_DISABLED_MESSAGE }, { status: 503 });
  }

  try {
    const { id } = await params;

    const donation = await prisma.donation.findUnique({
      where: { id },
      select: {
        id: true,
        amount: true,
        paymentMethod: true,
        donorId: true,
        campaign: {
          select: {
            id: true,
            lifecycleStatus: true,
            deadline: true,
            title: true,
            isDemo: true,
            kind: true,
            category: true,
            ...COLLECTING_ENTITY_SELECT,
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, expiresAt: true },
        },
      },
    });

    if (!donation) {
      return NextResponse.json({ error: 'Donasi tidak ditemukan' }, { status: 404 });
    }

    // A signed-in Donor's own Donation only -- knowledge of a Guest Donor's
    // unguessable id (a cuid, never listed anywhere public) is what stands
    // in for auth there, the same way a Refund's donor link works; a
    // registered Donor's session must actually match, so a leaked id alone
    // cannot be used to poke at somebody else's Donation.
    if (donation.donorId) {
      const session = await getServerSession();
      if (session?.user?.id !== donation.donorId) {
        return NextResponse.json({ error: 'Donasi tidak ditemukan' }, { status: 404 });
      }
    }

    const campaign = donation.campaign;

    if (campaign.isDemo) {
      return NextResponse.json(
        { error: 'Ini adalah campaign contoh dan tidak dapat menerima donasi.' },
        { status: 403 },
      );
    }

    const now = new Date();
    if (donationBlock(campaign, now)) {
      return NextResponse.json({ error: COLLECTING_ENTITY_REFUSAL }, { status: 403 });
    }
    if (!campaignAcceptsDonations(campaign, now)) {
      return NextResponse.json(
        { error: 'Campaign tidak aktif. Hanya campaign aktif yang dapat menerima donasi.' },
        { status: 400 },
      );
    }

    const latest = donation.payments[0];
    if (!latest) {
      // Nothing to retry: every Payment on a Donation is created by this
      // same money layer (POST /api/donations or this route), so a Donation
      // with none is a data problem, not a Donor-facing 409.
      return NextResponse.json(
        { error: 'Belum ada percobaan pembayaran untuk donasi ini' },
        { status: 409 },
      );
    }

    // A PENDING Payment past its own expiresAt is, in effect, already
    // expired -- judged lazily here, the same way an Active Campaign past
    // its deadline is judged Expired without anything being written first
    // (campaignAcceptsDonations). The lazy flip below is best-effort: if it
    // fails, the retry still proceeds (the eligibility decision already
    // stands), and the next reader corrects the status.
    const isExpiredPending =
      latest.status === 'PENDING' && latest.expiresAt !== null && latest.expiresAt <= now;
    const retryable = latest.status === 'FAILED' || latest.status === 'EXPIRED' || isExpiredPending;

    if (!retryable) {
      const message =
        latest.status === 'PAID'
          ? 'Donasi ini sudah dibayar.'
          : 'Pembayaran sebelumnya masih berlaku. Selesaikan pembayaran atau tunggu hingga kedaluwarsa sebelum mencoba lagi.';
      return NextResponse.json({ error: message }, { status: 409 });
    }

    if (isExpiredPending) {
      try {
        await prisma.payment.updateMany({
          where: { id: latest.id, status: 'PENDING' },
          data: { status: 'EXPIRED' },
        });
      } catch (err) {
        console.error(`[donations/retry] lazy expiry failed for payment ${latest.id}:`, err);
      }
    }

    let provider;
    try {
      provider = getPaymentProvider();
    } catch (err) {
      if (err instanceof PaymentProviderNotConfiguredError) {
        return NextResponse.json(
          { error: 'Kami tidak dapat memproses pembayaran saat ini. Silakan coba lagi nanti.' },
          { status: 503 },
        );
      }
      throw err;
    }

    const wantedMethod = PROVIDER_METHOD_FOR[donation.paymentMethod as DonationPaymentMethod];
    if (!wantedMethod || wantedMethod !== provider.method) {
      return NextResponse.json(
        { error: 'Metode pembayaran ini belum tersedia. Silakan pilih metode lain.' },
        { status: 503 },
      );
    }

    // A fresh, distinct providerRef for this attempt -- Payment.providerRef
    // is unique, so a retry cannot reuse a prior attempt's order id. Random
    // rather than a counted attempt number: two retry requests racing (a
    // doubled-click) would both count the same number and collide on the
    // same providerRef, failing the slower one outright instead of retrying
    // cleanly. Still traceable back to the Donation without a join, since it
    // is prefixed with the Donation's own id.
    const orderId = `${donation.id}-r${randomUUID().slice(0, 8)}`;

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
      const errorMessage =
        charged.reason === 'method_unavailable'
          ? 'Metode pembayaran ini belum tersedia. Silakan pilih metode lain.'
          : 'Kami tidak dapat memproses pembayaran saat ini. Silakan coba lagi nanti.';
      return NextResponse.json({ error: errorMessage }, { status: 503 });
    }

    const charge = charged.charge;
    const paymentInstructions =
      charge.method === 'qris_redirect'
        ? { type: 'qris' as const, redirectUrl: charge.redirectUrl, expiresAt: charge.expiresAt }
        : { type: 'bank_transfer' as const, vaNumber: charge.vaNumber, expiresAt: charge.expiresAt };

    return NextResponse.json(
      {
        donationId: donation.id,
        amount: donation.amount,
        paymentMethod: donation.paymentMethod,
        campaignTitle: campaign.title,
        paymentInstructions,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Error retrying donation payment:', error);
    return NextResponse.json({ error: 'Gagal memproses pembayaran ulang' }, { status: 500 });
  }
}
