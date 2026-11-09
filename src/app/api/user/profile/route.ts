import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth";
import {
  readUserEmail,
  readUserPhone,
  sealUserPhone,
  SELECT_USER_EMAIL,
  SELECT_USER_PHONE,
} from "@/lib/contact-fields";
import { prisma } from "@/lib/prisma";
import { normaliseWhatsapp } from "@/lib/whatsapp";

const profileSchema = z
  .object({
    name: z
      .string()
      .min(2, "Nama minimal 2 karakter")
      .max(50, "Nama maksimal 50 karakter")
      .optional(),
    /** Empty string or null clears the number (PKS 3.1: optional). */
    whatsapp: z.string().max(30, "Nomor WhatsApp terlalu panjang").nullable().optional(),
    profileType: z.enum(["INDIVIDUAL", "ORGANISATION"]).optional(),
  })
  .refine((v) => v.name !== undefined || v.whatsapp !== undefined || v.profileType !== undefined, {
    message: "Tidak ada yang diubah",
  });

const PROFILE_SELECT = {
  id: true,
  name: true,
  avatar: true,
  profileType: true,
  ...SELECT_USER_EMAIL,
  ...SELECT_USER_PHONE,
} as const;

type ProfileRow = {
  id: string;
  name: string;
  avatar: string | null;
  profileType: "INDIVIDUAL" | "ORGANISATION";
  emailCiphertext: string;
  emailKeyId: string;
  phoneCiphertext: string | null;
  phoneKeyId: string | null;
};

function present(user: ProfileRow) {
  return {
    id: user.id,
    name: user.name,
    email: readUserEmail(user),
    avatar: user.avatar,
    whatsapp: readUserPhone(user),
    profileType: user.profileType,
  };
}

/**
 * GET /api/user/profile
 * The authenticated user's own profile, including the decrypted WhatsApp
 * number (their own data, for the settings form).
 */
export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: PROFILE_SELECT });
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ user: present(user as ProfileRow) });
  } catch (error) {
    console.error("Error reading profile:", error);
    return NextResponse.json({ error: "Gagal memuat profil" }, { status: 500 });
  }
}

/**
 * PATCH /api/user/profile
 * Updates the authenticated user's name, WhatsApp number (stored encrypted,
 * ADR 0012) and profile type (Individu/Lembaga).
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

    const data: Record<string, unknown> = {};
    if (result.data.name !== undefined) data.name = result.data.name;
    if (result.data.profileType !== undefined) data.profileType = result.data.profileType;
    if (result.data.whatsapp !== undefined) {
      const phone = normaliseWhatsapp(result.data.whatsapp);
      if (!phone.ok) {
        return NextResponse.json(
          { error: "Validasi gagal", fieldErrors: { whatsapp: [phone.message] } },
          { status: 400 }
        );
      }
      Object.assign(data, sealUserPhone(phone.value));
    }

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data,
      select: PROFILE_SELECT,
    });

    return NextResponse.json({ user: present(user as ProfileRow) });
  } catch (error) {
    console.error("Error updating profile:", error);
    return NextResponse.json(
      { error: "Gagal memperbarui profil" },
      { status: 500 }
    );
  }
}
