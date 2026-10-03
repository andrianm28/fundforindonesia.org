import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { PaymentProviderNotConfiguredError } from '@/lib/payments';
import { resolveActivePaymentProvider } from '@/lib/payments/active-provider';
import { canonicalPaymentProviderName } from '@/lib/payments/provider-names';
import { safePaymentLink } from '@/lib/payments/payment-link';
import { PROVIDER_METHOD_FOR } from '@/lib/volunteer/payment-method';
import { PaymentStatus } from '@/generated/prisma/client';
import { refusalResponse } from '@/lib/refusal-response';
import { holdRegistration } from '@/lib/volunteer/trip';
import { assertExactlyOnePaymentSubject } from '@/lib/money/payment-subject';
import { ESCROW_HOLD_DAYS } from '@/lib/money/escrow';
import { recordChargeWriteFailure, sanitizeError } from '@/lib/money/payment-reconciliation';
import {
  donationsEnabled,
  sandboxInProductionReason,
  DONATIONS_DISABLED_MESSAGE,
} from '@/lib/donations';
import { volunteerRegistrationEnabled, VOLUNTEER_DISABLED_MESSAGE } from '@/lib/volunteer/registration-flag';

const VALID_PAYMENT_METHODS = ['bank_transfer', 'qris'] as const;

const registerSchema = z.object({
  paymentMethod: z.enum(VALID_PAYMENT_METHODS, { error: 'Metode pembayaran tidak valid.' }),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  // Ticket 36 (owner 2026-09-29): the Registration flow is off until a real
  // payment provider exists. The server enforces it, not only the hidden
  // "Daftar" button; first of all, before the session or anything is read.
  if (!volunteerRegistrationEnabled()) {
    return NextResponse.json({ error: VOLUNTEER_DISABLED_MESSAGE }, { status: 503 });
  }

  // The same switch that gates POST /api/donations. Owner decision
  // 2026-09-28: Trip Fee is stopped by the SAME switch as Donation -- one
  // emergency switch stops all incoming money, not two that can drift apart.
  // Checked before the session, before the Trip is looked up, before
  // anything is held or written -- see donationsEnabled (src/lib/donations.ts).
  if (!donationsEnabled()) {
    return NextResponse.json({ error: DONATIONS_DISABLED_MESSAGE }, { status: 503 });
  }

  // The interlock behind the switch. Sandbox credentials in production take
  // real rupiah into an account that settles nowhere; see
  // sandboxInProductionReason (src/lib/donations.ts).
  const blocked = sandboxInProductionReason();
  if (blocked) {
    console.error(`[registrations] refusing every charge: ${blocked}`);
    return NextResponse.json({ error: DONATIONS_DISABLED_MESSAGE }, { status: 503 });
  }

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
    let enabledMethods;
    try {
      ({ provider, enabledMethods } = await resolveActivePaymentProvider(prisma));
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
    if (!enabledMethods.includes(wantedMethod)) {
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
        method: wantedMethod,
      });
    } catch (err) {
      console.error(`[registrations] charge failed for registration ${registration.id}: ${sanitizeError(err)}`);
      return NextResponse.json(
        { error: 'Kami tidak dapat memproses pembayaran saat ini. Silakan coba lagi nanti.' },
        { status: 503 },
      );
    }

    // Narrowed against what the provider declared, not cast -- a provider
    // answering with a shape this route did not prepare for must fail
    // loudly rather than write a Payment with no way to pay it.
    if (charge.method !== wantedMethod) {
      console.error(
        `[registrations] provider ${providerName} was asked for ${wantedMethod} but charged ${charge.method} for registration ${registration.id}`,
      );
      return NextResponse.json(
        { error: 'Kami tidak dapat memproses pembayaran saat ini. Silakan coba lagi nanti.' },
        { status: 503 },
      );
    }

    assertExactlyOnePaymentSubject({ registrationId: registration.id });

    // Only an https link on a payment-provider host is stored or handed back;
    // anything else becomes null, and the HOLD falls back to "batalkan lalu
    // daftar ulang" rather than sending a Volunteer to an arbitrary address.
    const redirectUrl = charge.method === 'qris_redirect' ? safePaymentLink(charge.redirectUrl) : null;

    // The charge now exists at the provider. A Payment write that fails here
    // leaves money a Volunteer can still pay with no row expecting it, so it is
    // recorded for reconciliation (ticket 52) before the 503.
    try {
      await prisma.payment.create({
        data: {
          donationId: undefined,
          registrationId: registration.id,
          provider: providerName,
          method: charge.method,
          providerRef: registration.id,
          amount: tripFeeAmount,
          // Trip Fee takes the same Escrow Hold as a Campaign Donation, minus
          // the Platform Fee and the Kind (CONTEXT.md, Trip Fee; ADR 0014), so
          // it freezes the SAME length here as chargeDonation does on the
          // donation path. Naming the constant rather than letting the
          // `escrowHoldDays Int @default(7)` in prisma/schema.prisma supply it
          // is the whole point: that default is a second copy of the number
          // that nothing in src/ can see, and the day that 7 is moved to
          // configuration the two copies drift -- Trip Fee releasing after 7
          // while Donation releases after N, with the settlement webhook
          // reading whichever this row happens to carry. Naming it here is also
          // what makes the frozen-per-Payment rule (prd-compliance 18) true of
          // this Payment: its length is decided in code at creation, not
          // inherited from a schema default nobody chose deliberately.
          escrowHoldDays: ESCROW_HOLD_DAYS,
          status: PaymentStatus.PENDING,
          expiresAt: charge.expiresAt,
          // Kept so a Volunteer who closed the payment page can open it again
          // ("Lanjutkan pembayaran", ticket 37): the provider is not asked twice.
          redirectUrl,
          vaNumber: charge.method === 'bank_transfer_va' ? charge.vaNumber : null,
        },
      });
    } catch (err) {
      await recordChargeWriteFailure(prisma, {
        provider: providerName,
        providerRef: registration.id,
        subjectType: 'registration',
        subjectId: registration.id,
        amount: tripFeeAmount,
        error: err,
      });
      return NextResponse.json(
        { error: 'Kami tidak dapat memproses pembayaran saat ini. Silakan coba lagi nanti.' },
        { status: 503 },
      );
    }

    const paymentInstructions =
      charge.method === 'qris_redirect'
        ? { type: 'qris' as const, redirectUrl, expiresAt: charge.expiresAt }
        : charge.method === 'bank_transfer_va'
          ? { type: 'bank_transfer' as const, vaNumber: charge.vaNumber, expiresAt: charge.expiresAt }
          : null;
    // Trip Fee offers QRIS and bank transfer only (RegistrationPaymentMethod),
    // so wantedMethod can never be an e-wallet and this cannot happen; it is
    // narrowed rather than cast so the day a method is added it does not
    // silently fall into the VA branch.
    if (!paymentInstructions) throw new Error(`Unexpected Trip Fee charge method ${charge.method}`);

    return NextResponse.json(
      {
        registrationId: registration.id,
        amount: tripFeeAmount,
        holdExpiresAt: registration.holdExpiresAt,
        paymentInstructions,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error(`Error creating registration: ${sanitizeError(error)}`);
    return NextResponse.json({ error: 'Gagal membuat registrasi' }, { status: 500 });
  }
}
