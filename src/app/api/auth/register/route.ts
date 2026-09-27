import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { REGISTRATION_HASH_COST } from '@/lib/password-hash-cost';
import { lookupUserEmail, readUserEmail, sealUserEmail, SELECT_USER_EMAIL } from '@/lib/contact-fields';
import { prisma } from '@/lib/prisma';

const registerSchema = z.object({
  name: z.string().min(1, 'Nama harus diisi'),
  email: z.string().email('Format email tidak valid'),
  password: z.string().min(8, 'Password minimal 8 karakter'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const result = registerSchema.safeParse(body);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as string;
        if (!fieldErrors[field]) {
          fieldErrors[field] = issue.message;
        }
      }
      return NextResponse.json(
        { message: 'Validasi gagal', errors: fieldErrors },
        { status: 400 }
      );
    }

    const { name, email, password } = result.data;

    // The duplicate check goes through the lookup HMAC, so it finds the address
    // however it was typed -- including the case the old case-sensitive unique
    // let a second account be created with (ADR 0012).
    const existingUser = await prisma.user.findFirst({
      where: lookupUserEmail(email),
      select: { id: true },
    });

    if (existingUser) {
      return NextResponse.json(
        { message: 'Email sudah terdaftar' },
        { status: 409 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, REGISTRATION_HASH_COST);

    // Sealed at the call site rather than by the client hook: the plaintext
    // column is gone, so there is nothing for the hook to add it to. The hook
    // still catches any write that was not sealed here.
    const user = await prisma.user.create({
      data: {
        name,
        password: hashedPassword,
        ...sealUserEmail(email),
      },
      select: { id: true, name: true, ...SELECT_USER_EMAIL },
    });

    return NextResponse.json(
      {
        message: 'Registrasi berhasil',
        user: {
          id: user.id,
          name: user.name,
          email: readUserEmail(user),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { message: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}
