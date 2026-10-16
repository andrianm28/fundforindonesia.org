import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/** ADMIN-only edit of the public pages' content (Pengaturan Laman Publik). */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { siteSetting: { upsert: vi.fn(), findMany: vi.fn() } } }));

import { POST } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { DEFAULT_SITE_SETTINGS } from '@/lib/site-settings';

const mockSession = getServerSession as unknown as Mock;
const mockUpsert = prisma.siteSetting.upsert as unknown as Mock;
const URL = 'http://localhost:3000/api/admin/site-settings';

function post(body: unknown): Promise<Response> {
  return POST(new NextRequest(URL, { method: 'POST', body: JSON.stringify(body) }));
}

describe('POST /api/admin/site-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockUpsert.mockResolvedValue({});
  });

  it('saves a section as the acting Admin', async () => {
    const value = { about: 'Teks baru.' };
    const res = await post({ key: 'footer', value });

    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { key: 'footer' },
      create: { key: 'footer', value, updatedById: 'admin-1' },
      update: { value, updatedById: 'admin-1' },
    });
  });

  it('answers 400 in the Admin\'s language for an invalid value', async () => {
    const res = await post({ key: 'contact', value: { ...DEFAULT_SITE_SETTINGS.contact, email: 'x' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('email');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('answers 400 for an unknown section and for a body that is not an object', async () => {
    expect((await post({ key: 'payment-providers', value: {} })).status).toBe(400);
    expect((await post([1])).status).toBe(400);
  });

  it('answers 404 to a visitor who is not signed in', async () => {
    mockSession.mockResolvedValue(null);
    expect((await post({ key: 'footer', value: { about: 'x' } })).status).toBe(404);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('answers 404 to someone who is not an Admin', async () => {
    mockSession.mockResolvedValue({ user: { id: 'u-1', assignments: [] } });
    const res = await post({ key: 'footer', value: { about: 'x' } });
    expect(res.status).toBe(404);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
