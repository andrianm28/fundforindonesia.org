import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The Admin's payment provider choice (prd-compliance 39). ADMIN only,
 * append-only, and unable to carry a credential or switch on what the
 * deployment cannot charge through.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: { paymentProviderSetting: { create: vi.fn(), findFirst: vi.fn() } },
}));

import { POST } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;
const mockCreate = prisma.paymentProviderSetting.create as unknown as Mock;
const URL = 'http://localhost:3000/api/admin/payment-providers';

function post(body: unknown): Promise<Response> {
  return POST(new NextRequest(URL, { method: 'POST', body: JSON.stringify(body) }));
}

describe('POST /api/admin/payment-providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SUMOPOD_API_KEY', 'k');
    vi.stubEnv('SUMOPOD_WEBHOOK_SECRET', 'whsec_OkjY4nDqKbBxbBRPcHjT5ZvpXeWTm6J2');
    vi.stubEnv('SUMOPOD_BASE_URL', 'https://api-pay.sumopod.com/api/v1');
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockCreate.mockImplementation(async ({ data }) => ({ id: 'setting-1', ...data }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('records the choice as the acting Admin', async () => {
    const res = await post({ provider: 'sumopod', methods: ['qris_redirect'] });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith({
      data: { provider: 'sumopod', methods: ['qris_redirect'], setById: 'admin-1' },
    });
  });

  it('answers 401 with no session, and 403 for anyone who is not an Admin', async () => {
    mockSession.mockResolvedValue(null);
    expect((await post({ provider: 'sumopod', methods: ['qris_redirect'] })).status).toBe(401);

    mockSession.mockResolvedValue({ user: { id: 'verifier-1', assignments: ['VERIFIER'] } });
    expect((await post({ provider: 'sumopod', methods: ['qris_redirect'] })).status).toBe(403);

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses an unknown provider and an unsupported method with 400, writing nothing', async () => {
    expect((await post({ provider: 'midtrans', methods: ['qris_redirect'] })).status).toBe(400);
    expect((await post({ provider: 'sumopod', methods: ['ewallet_redirect'] })).status).toBe(400);
    expect((await post(['not', 'an', 'object'])).status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses with 409 a provider this server has no credentials for', async () => {
    vi.stubEnv('SUMOPOD_API_KEY', '');
    const res = await post({ provider: 'sumopod', methods: ['qris_redirect'] });

    expect(res.status).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('never stores anything but the provider name, methods and the Admin, even if a credential is sent', async () => {
    await post({ provider: 'sumopod', methods: ['qris_redirect'], apiKey: 'sk-live-leak' });

    const data = mockCreate.mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual(['methods', 'provider', 'setById']);
  });
});
