import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/rate-limit-guard', () => ({ guardRoute: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    donation: { findMany: vi.fn() },
    campaign: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/contact-fields', async () => {
  const actual = await vi.importActual<typeof import('@/lib/contact-fields')>('@/lib/contact-fields');
  return {
    ...actual,
    readUserEmail: vi.fn(() => 'budi@example.test'),
    readUserPhone: vi.fn(() => '081200000000'),
  };
});

import { GET } from './route';
import { getServerSession } from '@/lib/auth';
import { guardRoute } from '@/lib/rate-limit-guard';
import { prisma } from '@/lib/prisma';

const session = vi.mocked(getServerSession);
const guard = vi.mocked(guardRoute);
const userFind = vi.mocked(prisma.user.findUnique);
const donationFind = vi.mocked(prisma.donation.findMany);
const campaignFind = vi.mocked(prisma.campaign.findMany);

const USER_ROW = {
  id: 'u1',
  name: 'Budi',
  avatar: null,
  emailVerifiedAt: null,
  donationBalance: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  assignments: [{ assignment: 'VERIFIER', assignedAt: new Date('2026-02-01T00:00:00Z') }],
  emailCiphertext: 'x',
  emailKeyId: 'k',
  phoneCiphertext: 'y',
  phoneKeyId: 'k',
};

beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue(null);
  session.mockResolvedValue({ user: { id: 'u1' }, expires: '2099-01-01' } as never);
  userFind.mockResolvedValue(USER_ROW as never);
  donationFind.mockResolvedValue([{ id: 'd1', amount: 50000 }] as never);
  campaignFind.mockResolvedValue([{ id: 'c1', slug: 's', title: 'T' }] as never);
});

describe('GET /api/account/export (audit L5)', () => {
  it('refuses an unauthenticated caller with 401 and reads nothing', async () => {
    session.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(userFind).not.toHaveBeenCalled();
  });

  it('returns the rate limiter refusal untouched', async () => {
    guard.mockResolvedValue(NextResponse.json({ error: 'x' }, { status: 429 }));

    const res = await GET();

    expect(res.status).toBe(429);
    expect(userFind).not.toHaveBeenCalled();
    expect(guard.mock.calls[0][0]).toMatchObject({ scope: 'account-export', subject: 'u1' });
  });

  it('downloads the signed-in user data as JSON with a decrypted profile', async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="data-saya-.*\.json"$/);
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/);
    const body = await res.json();
    expect(body.profil).toMatchObject({ id: 'u1', name: 'Budi', email: 'budi@example.test', phone: '081200000000' });
    expect(body.donasi).toEqual([{ id: 'd1', amount: 50000 }]);
    expect(body.kampanye).toEqual([{ id: 'c1', slug: 's', title: 'T' }]);
    expect(body.penugasan).toEqual([{ assignment: 'VERIFIER', assignedAt: '2026-02-01T00:00:00.000Z' }]);
  });

  it('scopes every query to the session user, never a request value', async () => {
    await GET();

    expect(userFind.mock.calls[0][0]).toMatchObject({ where: { id: 'u1' } });
    expect(donationFind.mock.calls[0][0]).toMatchObject({ where: { donorId: 'u1' } });
    expect(campaignFind.mock.calls[0][0]).toMatchObject({ where: { creatorId: 'u1' } });
  });

  it('leaks no password hash, ciphertext, key id or HMAC', async () => {
    const res = await GET();
    const text = JSON.stringify(await res.json());

    for (const forbidden of ['password', 'Ciphertext', 'KeyId', 'Hmac']) {
      expect(text).not.toContain(forbidden);
    }
    const selects = [userFind, donationFind, campaignFind].map((m) => JSON.stringify(m.mock.calls[0][0]));
    expect(selects[0]).not.toMatch(/"password"/);
    expect(selects[1]).not.toMatch(/guest|Hmac|Ciphertext/);
  });

  it('answers 404 when the session user no longer exists', async () => {
    userFind.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(404);
  });
});
