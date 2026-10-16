import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { UPLOAD_DIR, uploadContentType } from '@/lib/uploads';

/**
 * Serves uploaded images from the uploads volume.
 *
 * Next's production server lists public/ once, at startup (setupFsCheck), and
 * serves only what it found then. Uploads are written to public/uploads while
 * the server runs, so every cover uploaded after the container started
 * answered 404 until the next restart (UAT Beta produksi 2026-10-16). Files
 * present at startup are still served by Next's static handler first; this
 * route answers for the rest.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  const contentType = uploadContentType(name);
  if (!contentType) return notFound();

  let body: Buffer;
  try {
    body = await readFile(join(UPLOAD_DIR, name));
  } catch {
    return notFound();
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(body.length),
      'X-Content-Type-Options': 'nosniff',
      // The name is unique per upload and never rewritten.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

function notFound() {
  return new NextResponse('Not found', { status: 404 });
}
