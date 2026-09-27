import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth";
import { readUserEmail, SELECT_USER_EMAIL } from "@/lib/contact-fields";
import { prisma } from "@/lib/prisma";

const profileSchema = z.object({
  name: z
    .string()
    .min(2, "Nama minimal 2 karakter")
    .max(50, "Nama maksimal 50 karakter"),
});

/**
 * PATCH /api/user/profile
 * Updates the authenticated user's profile name.
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const result = profileSchema.safeParse(body);

    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      return NextResponse.json(
        { error: "Validasi gagal", fieldErrors },
        { status: 400 }
      );
    }

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: { name: result.data.name },
      select: { id: true, name: true, avatar: true, ...SELECT_USER_EMAIL },
    });

    return NextResponse.json({
      user: { id: user.id, name: user.name, email: readUserEmail(user), avatar: user.avatar },
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    return NextResponse.json(
      { error: "Gagal memperbarui profil" },
      { status: 500 }
    );
  }
}
