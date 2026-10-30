import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { documentExtension, readDocument } from '@/lib/documents';

/**
 * Streams one private document to someone allowed to open it (ticket 64; who
 * that is lives in canReadDocument). Every refusal, a missing document and a
 * missing file alike, is the same 404, so the answer never confirms that a
 * document exists. Signed out is 401.
 *
 * The response is never cached anywhere (`no-store`), is named after the
 * document id rather than anything the uploader typed, is never
 * content-sniffed, and runs no script: the bytes were checked to be a PDF or
 * an image on the way in, and the headers keep it that way on the way out.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  let found: Awaited<ReturnType<typeof readDocument>>;
  try {
    found = await readDocument(prisma, {
      documentId: id,
      viewer: { id: session.user.id, assignments: session.user.assignments },
    });
  } catch (error) {
    console.error('Document read failed:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
  if (!found) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(found.bytes), {
    status: 200,
    headers: {
      'Content-Type': found.contentType,
      'Content-Length': String(found.bytes.byteLength),
      'Content-Disposition': `inline; filename="dokumen-${found.id}.${documentExtension(found.contentType)}"`,
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'",
      'Referrer-Policy': 'no-referrer',
    },
  });
}
