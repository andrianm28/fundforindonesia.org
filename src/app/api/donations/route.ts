import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

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

function generateMockPaymentInstructions(paymentMethod: string, donationId: string) {
  switch (paymentMethod) {
    case 'bank_transfer':
      return {
        type: 'bank_transfer',
        bankName: 'BCA',
        vaNumber: `8808${Date.now().toString().slice(-8)}`,
        expiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
    case 'ewallet':
      return {
        type: 'ewallet',
        deeplink: `gojek://gopay/pay?id=${donationId}`,
        qrCode: `mock-qr-data-${donationId}`,
      };
    case 'credit_card':
      return {
        type: 'credit_card',
        redirectUrl: `/payment/cc/${donationId}`,
      };
    default:
      return { type: 'unknown' };
  }
}

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

    // 2. Verify campaign exists and is active
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

    // 3. Get session (optional — donorId can be null for anonymous guests)
    const session = await getServerSession();
    const donorId = session?.user?.id || null;

    // 4. Create donation record with paymentStatus: "pending"
    const donation = await prisma.donation.create({
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

    // 5. If message is provided, create a Prayer record linked to the donation
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

    // 6. Generate mock payment instructions
    const paymentInstructions = generateMockPaymentInstructions(paymentMethod, donation.id);

    // 7. Return 201 with donation ID and payment instructions
    return NextResponse.json(
      {
        donationId: donation.id,
        amount: donation.amount,
        paymentMethod: donation.paymentMethod,
        paymentStatus: donation.paymentStatus,
        campaignTitle: campaign.title,
        paymentInstructions,
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
