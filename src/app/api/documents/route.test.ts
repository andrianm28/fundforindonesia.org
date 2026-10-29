// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/rate-limit-guard', () => ({ guardRoute: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/documents', async () => {
  const actual = await vi.importActual<typeof import('@/lib/documents')>('@/lib/documents');
  return { ...actual, uploadDocument: vi.fn(), readDocument: vi.fn() };
});

import { POST } from './route';
import { GET } from './[id]/route';
import { getServerSession } from '@/lib/auth';
import { guardRoute } from '@/lib/rate-limit-guard';
import { DocumentRefusedError, readDocument, uploadDocument } from '@/lib/documents';

const session = vi.mocked(getServerSession);
const guard = vi.mocked(guardRoute);
const upload = vi.mocked(uploadDocument);
const read = vi.mocked(readDocument);

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

function postWith(fields: Record<string, string>, file: File | null = new File([PDF], 'ktp.pdf', { type: 'application/pdf' })) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (file) form.append('file', file);
  return new NextRequest('http://localhost/api/documents', { method: 'POST', body: form });
}

const getOne = (id: string) =>
  GET(new NextRequest(`http://localhost/api/documents/${id}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue(null);
  session.mockResolvedValue({ user: { id: 'u1', assignments: [] }, expires: '2099-01-01' } as never);
});

describe('POST /api/documents (ticket 64)', () => {
  it('refuses a signed-out caller with 401 before reading the body', async () => {
    session.mockResolvedValue(null);

    const res = await POST(postWith({ campaignId: 'c1', checklistItemId: 'i1' }));

    expect(res.status).toBe(401);
    expect(upload).not.toHaveBeenCalled();
  });

  it('returns the rate limiter refusal, scoped to the account', async () => {
    guard.mockResolvedValue(NextResponse.json({ error: 'x' }, { status: 429 }));

    const res = await POST(postWith({ campaignId: 'c1', checklistItemId: 'i1' }));

    expect(res.status).toBe(429);
    expect(guard.mock.calls[0][0]).toMatchObject({ scope: 'document-upload', subject: 'u1' });
  });

  it('stores a Campaign document for the session user and answers its summary, with no URL', async () => {
    upload.mockResolvedValue({ id: 'd1', label: 'KTP', checklistItemId: 'i1', contentType: 'application/pdf', sizeBytes: 6, uploadedAt: new Date() });

    const res = await POST(postWith({ campaignId: 'c1', checklistItemId: 'i1' }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.document).toMatchObject({ id: 'd1' });
    expect(JSON.stringify(body)).not.toMatch(/url|storagePath|uploads/i);
    expect(upload.mock.calls[0][1]).toMatchObject({
      actor: { id: 'u1' },
      file: { declaredType: 'application/pdf', size: PDF.length },
      target: { campaignId: 'c1', checklistItemId: 'i1' },
    });
  });

  it("passes an organisation document's title through", async () => {
    upload.mockResolvedValue({ id: 'd2' } as never);

    await POST(postWith({ partnerOrganisationId: 'org1', label: 'Akta' }));

    expect(upload.mock.calls[0][1].target).toEqual({ partnerOrganisationId: 'org1', label: 'Akta' });
  });

  it('refuses a body that names no target, or no file, with 400', async () => {
    expect((await POST(postWith({}))).status).toBe(400);
    expect((await POST(postWith({ campaignId: 'c1' }))).status).toBe(400);
    expect((await POST(postWith({ campaignId: 'c1', checklistItemId: 'i1' }, null))).status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it("answers the store's refusal with its own status and message", async () => {
    upload.mockRejectedValue(new DocumentRefusedError('Campaign tidak ditemukan.', 404));

    const res = await POST(postWith({ campaignId: 'c1', checklistItemId: 'i1' }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Campaign tidak ditemukan.' });
  });

  it('answers an unexpected failure with a 500 that leaks nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    upload.mockRejectedValue(new Error('EACCES /srv/secret/path'));

    const res = await POST(postWith({ campaignId: 'c1', checklistItemId: 'i1' }));

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('/srv');
  });
});

describe('GET /api/documents/[id] (ticket 64)', () => {
  it('refuses a signed-out caller with 401', async () => {
    session.mockResolvedValue(null);

    expect((await getOne('d1')).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  it('answers 404 for anything the ACL refuses or cannot find', async () => {
    read.mockResolvedValue(null);

    const res = await getOne('d1');

    expect(res.status).toBe(404);
    expect(read.mock.calls[0][1]).toMatchObject({ documentId: 'd1', viewer: { id: 'u1' } });
  });

  it('streams an allowed document uncached, unsniffed, named by its id', async () => {
    read.mockResolvedValue({ id: 'd1', contentType: 'application/pdf', bytes: Buffer.from(PDF) });

    const res = await getOne('d1');

    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Cache-Control')).toBe('no-store, private');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="dokumen-d1.pdf"');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  });
});
