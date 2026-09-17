import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const ktpSchema = z.object({
  type: z.literal('ktp'),
  fullName: z.string().min(2, "Nama minimal 2 karakter").max(100, "Nama maksimal 100 karakter"),
  nik: z.string().regex(/^\d{16}$/, "NIK harus 16 digit"),
});

const orgSchema = z.object({
  type: z.literal('organization'),
  orgName: z.string().min(2, "Nama organisasi minimal 2 karakter").max(100, "Nama maksimal 100 karakter"),
  regNumber: z.string().min(5, "Nomor registrasi minimal 5 karakter"),
});

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  // Validate based on type
  let validData: z.infer<typeof ktpSchema> | z.infer<typeof orgSchema>;

  if (body.type === 'ktp') {
    const result = ktpSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validasi gagal", fieldErrors: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    validData = result.data;
  } else if (body.type === 'organization') {
    const result = orgSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validasi gagal", fieldErrors: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    validData = result.data;
  } else {
    return NextResponse.json(
      { error: "Tipe verifikasi tidak valid" },
      { status: 400 }
    );
  }

  // Update user: set verified + upgrade role
  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      isVerified: true,
      verificationType: validData.type,
      role: 'CAMPAIGN_CREATOR',
    },
    select: { id: true, isVerified: true, verificationType: true, role: true },
  });

  return NextResponse.json({ user }, { status: 200 });
}
