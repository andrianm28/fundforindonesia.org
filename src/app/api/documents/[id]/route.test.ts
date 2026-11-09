// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/documents', async () => {
  const actual = await vi.importActual<typeof import('@/lib/documents')>('@/lib/documents');
  return { ...actual, readDocument: vi.fn() };
});

import { getServerSession } from '@/lib/auth';
import { readDocument } from '@/lib/documents';
import { GET } from './route';

const call = () => GET(new NextRequest('http://localhost/api/documents/d1'), { params: Promise.resolve({ id: 'd1' }) });

describe('GET /api/documents/[id]', () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1', assignments: [] } } as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('answers 500, with no document bytes, when the stored file fails its integrity check', async () => {
    vi.mocked(readDocument).mockRejectedValue(new Error('Stored document failed verification'));
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('verification');
  });

  it('streams the decrypted bytes with the private headers', async () => {
    vi.mocked(readDocument).mockResolvedValue({ id: 'd1', contentType: 'application/pdf', bytes: Buffer.from('%PDF-1') });
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store, private');
    expect(await response.text()).toBe('%PDF-1');
  });
});
