import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getPaymentProvider, PaymentProviderNotConfiguredError } from '@/lib/payments';
import { canonicalPaymentProviderName } from '@/lib/payments/provider-names';
import type { PaymentMethod } from '@/lib/payments';
import { PaymentStatus } from '@/generated/prisma/client';
import { refusalResponse } from '@/lib/refusal-response';
import { holdRegistration } from '@/lib/volunteer/trip';
import { assertExactlyOnePaymentSubject } from '@/lib/money/payment-subject';

const VALID_PAYMENT_METHODS = ['bank_transfer', 'qris'] as const;
const PROVIDER_METHOD_FOR: Record<(typeof VALID_PAYMENT_METHODS)[number], PaymentMethod> = {
  bank_transfer: 'bank_transfer_va',
  qris: 'qris_redirect',
};

const registerSchema = z.object({
  paymentMethod: z.enum(VALID_PAYMENT_METHODS, { error: 'Metode pembayaran tidak valid.' }),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { slug, id: batchId } = await params;

    // Only which Trip the URL names; whether it and the Batch take
    // Registrations is judged by `holdRegistration`, under their locks.
    const trip = await prisma.volunteerTrip.findUnique({ where: { slug }, select: { id: true } });
    if (!trip) {
      return NextResponse.json({ error: 'Volunteer batch tidak ditemukan' }, { status: 404 });
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

    // The name the Payment is recorded under, resolved through the registry
    // here rather than read off the adapter where the row is written below.
    // `Payment.provider` is a join key the Provider Balance groups by, not a
    // label, and the registry locks its builder KEYS rather than the adapters'
    // `name` -- so a misspelt `readonly name` compiled silently and "SumoPod"
    // and "sumopod" became two pots for one provider, each reconciling exactly
    // against nothing. Ahead of the charge for the same reason the method check
    // is: an adapter naming no provider is a defect in the build, and a charge
    // created and then abandoned is money a Volunteer can pay into nothing.
    const providerName = canonicalPaymentProviderName(provider.name);

    let held;
    try {
      held = await holdRegistration(prisma, {
        tripId: trip.id,
        batchId,
        volunteerId: session.user.id as string,
      });
    } catch (err) {
      const refusal = refusalResponse(err);
      if (refusal) return refusal;
      throw err;
    }
    const { registration, tripFeeAmount } = held;

    // Charge outside the transaction that created the Registration -- the
    // Registration is already committed, so a failed charge leaves a
    // recoverable HOLD (it simply expires at the next hold on its Batch) rather than
    // an uncommitted row holding a database connection across a provider
    // round trip. Mirrors POST /api/donations's own reasoning exactly.
    let charge;
    try {
      charge = await provider.createCharge({
        orderId: registration.id,
        grossAmount: tripFeeAmount,
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
        `[registrations] provider ${providerName} declared ${provider.method} but charged ${charge.method} for registration ${registration.id}`,
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
        provider: providerName,
        method: charge.method,
        providerRef: registration.id,
        amount: tripFeeAmount,
        status: PaymentStatus.PENDING,
        expiresAt: charge.expiresAt,
      },
    });

    const paymentInstructions =
      charge.method === 'qris_redirect'
        ? { type: 'qris' as const, redirectUrl: charge.redirectUrl, expiresAt: charge.expiresAt }
        : { type: 'bank_transfer' as const, vaNumber: charge.vaNumber, expiresAt: charge.expiresAt };

    return NextResponse.json(
      { registrationId: registration.id, amount: tripFeeAmount, paymentInstructions },
      { status: 201 },
    );
  } catch (error) {
    console.error('Error creating registration:', error);
    return NextResponse.json({ error: 'Gagal membuat registrasi' }, { status: 500 });
  }
}
