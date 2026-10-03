import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword, verifyPassword } from "@/lib/password-hash";
import { PASSWORD_HASH_COST } from "@/lib/password-hash-cost";
import { passwordField } from "@/lib/password-schema";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Password saat ini harus diisi"),
    newPassword: passwordField,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Konfirmasi password tidak cocok",
    path: ["confirmPassword"],
  });

export async function PATCH(request: NextRequest) {
  try {
    // 1. Require authentication
    const session = await getServerSession();

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2. Parse and validate request body
    const body = await request.json();
    const result = passwordSchema.safeParse(body);

    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json(
        { error: "Validasi gagal", fieldErrors },
        { status: 400 }
      );
    }

    const { currentPassword, newPassword } = result.data;

    // 3. Fetch user with password from DB
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, password: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User tidak ditemukan" },
        { status: 404 }
      );
    }

    // 4. OAuth guard: if user has no password (Google-authenticated), reject
    if (user.password === null) {
      return NextResponse.json(
        { error: "Akun Google tidak dapat mengubah password" },
        { status: 400 }
      );
    }

    // 5. Verify current password
    const isCurrentPasswordValid = await verifyPassword(
      currentPassword,
      user.password
    );

    if (!isCurrentPasswordValid) {
      return NextResponse.json(
        { error: "Password saat ini salah" },
        { status: 400 }
      );
    }

    // 6. Hash new password and update DB. Same factor registration uses, so
    // rotating a password can never leave the account weaker than it was.
    const hashedPassword = await hashPassword(newPassword, PASSWORD_HASH_COST);

    await prisma.user.update({
      where: { id: session.user.id },
      data: { password: hashedPassword },
    });

    return NextResponse.json({
      message: "Password berhasil diubah",
    });
  } catch (error) {
    console.error("Error changing password:", error);
    return NextResponse.json(
      { error: "Gagal mengubah password" },
      { status: 500 }
    );
  }
}
