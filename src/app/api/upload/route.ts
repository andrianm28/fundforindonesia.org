import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { withRoleCheck } from '@/lib/withRoleCheck';

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads');

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * The extension comes from the validated MIME type ONLY -- never from the
 * uploader's filename.
 *
 * This previously preferred the original name's extension, which meant a file
 * declared as image/png but named "evil.html" was written as "<id>.html" into
 * public/uploads and then served from the same origin as the donation flow.
 * The same path gave ".svg" (scriptable in a browser) and any other extension
 * the uploader felt like. originalName is now ignored entirely: it is
 * attacker-controlled and contributes nothing the MIME map cannot supply.
 *
 * The parameter is kept so existing callers and tests do not have to change
 * shape, and so the signature still documents what is deliberately unused.
 */
export function generateUniqueFilename(mimeType: string, _originalName?: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2);
  const ext = MIME_TO_EXT[mimeType] ?? 'jpg';
  return `${timestamp}-${random}.${ext}`;
}

export function validateFileType(type: string): boolean {
  return ALLOWED_TYPES.includes(type);
}

export function validateFileSize(size: number): boolean {
  return size <= MAX_FILE_SIZE;
}

/**
 * Writes an uploaded image into public/uploads and returns its public URL.
 *
 * Requires a signed-in user. It shipped with no authentication at all, and the
 * middleware matcher covers only page routes -- no /api path -- so anyone on
 * the internet could write files into a publicly-served directory on the
 * donation domain. That is free file hosting plus an unbounded disk-fill.
 *
 * DONOR is the floor rather than a higher role because uploading a cover image
 * is part of ordinary campaign creation; the point is to have an account behind
 * the write, not to restrict it to staff.
 */
export const POST = withRoleCheck('DONOR', async (request: NextRequest) => {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'File harus diunggah' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!validateFileType(file.type)) {
      return NextResponse.json(
        { error: 'Tipe file tidak didukung. Gunakan JPEG, PNG, atau WebP.' },
        { status: 400 }
      );
    }

    // Validate file size
    if (!validateFileSize(file.size)) {
      return NextResponse.json(
        { error: 'Ukuran file terlalu besar. Maksimal 5MB.' },
        { status: 413 }
      );
    }

    // Ensure upload directory exists
    await mkdir(UPLOAD_DIR, { recursive: true });

    // Generate unique filename
    const filename = generateUniqueFilename(file.type, file.name);
    const filepath = join(UPLOAD_DIR, filename);

    // Write file to disk
    const bytes = await file.arrayBuffer();
    await writeFile(filepath, Buffer.from(bytes));

    // Return public URL
    const url = `/uploads/${filename}`;
    return NextResponse.json({ url, filename }, { status: 201 });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Gagal mengunggah file' },
      { status: 500 }
    );
  }
});
