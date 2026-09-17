import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads');

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function generateUniqueFilename(mimeType: string, originalName: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2);
  // Prefer extension from original filename, fallback to mime mapping
  const nameExt = originalName.includes('.') ? originalName.split('.').pop() : null;
  const ext = nameExt || MIME_TO_EXT[mimeType] || 'jpg';
  return `${timestamp}-${random}.${ext}`;
}

export function validateFileType(type: string): boolean {
  return ALLOWED_TYPES.includes(type);
}

export function validateFileSize(size: number): boolean {
  return size <= MAX_FILE_SIZE;
}

export async function POST(request: NextRequest) {
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
}
