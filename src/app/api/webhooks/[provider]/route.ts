import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isPrismaUniqueConstraintViolation } from '@/lib/prisma-errors';
import { PaymentStatus, type Prisma } from '@/generated/prisma/client';
import {
  getPaymentProvider,
  PaymentProviderNotConfiguredError,
  UnknownPaymentProviderError,
  InvalidWebhookSignatureError,
} from '@/lib/payments';
import { postTransaction, paymentSettledLegs } from '@/lib/money/ledger';
import { escrowReleaseAt } from '@/lib/money/escrow';
import { notifyDonationConfirmed, notifyRegistrationConfirmed } from '@/lib/notifications';
import { assertExactlyOnePaymentSubject } from '@/lib/money/payment-subject';
import {
  confirmRegistration,
  expireRegistrationHold,
  refundLateSettlement,
  type ConfirmRegistrationOutcome,
} from '@/lib/volunteer/trip';
import { generateReceiptToken } from '@/lib/receipt-token';
import { receiptEmail, resolveReceiptRecipient } from '@/lib/mail/receipt';
import { generateAkadWakafToken } from '@/lib/akad-wakaf-token';
import { withAkadWakaf } from '@/lib/mail/akad-wakaf';
import { sendReportingFailure } from '@/lib/mail';
import { publicUrl } from '@/lib/public-url';

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

/**
 * Thrown from inside the settlement transaction to unwind it cleanly when
 * `Payment_donationId_paid_key` (prd-compliance 18) refuses to let a second
 * Payment for the same Donation reach PAID. Never crosses the route's own
 * boundary -- caught right outside the `$transaction` call.
 */
