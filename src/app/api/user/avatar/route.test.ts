// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    default: { ...actual, mkdir: (...a: unknown[]) => mockMkdir(...a), writeFile: (...a: unknown[]) => mockWriteFile(...a) },
    mkdir: (...a: unknown[]) => mockMkdir(...a),
    writeFile: (...a: unknown[]) => mockWriteFile(...a),
  };
});

let mockSession: { user: { id: string } } | null = { user: { id: 'u1' } };
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn(async () => mockSession) }));

const mockUserUpdate = vi.fn().mockResolvedValue({});
vi.mock('@/lib/prisma', () => ({ prisma: { user: { update: (...a: unknown[]) => mockUserUpdate(...a) } } }));

const mockGuard = vi.fn();
vi.mock('@/lib/rate-limit-guard', () => ({ guardRoute: (...a: unknown[]) => mockGuard(...a) }));

import { POST } from './route';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];

function req(content: BlobPart, type: string): NextRequest {
  const fd = new FormData();
  fd.append('file', new File([content], 'a', { type }));
  return new NextRequest('http://localhost:3000/api/user/avatar', { method: 'POST', body: fd });
}

describe('POST /api/user/avatar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = { user: { id: 'u1' } };
    mockGuard.mockResolvedValue(null);
  });

  it('stores a real PNG and updates the avatar', async () => {
    const res = await POST(req(new Uint8Array(PNG), 'image/png'));
    expect(res.status).toBe(200);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate).toHaveBeenCalled();
  });

  it('rejects SVG content declared as image/png with 415', async () => {
    const res = await POST(req('<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/png'));
    expect(res.status).toBe(415);
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('rejects a declared type that does not match the bytes', async () => {
    const res = await POST(req(new Uint8Array(PNG), 'image/jpeg'));
    expect(res.status).toBe(415);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('rejects image/svg+xml with 400', async () => {
    const res = await POST(req('<svg/>', 'image/svg+xml'));
    expect(res.status).toBe(400);
  });

  it('is rate limited per account and writes nothing when limited', async () => {
    mockGuard.mockResolvedValue(NextResponse.json({ error: 'x' }, { status: 429 }));
    const res = await POST(req(new Uint8Array(PNG), 'image/png'));
    expect(res.status).toBe(429);
    expect(mockGuard.mock.calls[0][0]).toMatchObject({ scope: 'avatar', subject: 'u1', onUnavailable: 'open' });
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('returns 401 without a session and does not consume the limiter', async () => {
    mockSession = null;
    const res = await POST(req(new Uint8Array(PNG), 'image/png'));
    expect(res.status).toBe(401);
    expect(mockGuard).not.toHaveBeenCalled();
  });
});
