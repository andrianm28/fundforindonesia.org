// @vitest-environment node
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Rate limits on register, guest Donation and upload (ticket rilis-1-benda 58).
 * The limiter itself is csr-06b (src/lib/rate-limit.ts, tested there); this
 * pins that each route consults it, with the right subject, before doing work,
 * and what each does when the limiter is down. Login is in src/lib/auth.test.ts
 * and the email resend in its own route test.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: { campaign: { findUnique: vi.fn() }, user: { findFirst: vi.fn(), create: vi.fn() } },
}));
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/donations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/donations')>('@/lib/donations');
  return { ...actual, donationsEnabled: () => true, sandboxInProductionReason: () => null };
});
vi.mock('@/lib/password-hash', () => ({ hashPassword: vi.fn().mockResolvedValue('hashed') }));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  const mkdir = vi.fn().mockResolvedValue(undefined);
  const writeFile = vi.fn().mockResolvedValue(undefined);
  return { ...actual, default: { ...actual, mkdir, writeFile }, mkdir, writeFile };
});

import { prisma } from '@/lib/prisma';
import { consumeRateLimit } from '@/lib/rate-limit';
import { getServerSession } from '@/lib/auth';
import { writeFile } from 'fs/promises';
import { POST as register } from '@/app/api/auth/register/route';
import { POST as donate } from '@/app/api/donations/route';
import { POST as upload } from '@/app/api/upload/route';

const consume = consumeRateLimit as unknown as Mock;
const session = getServerSession as unknown as Mock;
const campaignFind = prisma.campaign.findUnique as unknown as Mock;
const userFind = prisma.user.findFirst as unknown as Mock;
const mockedWrite = writeFile as unknown as Mock;

const ALLOWED = { allowed: true, count: 1, retryAfterSeconds: 60 };
const LIMITED = { allowed: false, count: 99, retryAfterSeconds: 42 };

function json(url: string, body: unknown, ip = '203.0.113.7'): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  consume.mockResolvedValue(ALLOWED);
  session.mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/auth/register', () => {
  const body = { name: 'A', email: 'a@example.com', password: 'Whatever-123456' };

  it('counts the attempt per client address', async () => {
    userFind.mockResolvedValue({ id: 'existing' });
    await register(json('/api/auth/register', body));
    expect(consume).toHaveBeenCalledWith(prisma, expect.objectContaining({ scope: 'auth-register', subject: '203.0.113.7' }));
  });

  it('answers 429 with Retry-After over the limit and touches no account', async () => {
    consume.mockResolvedValue(LIMITED);
    const res = await register(json('/api/auth/register', body));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(userFind).not.toHaveBeenCalled();
  });

  it('fails open when the limiter is down', async () => {
    consume.mockRejectedValue(new Error('db down'));
    userFind.mockResolvedValue({ id: 'existing' });
    const res = await register(json('/api/auth/register', body));
    expect(res.status).toBe(409);
  });
});

describe('POST /api/donations, guest', () => {
  const body = { campaignId: 'c1', amount: 50_000, paymentMethod: 'qris', isAnonymous: false, guestEmail: 'd@example.com' };
  const activeCampaign = {
    id: 'c1',
    isDemo: false,
    lifecycleStatus: 'ACTIVE',
    title: 't',
    kind: 'DONATION',
    category: 'kesehatan',
    collectingEntity: { permits: [{ kinds: ['DONATION'], validFrom: new Date('2020-01-01T00:00:00Z'), validTo: new Date('2099-12-31T00:00:00Z') }] },
  };

  it('answers 429 over the limit, counted per client address', async () => {
    consume.mockResolvedValue(LIMITED);
    campaignFind.mockResolvedValue(activeCampaign);
    const res = await donate(json('/api/donations', body));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(consume).toHaveBeenCalledWith(prisma, expect.objectContaining({ scope: 'donation-guest', subject: '203.0.113.7' }));
  });

  it('does not count a signed-in Donor', async () => {
    session.mockResolvedValue({ user: { id: 'user-1' } });
    campaignFind.mockResolvedValue(null);
    await donate(json('/api/donations', body));
    expect(consume).not.toHaveBeenCalled();
  });

  it('fails open when the limiter is down', async () => {
    consume.mockRejectedValue(new Error('db down'));
    campaignFind.mockResolvedValue(activeCampaign);
    const res = await donate(json('/api/donations', body));
    expect(res.status).not.toBe(429);
    expect(res.status).not.toBe(503);
  });
});

describe('POST /api/upload', () => {
  function formRequest(): NextRequest {
    const form = new FormData();
    form.append('file', new File(['x'], 'a.png', { type: 'image/png' }));
    return new NextRequest('http://localhost:3000/api/upload', { method: 'POST', body: form });
  }

  it('counts per account and answers 429 over the limit without writing', async () => {
    session.mockResolvedValue({ user: { id: 'user-9' } });
    consume.mockResolvedValue(LIMITED);
    const res = await upload(formRequest());
    expect(res.status).toBe(429);
    expect(consume).toHaveBeenCalledWith(prisma, expect.objectContaining({ scope: 'upload', subject: 'user-9' }));
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('does not count a caller who is not signed in', async () => {
    const res = await upload(formRequest());
    expect(res.status).toBe(401);
    expect(consume).not.toHaveBeenCalled();
  });

  it('fails open when the limiter is down', async () => {
    session.mockResolvedValue({ user: { id: 'user-9' } });
    consume.mockRejectedValue(new Error('db down'));
    const res = await upload(formRequest());
    expect(res.status).toBe(201);
  });
});
