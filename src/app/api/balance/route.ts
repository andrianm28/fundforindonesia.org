import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WALLET_ENABLED, WALLET_DISABLED_MESSAGE } from "@/lib/wallet";

export async function GET() {
  if (!WALLET_ENABLED) {
    return NextResponse.json({ error: WALLET_DISABLED_MESSAGE }, { status: 503 });
  }

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
