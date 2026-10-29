import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { guardRoute } from '@/lib/rate-limit-guard';
import { DocumentRefusedError, MAX_DOCUMENT_SIZE, uploadDocument, type DocumentTarget } from '@/lib/documents';

/** Documents per account per hour. */
const DOCUMENT_UPLOAD_LIMIT = 30;
const DOCUMENT_UPLOAD_WINDOW_SECONDS = 60 * 60;

/**
 * Uploads one private document (ticket 64): multipart with `file` and either
 * `campaignId` + `checklistItemId` (the Campaign's Fundraiser, for a §7.1
 * item) or `partnerOrganisationId` + `label` (a Verifier or Admin, for an
 * organisation's legal document). Answers the stored document's summary; there
 * is no URL to answer with, because the only way to read it is
 * GET /api/documents/[id] under the ACL.
 *
 * Never /api/upload: that writes into public/uploads, where every file is a
 * public URL.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const refused = await guardRoute(
    {
      scope: 'document-upload',
      subject: session.user.id,
      limit: DOCUMENT_UPLOAD_LIMIT,
      windowSeconds: DOCUMENT_UPLOAD_WINDOW_SECONDS,
      onUnavailable: 'open',
    },
    { limited: 'Terlalu banyak unggahan dokumen. Coba lagi nanti.' },
  );
  if (refused) return refused;

  // Refuse an oversized body before parsing it, when the client says how big.
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_DOCUMENT_SIZE + 64 * 1024) {
    return NextResponse.json({ error: 'Ukuran berkas terlalu besar. Maksimal 10MB.' }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Formulir unggah tidak valid.' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Berkas harus diunggah.' }, { status: 400 });
  }

  const campaignId = form.get('campaignId');
  const checklistItemId = form.get('checklistItemId');
  const partnerOrganisationId = form.get('partnerOrganisationId');
  let target: DocumentTarget;
  if (typeof campaignId === 'string' && campaignId && typeof checklistItemId === 'string' && checklistItemId) {
    target = { campaignId, checklistItemId };
  } else if (typeof partnerOrganisationId === 'string' && partnerOrganisationId && !campaignId) {
    const label = form.get('label');
    target = { partnerOrganisationId, label: typeof label === 'string' ? label : '' };
  } else {
    return NextResponse.json(
      { error: 'Sebutkan Campaign dan jenis dokumen, atau Lembaga Mitra.' },
      { status: 400 },
    );
  }

  try {
    if (file.size > MAX_DOCUMENT_SIZE) {
      throw new DocumentRefusedError('Ukuran berkas terlalu besar. Maksimal 10MB.', 413);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const document = await uploadDocument(prisma, {
      actor: { id: session.user.id, assignments: session.user.assignments },
      file: { bytes, declaredType: file.type, size: bytes.byteLength },
      target,
    });
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    if (error instanceof DocumentRefusedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Document upload failed:', error);
    return NextResponse.json({ error: 'Gagal mengunggah dokumen.' }, { status: 500 });
  }
}
