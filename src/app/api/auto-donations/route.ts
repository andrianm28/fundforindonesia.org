import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const autoDonationSchema = z.object({
  amount: z.number().int().min(1000, "Minimum donasi Rp1.000").max(10000000, "Maksimum donasi Rp10.000.000"),
  category: z.string().min(1, "Pilih kategori donasi"),
  schedule: z.enum(["daily", "weekly"], {
    error: "Jadwal harus 'daily' atau 'weekly'",
  }),
  time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Format waktu harus HH:mm"),
  isActive: z.boolean().optional().default(true),
});

/**
 * GET /api/auto-donations
 * Returns the authenticated user's auto-donation settings.
 */
export async function GET() {
  const session = await getServerSession();

  if (!session?.user) {
    return NextResponse.json(
      { error: "Anda harus login terlebih dahulu" },
      { status: 401 }
    );
  }

  const autoDonations = await prisma.autoDonation.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  // Also return the most recent as "settings" for the page UI
  const settings = autoDonations.length > 0 ? autoDonations[0] : null;

  return NextResponse.json({ autoDonations, settings });
}

/**
 * POST /api/auto-donations
 * Creates or updates the authenticated user's auto-donation settings.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user) {
      return NextResponse.json(
        { error: "Anda harus login terlebih dahulu" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const result = autoDonationSchema.safeParse(body);

    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json(
        { error: "Validasi gagal", fieldErrors },
        { status: 400 }
      );
    }

    const { amount, category, schedule, time, isActive } = result.data;

    // Check if user already has auto-donation settings
    const existing = await prisma.autoDonation.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
    });

    let autoDonation;

    if (existing) {
      // Update existing settings
      autoDonation = await prisma.autoDonation.update({
        where: { id: existing.id },
        data: { amount, category, schedule, time, isActive },
      });

      return NextResponse.json({ autoDonation, settings: autoDonation });
    } else {
      // Create new settings
      autoDonation = await prisma.autoDonation.create({
        data: {
          amount,
          category,
          schedule,
          time,
          userId: session.user.id,
        },
      });

      return NextResponse.json(
        { autoDonation, settings: autoDonation },
        { status: 201 }
      );
    }
  } catch (error) {
    console.error("Error saving auto-donation settings:", error);
    return NextResponse.json(
      { error: "Gagal menyimpan pengaturan donasi otomatis" },
      { status: 500 }
    );
  }
}
