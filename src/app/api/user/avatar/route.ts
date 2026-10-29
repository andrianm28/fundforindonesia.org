import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { guardRoute } from '@/lib/rate-limit-guard';
import { matchesDeclaredImageType } from '@/lib/uploads';

/** Avatar uploads per account per hour. */
const AVATAR_LIMIT = 10;
const AVATAR_WINDOW_SECONDS = 60 * 60;
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads');

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // After the session check so anonymous floods cost no write. Fail-open:
    // a limiter outage must not block a profile photo.
    const refused = await guardRoute(
      {
        scope: 'avatar',
        subject: session.user.id ?? 'unknown',
        limit: AVATAR_LIMIT,
        windowSeconds: AVATAR_WINDOW_SECONDS,
        onUnavailable: 'open',
      },
      { limited: 'Terlalu banyak unggahan. Coba lagi nanti.' },
    );
    if (refused) return refused;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'File harus diunggah' },
        { status: 400 }
      );
    }

    // Validate MIME type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Tipe file tidak didukung. Gunakan PNG, JPG, atau WebP.' },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Ukuran file terlalu besar. Maksimal 2MB.' },
        { status: 400 }
      );
    }

    // The declared type is the uploader's claim: check the bytes themselves.
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!matchesDeclaredImageType(bytes, file.type)) {
      return NextResponse.json(
        { error: 'Isi file tidak sesuai dengan tipenya. Gunakan PNG, JPG, atau WebP.' },
        { status: 415 }
      );
    }

    // Ensure upload directory exists
    await mkdir(UPLOAD_DIR, { recursive: true });

    // Generate unique filename
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2);
    const ext = MIME_TO_EXT[file.type] || 'jpg';
    const filename = `${timestamp}-${random}.${ext}`;
    const filepath = join(UPLOAD_DIR, filename);

    // Write file to disk
    await writeFile(filepath, Buffer.from(bytes));

    // Update user avatar in DB
    const avatarPath = `/uploads/${filename}`;
    await prisma.user.update({
      where: { id: session.user.id },
      data: { avatar: avatarPath },
    });

    return NextResponse.json({ avatar: avatarPath }, { status: 200 });
  } catch (error) {
    console.error('Avatar upload error:', error);
    return NextResponse.json(
      { error: 'Gagal mengunggah avatar' },
      { status: 500 }
    );
  }
}
