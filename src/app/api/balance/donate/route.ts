import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WALLET_ENABLED, WALLET_DISABLED_MESSAGE } from "@/lib/wallet";

const balanceDonateSchema = z.object({
  campaignId: z.string().min(1, "Campaign ID harus diisi"),
  amount: z.number().int().min(1000, "Minimum donasi Rp1.000"),
  message: z.string().max(500, "Pesan maksimal 500 karakter").optional(),
  isAnonymous: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  if (!WALLET_ENABLED) {
    return NextResponse.json({ error: WALLET_DISABLED_MESSAGE }, { status: 503 });
  }

  try {
    // 1. Require authentication
    const session = await getServerSession();

    if (!session?.user) {
      return NextResponse.json(
        { error: "Anda harus login terlebih dahulu" },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // 2. Parse and validate request body
    const body = await request.json();
    const result = balanceDonateSchema.safeParse(body);

    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json(
        { error: "Validasi gagal", fieldErrors },
        { status: 400 }
      );
    }

    const { campaignId, amount, message, isAnonymous } = result.data;

    // 3. Verify campaign exists and is active
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, status: true, targetAmount: true, collectedAmount: true },
    });

    if (!campaign) {
      return NextResponse.json(
        { error: "Campaign tidak ditemukan" },
        { status: 404 }
      );
    }

    if (campaign.status !== "active") {
      return NextResponse.json(
        { error: "Campaign tidak aktif. Hanya campaign aktif yang dapat menerima donasi." },
        { status: 400 }
      );
    }

    // 4. Check user's current balance
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { donationBalance: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User tidak ditemukan" },
        { status: 404 }
      );
    }

    if (user.donationBalance < amount) {
      return NextResponse.json(
        {
          error: "Saldo tidak mencukupi",
          currentBalance: user.donationBalance,
        },
        { status: 400 }
      );
    }

    // 5. Atomic transaction: deduct balance, create donation, increment campaign
    const newCollectedAmount = campaign.collectedAmount + amount;
    const shouldComplete = newCollectedAmount >= campaign.targetAmount;

    const [updatedUser, donation] = await prisma.$transaction([
      // Deduct user balance
      prisma.user.update({
        where: { id: userId },
        data: { donationBalance: { decrement: amount } },
        select: { donationBalance: true },
      }),
      // Create confirmed donation (balance donations are instant)
      prisma.donation.create({
        data: {
          amount,
          isAnonymous,
          paymentMethod: "balance",
          paymentStatus: "confirmed",
          message: message || null,
          campaignId,
          donorId: userId,
        },
      }),
      // Increment campaign collected amount
      prisma.campaign.update({
        where: { id: campaignId },
        data: {
          collectedAmount: { increment: amount },
          ...(shouldComplete ? { status: "completed" } : {}),
        },
      }),
    ]);

    // 6. If message is provided, create Prayer record
    if (message) {
      await prisma.prayer.create({
        data: {
          text: message,
          donationId: donation.id,
          campaignId,
          userId,
        },
      });
    }

    // 7. Return 201 with donation info and new balance
    return NextResponse.json(
      {
        donationId: donation.id,
        newBalance: updatedUser.donationBalance,
        message: "Donasi berhasil",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error processing balance donation:", error);
    return NextResponse.json(
      { error: "Gagal memproses donasi" },
      { status: 500 }
    );
  }
}
