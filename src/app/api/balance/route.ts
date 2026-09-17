import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
