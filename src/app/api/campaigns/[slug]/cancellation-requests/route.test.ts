import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { campaignRow, makeCampaignDb } from '../../../../../../tests/support/in-memory-campaign-db';

/**
 * End to end through the real handler and the real lifecycle module, with
 * the session and the database stood in. The HTTP handling (401, body
 * parsing, unknown slug, refusals, 500) is the lifecycle adapter's and is
 * tested in src/lib/lifecycle-route.test.ts; the rules are
 * requestCancellation's, tested in campaign-lifecycle.cancellation.test.ts.
 * This file proves only that the request reaches requestCancellation with
 * the right input and status.
 */
const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof makeCampaignDb> }));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    { get: (_target, key) => (state.db.prisma as Record<string | symbol, unknown>)[key] },
  ),
}));

import { POST } from './route';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;

describe('POST /api/campaigns/[slug]/cancellation-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'creator-1', role: 'CAMPAIGN_CREATOR', assignments: [] } });
    state.db = makeCampaignDb({ campaigns: [campaignRow({ lifecycleStatus: 'ACTIVE' })] });
  });

  it('records a PENDING request with the reason, answering 201 with the Campaign state and the request', async () => {
    const slug = 'bantu-korban-banjir';
    const req = new NextRequest(`http://localhost:3000/api/campaigns/${slug}/cancellation-requests`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Pasien sudah sembuh.' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(req, { params: Promise.resolve({ slug }) });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      campaign: { id: 'campaign-1', slug, lifecycleStatus: 'ACTIVE', isUrgent: false },
      cancellationRequest: expect.objectContaining({
        campaignId: 'campaign-1',
        requestedById: 'creator-1',
        reason: 'Pasien sudah sembuh.',
        status: 'PENDING',
      }),
    });
  });
});
