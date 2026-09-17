import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { PaymentStatus } from '@/generated/prisma/client';
import { getPaymentProvider, PaymentProviderNotConfiguredError } from '@/lib/payments';

const VALID_PAYMENT_METHODS = ['bank_transfer', 'ewallet', 'credit_card'] as const;

const createDonationSchema = z.object({
  campaignId: z.string().min(1, "Campaign ID harus diisi"),
  amount: z.number().int().min(1000, "Minimum donasi Rp1.000"),
  paymentMethod: z.enum(VALID_PAYMENT_METHODS, {
    error: "Metode pembayaran tidak valid. Pilih: bank_transfer, ewallet, atau credit_card",
  }),
  message: z.string().max(500, "Pesan maksimal 500 karakter").optional(),
  isAnonymous: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  try {
    // 1. Parse and validate request body
    const body = await request.json();
    const result = createDonationSchema.safeParse(body);

    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json(
        { error: 'Validasi gagal', fieldErrors },
        { status: 400 }
      );
    }

    const { campaignId, amount, paymentMethod, message, isAnonymous } = result.data;

    // 2. Only bank_transfer actually charges anything. The enum still accepts
    // ewallet and credit_card -- the frontend contract depends on it -- but
    // there is no provider integration behind them, and inventing payment
    // instructions for a method nobody can pay through is exactly the habit
    // this money layer exists to end.
    if (paymentMethod !== 'bank_transfer') {
      return NextResponse.json(
        { error: 'Metode pembayaran ini belum tersedia. Silakan gunakan transfer bank.' },
        { status: 503 }
      );
    }

    // 3. Verify campaign exists and is active
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, status: true, title: true },
    });

    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign tidak ditemukan' },
        { status: 404 }
      );
    }

    if (campaign.status !== 'active') {
      return NextResponse.json(
        { error: 'Campaign tidak aktif. Hanya campaign aktif yang dapat menerima donasi.' },
        { status: 400 }
      );
    }

    // 4. Get session (optional — donorId can be null for anonymous guests)
    const session = await getServerSession();
    const donorId = session?.user?.id || null;

    // 5. Build the provider before touching the database. If it is not
    // configured, nothing has been written yet -- there is no half-created
    // donation to clean up.
    let provider;
    try {
      provider = getPaymentProvider();
    } catch (err) {
      if (err instanceof PaymentProviderNotConfiguredError) {
        return NextResponse.json(
          { error: 'Kami tidak dapat memproses pembayaran saat ini. Silakan coba lagi nanti.' },
          { status: 503 }
        );
      }
      throw err;
    }

    // 6. Create the Donation and its Payment in one transaction, and charge
    // the provider inside it: if the charge fails, the transaction rolls back
    // and there is no Donation left with no Payment behind it. The Prayer
    // creation stays outside (as it did before) -- a lost prayer costs a
    // visitor a retype, but a Payment written without its Donation is money
    // with no owner, which is the one thing this transaction exists to
    // prevent.
    //
    // No ledger entries here: a pending payment has moved no money, and
    // posting on creation is how a campaign would show funds for a donation
    // that was never paid.
    const { donation, charge } = await prisma.$transaction(async (tx) => {
      const donation = await tx.donation.create({
        data: {
          amount,
          isAnonymous,
          paymentMethod,
          paymentStatus: 'pending',
          message: message || null,
          campaignId,
          donorId,
        },
      });

      // The donation id IS the provider's order id -- the webhook (task M5)
      // gets only an order_id back from the provider and finds this Payment
      // by providerRef, so the two must be the same value from the start.
      const charge = await provider.createCharge({
        orderId: donation.id,
        grossAmount: amount,
        currency: 'IDR',
      });

      // bank_transfer only ever asks for a VA charge, so this is the one
      // branch a real Midtrans adapter can answer with today. Narrowed
      // explicitly rather than cast, so a future provider answering with
      // qris_redirect here fails loudly instead of writing a Payment with no
      // VA number.
      if (charge.method !== 'bank_transfer_va') {
        throw new Error(`Unexpected charge method for bank_transfer: ${charge.method}`);
      }

      await tx.payment.create({
        data: {
          donationId: donation.id,
          provider: 'mock',
          method: charge.method,
          providerRef: donation.id,
          amount,
          status: PaymentStatus.PENDING,
          expiresAt: charge.expiresAt,
        },
      });

      return { donation, charge };
    });

    // 7. If message is provided, create a Prayer record linked to the donation
    if (message) {
      await prisma.prayer.create({
        data: {
          text: message,
          donationId: donation.id,
          campaignId,
          userId: donorId,
        },
      });
    }

    // 8. Return 201 with the donation and the real VA number the provider
    // issued -- not one invented locally.
    return NextResponse.json(
      {
        donationId: donation.id,
        amount: donation.amount,
        paymentMethod: donation.paymentMethod,
        paymentStatus: donation.paymentStatus,
        campaignTitle: campaign.title,
        paymentInstructions: {
          type: 'bank_transfer',
          vaNumber: charge.vaNumber,
          expiresAt: charge.expiresAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating donation:', error);
    return NextResponse.json(
      { error: 'Gagal membuat donasi' },
      { status: 500 }
    );
  }
}
