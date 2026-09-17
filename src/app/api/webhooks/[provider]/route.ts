import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PaymentStatus, type Prisma } from '@/generated/prisma/client';
import {
  getPaymentProvider,
  PaymentProviderNotConfiguredError,
  InvalidWebhookSignatureError,
} from '@/lib/payments';
import { postTransaction, paymentSettledLegs } from '@/lib/money/ledger';
import { escrowReleaseAt } from '@/lib/money/escrow';
import { notifyDonationConfirmed } from '@/lib/notifications';

/**
 * The single place where money becomes real.
 *
 * Nothing else credits a campaign: POST /api/donations (task M4) only ever
 * creates a PENDING Payment, and this route is the only writer that moves one
 * out of PENDING. That asymmetry is deliberate -- a forged or duplicated
 * request here is the one mistake this platform cannot absorb, so every step
 * below fails closed rather than guessing.
 */

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerParam } = await params;

  // 1. Resolve the provider before touching the request body. A missing
  // secret is an outage ("we cannot verify anything"), not a rejection -- a
  // 500 here would tell the real provider to retry forever against a box
  // that will never be able to check a signature, so this answers 503
  // instead of accepting an event nobody can verify.
  let provider;
  try {
    provider = getPaymentProvider();
  } catch (err) {
    if (err instanceof PaymentProviderNotConfiguredError) {
      console.error(`[webhooks/${providerParam}] rejected: payment provider not configured`);
      return NextResponse.json(
        { error: 'Payment provider tidak dikonfigurasi' },
        { status: 503 },
      );
    }
    throw err;
  }

  // 2. Verify the signature before parsing anything else. parseWebhook never
  // returns an unverified event -- it throws instead -- so a bad signature is
  // caught here and nothing downstream is ever written: no WebhookEvent row,
  // no log entry that implies acceptance.
  let event;
  try {
    event = await provider.parseWebhook(request);
  } catch (err) {
    if (err instanceof InvalidWebhookSignatureError) {
      console.error(`[webhooks/${providerParam}] rejected: invalid signature`);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
    throw err;
  }

  try {
    // 3. Insert WebhookEvent first. Its @@unique([provider, providerEventId])
    // IS the idempotency mechanism -- a duplicate delivery hits the
    // constraint right here and the handler returns 200 having done nothing
    // else. Providers retry aggressively, and answering a duplicate with
    // anything other than 200 makes them retry harder, not less.
    try {
      await prisma.webhookEvent.create({
        data: {
          provider: event.provider,
          providerEventId: event.providerEventId,
          payload: event.rawPayload as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        return NextResponse.json({ received: true }, { status: 200 });
      }
      throw err;
    }

    // 4. Find the Payment this event is about. Payment.providerRef is the
    // donation id that M4 passed as the provider's order id -- nothing else
    // links a webhook event back to a Payment.
    const payment = await prisma.payment.findUnique({
      where: { providerRef: event.providerOrderId },
      include: { donation: { include: { campaign: true } } },
    });

    if (!payment) {
      // Retrying this forever helps nobody, so it is answered 200 -- but it
      // must never create a Payment. An event naming no known charge is
      // logged for investigation, not acted on.
      console.error(
        `[webhooks/${providerParam}] event ${event.providerEventId} references unknown providerRef ${event.providerOrderId}`,
      );
      return NextResponse.json({ received: true }, { status: 200 });
    }

    if (payment.status !== PaymentStatus.PENDING) {
      // Already settled/failed/expired by an earlier delivery. Distinct from
      // the WebhookEvent unique constraint above: that one catches the exact
      // same event replayed, this one catches a different event (e.g. a
      // stray "paid" arriving after the payment already expired) landing on
      // a Payment that has already left PENDING.
      console.error(
        `[webhooks/${providerParam}] event ${event.providerEventId} ignored: payment ${payment.id} already ${payment.status}`,
      );
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const { donation } = payment;
    const { campaign } = donation;

    if (event.status === 'paid') {
      // MockPaymentProvider reports no fee today; a real adapter's webhook
      // payload is where a genuine fee would come from.
      const providerFee = 0;
      const paidAt = new Date();
      const releaseAt = escrowReleaseAt(paidAt);
      const newCollectedAmount = campaign.collectedAmount + payment.amount;
      const targetMet = newCollectedAmount >= campaign.targetAmount;

      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.PAID,
            providerFee,
            rawPayload: event.rawPayload as Prisma.InputJsonValue,
            paidAt,
            escrowReleaseAt: releaseAt,
          },
        });

        await tx.donation.update({
          where: { id: donation.id },
          data: { paymentStatus: 'confirmed' },
        });

        await tx.campaign.update({
          where: { id: campaign.id },
          data: {
            collectedAmount: { increment: payment.amount },
            ...(targetMet ? { status: 'completed' } : {}),
          },
        });

        // Deriving the ledger transactionId from the provider event id makes
        // the ledger idempotent on the same key the WebhookEvent table is --
        // the two cannot disagree about whether this event was posted.
        await postTransaction(
          tx,
          paymentSettledLegs({
            campaignId: campaign.id,
            grossAmount: payment.amount,
            providerFee,
          }),
          {
            paymentId: payment.id,
            transactionId: `webhook:${event.provider}:${event.providerEventId}`,
          },
        );
      });

      // Notifications outside the transaction, same as every other write
      // path in this codebase: a failed notification must not roll back
      // money that has genuinely settled.
      await notifyDonationConfirmed({
        donorId: donation.donorId,
        creatorId: campaign.creatorId,
        campaignId: campaign.id,
        campaignTitle: campaign.title,
        amount: payment.amount,
      });
    } else {
      // failed / expired: mark the payment, post nothing -- no money moved.
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: event.status === 'expired' ? PaymentStatus.EXPIRED : PaymentStatus.FAILED,
          rawPayload: event.rawPayload as Prisma.InputJsonValue,
        },
      });
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error('Error processing payment webhook:', error);
    return NextResponse.json({ error: 'Gagal memproses webhook' }, { status: 500 });
  }
}
