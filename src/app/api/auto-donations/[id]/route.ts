import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";

const updateAutoDonationSchema = z.object({
  amount: z.number().int().positive("Jumlah donasi harus lebih dari 0").optional(),
  category: z.string().min(1, "Kategori harus diisi").optional(),
  schedule: z
    .enum(["daily", "weekly"], {
      error: "Jadwal harus 'daily' atau 'weekly'",
    })
    .optional(),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Format waktu harus HH:mm")
    .optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();

    if (!session?.user) {
      return NextResponse.json(
        { error: "Anda harus login terlebih dahulu" },
        { status: 401 }
      );
    }

    const { id } = params;

    // Verify ownership
    const existing = await prisma.autoDonation.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Donasi otomatis tidak ditemukan" },
        { status: 404 }
      );
    }

    if (existing.userId !== session.user.id) {
      return NextResponse.json(
        { error: "Anda tidak memiliki akses ke donasi otomatis ini" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const result = updateAutoDonationSchema.safeParse(body);

    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json(
        { error: "Validasi gagal", fieldErrors },
        { status: 400 }
      );
    }

    const autoDonation = await prisma.autoDonation.update({
      where: { id },
      data: result.data,
    });

    return NextResponse.json({ autoDonation });
  } catch (error) {
    console.error("Error updating auto-donation:", error);
    return NextResponse.json(
      { error: "Gagal mengubah donasi otomatis" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();

    if (!session?.user) {
      return NextResponse.json(
        { error: "Anda harus login terlebih dahulu" },
        { status: 401 }
      );
    }

    const { id } = params;

    // Verify ownership
    const existing = await prisma.autoDonation.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Donasi otomatis tidak ditemukan" },
        { status: 404 }
      );
    }

    if (existing.userId !== session.user.id) {
      return NextResponse.json(
        { error: "Anda tidak memiliki akses ke donasi otomatis ini" },
        { status: 403 }
      );
    }

    await prisma.autoDonation.delete({
      where: { id },
    });

    return NextResponse.json({ message: "Donasi otomatis berhasil dihapus" });
  } catch (error) {
    console.error("Error deleting auto-donation:", error);
    return NextResponse.json(
      { error: "Gagal menghapus donasi otomatis" },
      { status: 500 }
    );
  }
}