class SiblingPaymentAlreadySettledError extends Error {}

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
      if (!isPrismaUniqueConstraintViolation(err)) throw err;

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
      include: {
        donation: {
          include: {
            // collectingEntity is who the Receipt (below) says received the
            // money; donor is who it is addressed to when the Donor has an
            // account (a Guest Donor's address is Donation.guestEmail
            // itself, already plaintext -- no extra include needed for it).
            campaign: { include: { collectingEntity: true } },
            donor: { select: { id: true, email: true, name: true } },
          },
        },
        registration: { include: { batch: { include: { trip: true } } } },
      },
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

    // A Payment describes money for exactly one thing -- both or neither of
    // donationId/registrationId set means the branches below would silently
    // credit the wrong subject (or none). Throwing here is fail-closed: it
    // lands in the outer catch (500), and WebhookEvent.processedAt stays
    // null so a retry, after whatever created the malformed row is fixed,
    // resumes rather than being told this event already happened.
    assertExactlyOnePaymentSubject({
      donationId: payment.donationId,
      registrationId: payment.registrationId,
    });

    // Whether this Payment settles a Trip Fee (Registration) or a Donation
    // (Campaign) -- decides which branch every block below takes.
    const isTripPayment = payment.registrationId != null;

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
      // The provider's own timestamps, never server receipt time
      // (prd-compliance 19): paidAt is when the donor actually paid, and
      // escrow anchors to settledAt -- the provider's settlement estimate,
      // e.g. Sumopod's T+2 for QRIS -- not to paidAt or to whenever this
      // webhook happened to arrive. A slow delivery must not move either
      // figure.
      const paidAt = event.paidAt;
      // The hold length THIS Payment froze at creation (prd-compliance 18),
      // never the live ESCROW_HOLD_DAYS constant -- an Admin shortening or
      // lengthening the default after this Payment was created must not move
      // when it releases.
      const releaseAt = escrowReleaseAt(event.settledAt, payment.escrowHoldDays);

      let settled: {
        settled: boolean;
        registrationOutcome?: ConfirmRegistrationOutcome | null;
        receiptToken?: string;
        akadWakafToken?: string;
      };
      try {
        settled = await prisma.$transaction(async (tx) => {
        // The database decides who wins, once: two DISTINCT events for the
        // same Payment (different providerEventId, so both clear the
        // WebhookEvent constraint on their own) can both read PENDING
        // before either writes. Keying this update on status too, and
        // checking how many rows it actually touched, closes that window --
        // whichever commits first wins, and the loser sees count 0.
        //
        // That guard alone only protects ONE Payment row. A retry
        // (prd-compliance 18) can leave a Donation with two DIFFERENT
        // Payment rows both still PENDING -- this guard would let both
        // through, since each is independently PENDING when it runs. The
        // partial unique index `Payment_donationId_paid_key` (WHERE status =
        // 'PAID') is the database's own guarantee against that: whichever of
        // two sibling Payments commits PAID first wins, and the loser's
        // UPDATE raises a unique violation, caught below.
        let updated: { count: number };
        try {
          updated = await tx.payment.updateMany({
            where: { id: payment.id, status: PaymentStatus.PENDING },
            data: {
              status: PaymentStatus.PAID,
              providerFee,
              rawPayload: event.rawPayload as Prisma.InputJsonValue,
              paidAt,
              settledAt: event.settledAt,
              escrowReleaseAt: releaseAt,
            },
          });
        } catch (err) {
          if (isPrismaUniqueConstraintViolation(err)) {
            // Postgres has already put this transaction into an aborted
            // state -- no further statement on this connection can run, not
            // even to stamp WebhookEvent.processedAt. Rethrow a distinct
            // marker so Prisma rolls the whole transaction back cleanly, and
            // finish the bookkeeping outside it, on a fresh connection.
            throw new SiblingPaymentAlreadySettledError();
          }
          throw err;
        }

        if (updated.count === 0) {
          // Lost the race: another delivery already settled this Payment.
          // This event is still finished -- its outcome is "do nothing" --
          // so it still gets marked processed.
          await tx.webhookEvent.update({
            where: { id: webhookEventId },
            data: { processedAt: new Date() },
          });
          return { settled: false as const };
        }

        let registrationOutcome: ConfirmRegistrationOutcome | null = null;
        let receiptToken: string | undefined;
        let akadWakafToken: string | undefined;

        if (isTripPayment) {
          const { registration } = payment;
          // The Volunteer Trip module confirms the seat, or reports why it
          // could not: the Registration was cancelled first (refunded in
          // full once this commits) or its hold lapsed.
          ({ outcome: registrationOutcome } = await confirmRegistration(tx, { registrationId: registration!.id }));

          if (registrationOutcome === 'cancelled') {
            console.error(
              `[webhooks/${providerParam}] event ${event.providerEventId} settled payment ${payment.id} for registration ${registration!.id}, but the Registration was already CANCELLED -- auto-refunding the full amount`,
            );
          } else if (registrationOutcome === 'lapsed') {
            // A hold expires (at the next hold on its Batch) without its
            // Payment being touched, and the Payment can stay PENDING for up
            // to VA_EXPIRY_MS after the 30-minute hold window closed. If a
            // charge clears in that window, the money genuinely arrived at
            // the provider -- the ledger legs below still post, same as any
            // other settlement -- but there is no longer a seat to confirm.
            // Logged here for manual review: money collected, no seat held.
            console.error(
              `[webhooks/${providerParam}] event ${event.providerEventId} settled payment ${payment.id} for registration ${registration!.id}, but the Registration was no longer HOLD (hold likely already expired) -- money collected, no seat confirmed, needs manual review`,
            );
          }

          // Deriving the ledger transactionId from the provider event id makes
          // the ledger idempotent on the same key the WebhookEvent table is --
          // the two cannot disagree about whether this event was posted. The
          // claim above means a retry never gets here; the ledger's claim
          // index (prd-compliance 28b) is what makes the key a one-shot even
          // for a caller that claims nothing.
          await postTransaction(
            tx,
            paymentSettledLegs({
              subject: { type: 'trip', tripId: registration!.batch.tripId },
              grossAmount: payment.amount,
              providerFee,
            }),
            {
              paymentId: payment.id,
              transactionId: `webhook:${event.provider}:${event.providerEventId}`,
            },
          );
        } else {
          const { donation } = payment;
          const { campaign } = donation!;

          await tx.donation.update({
            where: { id: donation!.id },
            data: { paymentStatus: 'confirmed' },
          });

          // Receipt (CONTEXT.md, Receipt; prd-compliance 21): created once,
          // right here, riding the same updated.count > 0 win as the rest of
          // this branch -- a retried delivery for an already-settled
          // Donation never reaches this line twice, so a Donation never gets
          // two Receipts. The token is generated in the app rather than read
          // back from the row, so the email below can use it without a
          // second query.
          receiptToken = generateReceiptToken();
          await tx.receipt.create({
            data: { donationId: donation!.id, token: receiptToken, sentAt: paidAt, lastSentAt: paidAt },
          });

          // Akad Wakaf (CONTEXT.md, Akad Wakaf; ADR 0010; ticket 22), created
          // in the same transaction as the Receipt above and only for a
          // `wakaf` Campaign -- same "created once, riding this win" reasoning:
          // a retried delivery for an already-settled Donation never reaches
          // this line twice, so a Donation never gets two Akad Wakaf either.
          if (campaign.kind === 'WAKAF') {
            akadWakafToken = generateAkadWakafToken();
            await tx.akadWakaf.create({
              data: { donationId: donation!.id, token: akadWakafToken },
            });
          }

          // The Platform Fee this Payment already froze at creation time
          // (resolvePlatformFeeBasis + computePlatformFee, POST
          // /api/donations, prd-compliance 17) -- read, never recomputed,
          // so a rate change since then cannot alter what this Donor was
          // promised.
          const platformFee = payment.platformFee;

          // Never touches the Campaign's status, however much is collected:
          // reaching the target does not close a Campaign, only the
          // Fundraiser or an Admin does (ADR 0004). This Settlement is
          // accepted whatever the Campaign's status (PRD §7.2), so writing a
          // status here would also let a late payment overwrite a Suspension
          // or a Cancellation.
          await tx.campaign.update({
            where: { id: campaign.id },
            data: { collectedAmount: { increment: payment.amount } },
          });

          // Deriving the ledger transactionId from the provider event id makes
          // the ledger idempotent on the same key the WebhookEvent table is --
          // the two cannot disagree about whether this event was posted. The
          // claim above means a retry never gets here; the ledger's claim
          // index (prd-compliance 28b) is what makes the key a one-shot even
          // for a caller that claims nothing.
          await postTransaction(
            tx,
            paymentSettledLegs({
              subject: { type: 'campaign', campaignId: campaign.id },
              grossAmount: payment.amount,
              providerFee,
              platformFee,
            }),
            {
              paymentId: payment.id,
              transactionId: `webhook:${event.provider}:${event.providerEventId}`,
            },
          );
        }

        // Stamped last, and only here: a transaction that reaches this line
        // has written Payment, its Donation/Registration subject, and the
        // ledger. If anything above throws, the transaction rolls back, this
        // never runs, and the row keeps processedAt null -- so a retry
        // resumes the settlement instead of being told it already happened.
        await tx.webhookEvent.update({
          where: { id: webhookEventId },
          data: { processedAt: new Date() },
        });

        return { settled: true as const, registrationOutcome, receiptToken, akadWakafToken };
        });
      } catch (err) {
        if (err instanceof SiblingPaymentAlreadySettledError) {
          // A different Payment for the same Donation reached PAID first --
          // this Payment's money, if it genuinely arrived at the provider,
          // has nowhere recorded to land, same class of anomaly as the
          // AMOUNT MISMATCH case above. Logged for manual review rather than
          // guessed at; the event is still finished (its outcome is "do
          // nothing"), so it is marked processed like any other no-op event.
          console.error(
            `[webhooks/${providerParam}] event ${event.providerEventId} tried to settle payment ${payment.id}, but a sibling Payment for donation ${payment.donationId} had already reached PAID first -- refusing to double-settle a Donation; needs manual review for where this money landed`,
          );
          await prisma.webhookEvent.update({
            where: { id: webhookEventId },
            data: { processedAt: new Date() },
          });
          return NextResponse.json({ received: true }, { status: 200 });
        }
        throw err;
      }

      if (settled.settled) {
        // Notifications outside the transaction, same as every other write
        // path in this codebase: a failed notification must not roll back
        // money that has genuinely settled.
        if (isTripPayment) {
          // Only notify when the Registration was actually confirmed above --
          // a Volunteer whose hold already expired has no seat, and telling
          // them registration succeeded would be worse than saying nothing.
          const { registration } = payment;
          if (settled.registrationOutcome === 'confirmed') {
            await notifyRegistrationConfirmed({
              volunteerId: registration!.volunteerId,
              tripSlug: registration!.batch.trip.slug,
              tripTitle: registration!.batch.trip.title,
              amount: payment.amount,
            });
          } else if (settled.registrationOutcome === 'cancelled') {
            // The Trip Fee Refund policy's late-settlement case, in the
            // module's own transaction -- never the settlement's `tx`, which
            // has already written the Payment: createRefund locks
            // VolunteerTrip-then-Payment, and calling it from inside would
            // lock in the reverse of that order (see the lock order in
            // src/lib/volunteer/trip.ts). Failure here is caught, not
            // thrown: the settlement already committed and this webhook
            // must still answer 200 to the provider.
            try {
              await refundLateSettlement(prisma, { registrationId: registration!.id });
            } catch (err) {
              console.error(
                `[webhooks/${providerParam}] event ${event.providerEventId}: failed to auto-refund payment ${payment.id} for cancelled registration ${registration!.id}`,
                err,
              );
            }
          }
        } else {
          const { donation } = payment;
          const { campaign } = donation!;
          await notifyDonationConfirmed({
            donorId: donation!.donorId,
            creatorId: campaign.creatorId,
            campaignId: campaign.id,
            campaignTitle: campaign.title,
            amount: payment.amount,
          });

          // Receipt email (CONTEXT.md, Receipt), sent only now that the
          // settlement has committed -- same reasoning as every other
          // notification here: a failed send must never undo money that has
          // genuinely settled. Named recipient and Collecting Entity are
          // read from what the settlement transaction already looked up
          // (no second query); either missing is an anomaly this webhook
          // does not fail over, since the Payment has already settled --
          // it is logged for manual follow-up instead.
          if (settled.receiptToken) {
            const resolved = resolveReceiptRecipient({
              donor: donation!.donor,
              guestEmail: donation!.guestEmail,
              guestName: donation!.guestName,
              collectingEntityName: campaign.collectingEntity?.name ?? null,
            });
            if (resolved.ok) {
              let mail = receiptEmail({
                to: resolved.recipient.recipientEmail,
                donorName: resolved.recipient.donorName,
                campaignTitle: campaign.title,
                collectingEntityName: resolved.recipient.collectingEntityName,
                amount: payment.amount,
                paidAt,
                printUrl: publicUrl(`/receipt/${settled.receiptToken}`),
              });

              // Akad Wakaf rides the same delivery as the Receipt (PRD:
              // "Akad Wakaf terkirim bersama Receipt") rather than a second
              // email with its own send failure to track.
              if (settled.akadWakafToken) {
                mail = withAkadWakaf(mail, {
                  wakifName: resolved.recipient.donorName,
                  amount: payment.amount,
                  purpose: campaign.title,
                  nazhirName: resolved.recipient.collectingEntityName,
                  printUrl: publicUrl(`/akad-wakaf/${settled.akadWakafToken}`),
                });
              }

              await sendReportingFailure(mail, {
                mail: 'receipt',
                donationId: donation!.id,
                paymentId: payment.id,
              });
            } else {
              console.error(
                `[webhooks/${providerParam}] settled payment ${payment.id} but could not send its Receipt: ${resolved.reason}`,
              );
            }
          }
        }
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

        if (isTripPayment) {
          await expireRegistrationHold(tx, { registrationId: payment.registration!.id });
        } else {
          await tx.donation.update({
            where: { id: payment.donation!.id },
            data: { paymentStatus: 'failed' },
          });
        }

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
