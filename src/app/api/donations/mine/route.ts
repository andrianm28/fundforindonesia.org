import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { claimGuestDonations } from "@/lib/guest-donation-claim";

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

  // A Guest Donor's earlier gifts join this list only once the account's email
  // is confirmed by link (prd-compliance 23). Idempotent: with nothing new to
  // claim it writes nothing, and for an unverified account it reads one row.
  const { verified: emailVerified } = await claimGuestDonations(session.user.id);

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
        // Only a settled Donation has one (CONTEXT.md, Receipt) -- null here
        // is how the dashboard knows there is no print page to link to yet.
        receipt: {
          select: { token: true },
        },
        // Only a settled Donation on a `wakaf` Campaign has one (CONTEXT.md,
        // Akad Wakaf; ticket 22) -- null for every other Kind and for one
        // not yet settled.
        akadWakaf: {
          select: { token: true },
        },
      },
    }),
    prisma.donation.count({
      where: { donorId: session.user.id },
    }),
  ]);

  const totalPages = Math.ceil(total / limit);

  return NextResponse.json({
    donations: donations.map(({ receipt, akadWakaf, ...donation }) => ({
      ...donation,
      receiptToken: receipt?.token ?? null,
      akadWakafToken: akadWakaf?.token ?? null,
    })),
    total,
    emailVerified,
    page,
    limit,
    totalPages,
  });
}
