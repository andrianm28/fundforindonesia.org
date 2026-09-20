import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Reading a balance stays available while the wallet existed.
 *
 * The hole that closed the wallet was minting (`POST /api/user/topup` credited
 * a balance with no payment) and spending (`POST /api/balance/donate` moved it
 * into a campaign's total). Both refused. They have been removed; see src/lib/wallet.ts.
 * This endpoint only reads: it
 * cannot create a rupiah or move one.
 *
 * Gating it too would have bought no safety and cost something real. Five users
 * hold balances totalling Rp 1.371.884, and the pages that display it fall back
 * to zero when this call fails -- so blocking the read tells those people their
 * money is gone. It is not gone. It is recorded, owed to them, and temporarily
 * unspendable, and that is what they should be able to see.
 */
export async function GET() {
  const session = await getServerSession();

  if (!session?.user) {
    return NextResponse.json(
      { message: "Anda harus login terlebih dahulu" },
      { status: 401 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { donationBalance: true },
  });

  return NextResponse.json({ balance: user?.donationBalance ?? 0 });
}
