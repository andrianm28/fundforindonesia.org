import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getPaymentProvider, PaymentProviderNotConfiguredError } from '@/lib/payments';
import type { PaymentMethod } from '@/lib/payments';
import { PaymentStatus } from '@/generated/prisma/client';
import { releaseExpiredHolds } from '@/lib/volunteer/registration';
import { assertExactlyOnePaymentSubject } from '@/lib/money/payment-subject';

const HOLD_WINDOW_MS = 30 * 60 * 1000; // 30 minutes -- see plan Further Notes: this exact duration is an open parameter, not re-derived from any spec value.

const VALID_PAYMENT_METHODS = ['bank_transfer', 'qris'] as const;
const PROVIDER_METHOD_FOR: Record<(typeof VALID_PAYMENT_METHODS)[number], PaymentMethod> = {
  bank_transfer: 'bank_transfer_va',
  qris: 'qris_redirect',
};

const registerSchema = z.object({
  paymentMethod: z.enum(VALID_PAYMENT_METHODS, { error: 'Metode pembayaran tidak valid.' }),
});

class BatchFullError extends Error {}
class DuplicateRegistrationError extends Error {}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: batchId } = await params;

    const batch = await prisma.volunteerBatch.findUnique({
      where: { id: batchId },
      select: { id: true, status: true, maxQuota: true, trip: { select: { id: true, tripFeeAmount: true } } },
    });

    if (!batch) {
      return NextResponse.json({ error: 'Volunteer batch tidak ditemukan' }, { status: 404 });
    }

    if (batch.status !== 'OPEN') {
      return NextResponse.json({ error: 'Batch ini tidak menerima registrasi' }, { status: 400 });
    }

    const body = await request.json();
    const result = registerSchema.safeParse(body);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json({ error: 'Validasi gagal', fieldErrors }, { status: 400 });
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

    // Checked before anything is written, same as the donation route: a
    // charge abandoned at the provider because this platform rejected the
    // method afterwards is a live payment link nobody expects money from.
    const wantedMethod = PROVIDER_METHOD_FOR[result.data.paymentMethod];
    if (wantedMethod !== provider.method) {
      return NextResponse.json(
        { error: 'Metode pembayaran ini belum tersedia. Silakan pilih metode lain.' },
        { status: 503 },
      );
    }

    const volunteerId = session.user.id as string;

    // Sweep expired holds on THIS batch first, at the top of the request --
    // no scheduler needed, mirrors releaseMaturedEscrow's own pattern
    // (src/lib/money/escrow.ts). Frees any seat an abandoned HOLD was still
    // occupying before the occupancy count below is taken.
    await releaseExpiredHolds(batchId);

    let registration;
    try {
      registration = await prisma.$transaction(async (tx) => {
        // Lock the Batch row before reading the quota count, so two
        // concurrent registration attempts at the last seat serialize on
        // this lock rather than both reading the same pre-insert count --
        // the same "lock the contended resource before reading an aggregate
        // derived from it" pattern used for the Campaign balance check in
        // approvePayout (src/lib/money/payouts.ts) and releaseMaturedEscrow
        // (src/lib/money/escrow.ts).
        await tx.$queryRaw`SELECT id FROM "VolunteerBatch" WHERE id = ${batchId} FOR UPDATE`;

        const occupied = await tx.registration.count({
          where: { batchId, status: { in: ['HOLD', 'CONFIRMED'] } },
        });
        if (occupied >= batch.maxQuota) {
          throw new BatchFullError();
        }

        const existing = await tx.registration.findFirst({
          where: { volunteerId, batchId, status: { in: ['HOLD', 'CONFIRMED'] } },
          select: { id: true },
        });
        if (existing) {
          throw new DuplicateRegistrationError();
        }

        return tx.registration.create({
          data: {
            volunteerId,
            batchId,
            status: 'HOLD',
            holdExpiresAt: new Date(Date.now() + HOLD_WINDOW_MS),
          },
        });
      });
    } catch (err) {
      if (err instanceof BatchFullError) {
        return NextResponse.json({ error: 'Batch ini sudah penuh' }, { status: 400 });
      }
      if (err instanceof DuplicateRegistrationError) {
        return NextResponse.json(
          { error: 'Anda sudah memiliki registrasi aktif pada batch ini' },
          { status: 400 },
        );
      }
      throw err;
    }

    // Charge outside the transaction that created the Registration -- the
    // Registration is already committed, so a failed charge leaves a
    // recoverable HOLD (it simply expires via the sweep above) rather than
    // an uncommitted row holding a database connection across a provider
    // round trip. Mirrors POST /api/donations's own reasoning exactly.
    let charge;
    try {
      charge = await provider.createCharge({
        orderId: registration.id,
        grossAmount: batch.trip.tripFeeAmount,
        currency: 'IDR',
      });
    } catch (err) {
      console.error(`[registrations] charge failed for registration ${registration.id}:`, err);
      return NextResponse.json(
        { error: 'Kami tidak dapat memproses pembayaran saat ini. Silakan coba lagi nanti.' },
        { status: 503 },
      );
    }

    // Narrowed against what the provider declared, not cast -- a provider
    // answering with a shape this route did not prepare for must fail
    // loudly rather than write a Payment with no way to pay it.
    if (charge.method !== provider.method) {
      console.error(
        `[registrations] provider ${provider.name} declared ${provider.method} but charged ${charge.method} for registration ${registration.id}`,
      );
      return NextResponse.json(
        { error: 'Kami tidak dapat memproses pembayaran saat ini. Silakan coba lagi nanti.' },
        { status: 503 },
      );
    }

    assertExactlyOnePaymentSubject({ registrationId: registration.id });

    await prisma.payment.create({
      data: {
        donationId: undefined,
        registrationId: registration.id,
        provider: provider.name,
        method: charge.method,
        providerRef: registration.id,
        amount: batch.trip.tripFeeAmount,
        status: PaymentStatus.PENDING,
        expiresAt: charge.expiresAt,
      },
    });

    const paymentInstructions =
      charge.method === 'qris_redirect'
        ? { type: 'qris' as const, redirectUrl: charge.redirectUrl, expiresAt: charge.expiresAt }
        : { type: 'bank_transfer' as const, vaNumber: charge.vaNumber, expiresAt: charge.expiresAt };

    return NextResponse.json(
      { registrationId: registration.id, amount: batch.trip.tripFeeAmount, paymentInstructions },
      { status: 201 },
    );
  } catch (error) {
    console.error('Error creating registration:', error);
    return NextResponse.json({ error: 'Gagal membuat registrasi' }, { status: 500 });
  }
}
