import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";
import { WALLET_ENABLED, WALLET_DISABLED_MESSAGE } from "@/lib/wallet";

const topUpSchema = z.object({
  amount: z
    .number()
    .min(10000, "Minimum top up Rp10.000")
    .max(10000000, "Maksimum top up Rp10.000.000"),
  paymentMethod: z.enum(["BCA", "Mandiri", "BNI", "GoPay", "OVO", "Dana"]),
});

export async function POST(request: NextRequest) {
  if (!WALLET_ENABLED) {
    return NextResponse.json({ error: WALLET_DISABLED_MESSAGE }, { status: 503 });
  }

  try {
    const session = await getServerSession();

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const result = topUpSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        {
          error: "Validasi gagal",
          fieldErrors: result.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    // Create TopUp record AND increment balance in a transaction
    const [topUp, updatedUser] = await prisma.$transaction([
      prisma.topUp.create({
        data: {
          amount: result.data.amount,
          paymentMethod: result.data.paymentMethod,
          status: "confirmed",
          userId: session.user.id,
        },
      }),
      prisma.user.update({
        where: { id: session.user.id },
        data: { donationBalance: { increment: result.data.amount } },
        select: { donationBalance: true },
      }),
    ]);

    return NextResponse.json(
      { topUp, balance: updatedUser.donationBalance },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error processing top up:", error);
    return NextResponse.json(
      { error: "Gagal melakukan top up" },
      { status: 500 }
    );
  }
}
