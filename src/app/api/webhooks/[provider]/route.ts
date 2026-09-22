import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PaymentStatus, type Prisma } from '@/generated/prisma/client';
import {
  getPaymentProvider,
  PaymentProviderNotConfiguredError,
  UnknownPaymentProviderError,
  InvalidWebhookSignatureError,
} from '@/lib/payments';
import { postTransaction, paymentSettledLegs } from '@/lib/money/ledger';
import { escrowReleaseAt } from '@/lib/money/escrow';
import { notifyDonationConfirmed } from '@/lib/notifications';
import { toLifecycleStatus } from "@/lib/campaign-lifecycle";

/**
 * The single place where money becomes real.
 *
 * Nothing else credits a campaign: POST /api/donations (task M4) only ever
 * creates a PENDING Payment, and this route is the only writer that moves one
 * out of PENDING. That asymmetry is deliberate -- a forged or duplicated
 * request here is the one mistake this platform cannot absorb, so every step
 * below fails closed rather than guessing.
 *
 * WebhookEvent.processedAt is this route's other invariant: it is stamped
 * only as the last statement of whatever transaction decided this event's
 * outcome. A row that exists with processedAt still null is not a duplicate
 * -- it is an earlier delivery that got as far as being recorded and then
 * never finished (a deadlock, a dropped connection, any throw before
 * commit). Treating an unfinished row as "already handled" is how a
 * donor's money arrives at the provider and this platform ends up with no
 * record of it.
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

  // 1. Resolve the provider named in the URL, before touching the request
  // body. The name matters: each provider signs differently, and resolving
  // every path to one fixed adapter means a delivery is checked against a
  // scheme its sender never used -- which either rejects everything genuine
  // or, worse, hands an attacker a verifier that was not meant to see them.
  //
  // The two failure modes answer differently on purpose. A missing secret is
  // an outage ("we cannot verify anything"), so 503 invites a retry. An
  // unknown name never becomes valid however often it is retried, so 404
  // says so instead of pretending to be temporarily broken.
  let provider;
  try {
    provider = getPaymentProvider(providerParam);
  } catch (err) {
    if (err instanceof UnknownPaymentProviderError) {
      console.error(`[webhooks/${providerParam}] rejected: no such payment provider`);
      return NextResponse.json({ error: 'Payment provider tidak dikenal' }, { status: 404 });
    }
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
  //
  // No Zod schema on the request body on purpose: parseWebhook is what reads
  // and validates it, via an HMAC signature -- a stronger guarantee than a
  // shape check. Adding one here would validate a body already proven
  // authentic, and give the contract a second place to drift out of sync.
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

  // 3. An authentic event about nothing this platform tracks -- a dashboard
  // test ping, or an event type the provider added after this code shipped.
  // Answered 200 and dropped: not recorded, no Payment looked up, nothing
  // written. Letting it fall through would take it into the failed/expired
  // branch below and mark a live donation failed on the strength of a word
  // this code does not recognise.
  if (event.status === 'ignored') {
    console.info(
      `[webhooks/${providerParam}] ignored event ${event.providerEventId}: nothing to act on`,
    );
    return NextResponse.json({ received: true }, { status: 200 });
  }

  try {
    // 4. Record the event first. Its @@unique([provider, providerEventId])
    // is the idempotency mechanism, but a row existing is not by itself
    // proof this event was ever finished being handled -- see the
    // processedAt note above the function. A create that hits the
    // constraint has to look at the existing row to tell the two cases
    // apart: processed means a genuine replay (200, do nothing further);
    // unprocessed means an earlier delivery never finished, and this
    // delivery picks up where it left off rather than being treated as a
    // no-op duplicate.
    let webhookEventId: string;
    try {
      const created = await prisma.webhookEvent.create({
        data: {
          provider: event.provider,
          providerEventId: event.providerEventId,
          payload: event.rawPayload as Prisma.InputJsonValue,
        },
      });
      webhookEventId = created.id;
    } catch (err) {
      if (!isUniqueConstraintViolation(err)) throw err;

      const existing = await prisma.webhookEvent.findUniqueOrThrow({
        where: {
          provider_providerEventId: {
            provider: event.provider,
            providerEventId: event.providerEventId,
          },
        },
      });

      if (existing.processedAt) {
        return NextResponse.json({ received: true }, { status: 200 });
      }

      webhookEventId = existing.id;
    }

    // 5. Find the Payment this event is about. Payment.providerRef is the
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
      await prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { processedAt: new Date() },
      });
      return NextResponse.json({ received: true }, { status: 200 });
    }

    if (payment.status !== PaymentStatus.PENDING) {
      // Already settled/failed/expired by an earlier delivery. Distinct from
      // the WebhookEvent unique constraint above: that one catches the exact
      // same event replayed, this one catches a different event (e.g. a
      // stray "paid" arriving after the payment already expired) landing on
      // a Payment that has already left PENDING. This is a cheap read-based
      // early exit for the common case; the atomic updateMany guard below is
      // what actually closes the race between two distinct events for the
      // same Payment arriving concurrently.
      console.error(
        `[webhooks/${providerParam}] event ${event.providerEventId} ignored: payment ${payment.id} already ${payment.status}`,
      );
      await prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { processedAt: new Date() },
      });
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const { donation } = payment;
    const { campaign } = donation;

    // event.status is taken on trust here: the signature check above proved
    // this payload is genuine, not that this specific field is genuine --
    // see the requirement on PaymentProvider.parseWebhook in
    // src/lib/payments/types.ts for what a real adapter must do about that.
    if (event.status === 'paid') {
      if (event.grossAmount !== payment.amount) {
        // The provider's own signed amount disagrees with what this
        // platform charged -- a partial capture, an underpaid VA, or worse.
        // Crediting payment.amount anyway is exactly the gap that shows up
        // at bank reconciliation months later with no explanation. Refuse
        // to settle. The Payment is left PENDING rather than FAILED: this
        // is not a definitive outcome the provider reported, it is an
        // anomaly that needs a human, and FAILED would tell the donor
        // their donation failed when money may genuinely be sitting at the
        // provider.
        console.error(
          `[webhooks/${providerParam}] AMOUNT MISMATCH: event ${event.providerEventId} for payment ${payment.id} reports gross ${event.grossAmount}, Payment.amount is ${payment.amount} -- refusing to settle`,
        );
        await prisma.webhookEvent.update({
          where: { id: webhookEventId },
          data: { processedAt: new Date() },
        });
        return NextResponse.json({ received: true }, { status: 200 });
      }

      // Taken from the signed payload when the provider reports one --
      // Sumopod does, on every event. Zero only when the provider genuinely
      // reports nothing, as MockPaymentProvider does. This matters because
      // paymentSettledLegs credits the campaign the NET: a fee silently left
      // at zero credits the campaign money the provider actually kept, and
      // that stays invisible until the reconciliation report disagrees with
      // the bank.
      const providerFee = event.providerFee ?? 0;
      const paidAt = new Date();
      const releaseAt = escrowReleaseAt(paidAt);
      const newCollectedAmount = campaign.collectedAmount + payment.amount;
      const targetMet = newCollectedAmount >= campaign.targetAmount;

      const settled = await prisma.$transaction(async (tx) => {
        // The database decides who wins, once: two DISTINCT events for the
        // same Payment (different providerEventId, so both clear the
        // WebhookEvent constraint on their own) can both read PENDING
        // before either writes. Keying this update on status too, and
        // checking how many rows it actually touched, closes that window --
        // whichever commits first wins, and the loser sees count 0.
        const updated = await tx.payment.updateMany({
          where: { id: payment.id, status: PaymentStatus.PENDING },
          data: {
            status: PaymentStatus.PAID,
            providerFee,
            rawPayload: event.rawPayload as Prisma.InputJsonValue,
            paidAt,
            escrowReleaseAt: releaseAt,
          },
        });

        if (updated.count === 0) {
          // Lost the race: another delivery already settled this Payment.
          // This event is still finished -- its outcome is "do nothing" --
          // so it still gets marked processed.
          await tx.webhookEvent.update({
            where: { id: webhookEventId },
            data: { processedAt: new Date() },
          });
          return false;
        }

        await tx.donation.update({
          where: { id: donation.id },
          data: { paymentStatus: 'confirmed' },
        });

        await tx.campaign.update({
          where: { id: campaign.id },
          data: {
            collectedAmount: { increment: payment.amount },
            ...(targetMet
              ? {
                  status: 'completed',
                  lifecycleStatus: toLifecycleStatus('completed'),
                }
              : {}),
          },
        });

        // Deriving the ledger transactionId from the provider event id makes
        // the ledger idempotent on the same key the WebhookEvent table is --
        // the two cannot disagree about whether this event was posted.
        await postTransaction(
          tx,
          paymentSettledLegs({
            subject: { type: 'campaign', campaignId: campaign.id },
            grossAmount: payment.amount,
            providerFee,
          }),
          {
            paymentId: payment.id,
            transactionId: `webhook:${event.provider}:${event.providerEventId}`,
          },
        );

        // Stamped last, and only here: a transaction that reaches this line
        // has written Payment, Donation, Campaign and the ledger. If
        // anything above throws, the transaction rolls back, this never
        // runs, and the row keeps processedAt null -- so a retry resumes
        // the settlement instead of being told it already happened.
        await tx.webhookEvent.update({
          where: { id: webhookEventId },
          data: { processedAt: new Date() },
        });

        return true;
      });

      if (settled) {
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
        console.error(
          `[webhooks/${providerParam}] event ${event.providerEventId} lost the settlement race for payment ${payment.id} -- another delivery settled it first`,
        );
      }
    } else {
      // failed / expired: mark the payment and the donation, post nothing --
      // no money moved. Donation.paymentStatus only ever has
      // pending/confirmed/failed, so both provider outcomes map onto
      // 'failed' -- a donor who never paid should see that the attempt
      // lapsed rather than a donation stuck reading "pending" forever.
      // Guarded by the same status-keyed updateMany as the paid path, for
      // the same reason: two distinct events for one Payment must not both
      // apply.
      await prisma.$transaction(async (tx) => {
        const updated = await tx.payment.updateMany({
          where: { id: payment.id, status: PaymentStatus.PENDING },
          data: {
            status: event.status === 'expired' ? PaymentStatus.EXPIRED : PaymentStatus.FAILED,
            rawPayload: event.rawPayload as Prisma.InputJsonValue,
          },
        });

        if (updated.count === 0) {
          await tx.webhookEvent.update({
            where: { id: webhookEventId },
            data: { processedAt: new Date() },
          });
          return;
        }

        await tx.donation.update({
          where: { id: donation.id },
          data: { paymentStatus: 'failed' },
        });

        await tx.webhookEvent.update({
          where: { id: webhookEventId },
          data: { processedAt: new Date() },
        });
      });
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error('Error processing payment webhook:', error);
    return NextResponse.json({ error: 'Gagal memproses webhook' }, { status: 500 });
  }
}
