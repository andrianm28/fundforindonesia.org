import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const session = await getServerSession();

  if (!session?.user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));
  const skip = (page - 1) * limit;

  const [donations, total] = await Promise.all([
    prisma.donation.findMany({
      where: { donorId: session.user.id },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        amount: true,
        paymentMethod: true,
        paymentStatus: true,
        isAnonymous: true,
        message: true,
        createdAt: true,
        campaign: {
          select: {
            title: true,
            slug: true,
            coverImage: true,
          },
        },
      },
    }),
    prisma.donation.count({
      where: { donorId: session.user.id },
    }),
  ]);

  const totalPages = Math.ceil(total / limit);

  return NextResponse.json({
    donations,
    total,
    page,
    limit,
    totalPages,
  });
}
