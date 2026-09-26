import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  makeCampaignDb,
} from '../../../../../../tests/support/in-memory-campaign-db';

/**
 * End to end through the real handler and the real lifecycle module, with
 * the session and the database stood in. The HTTP handling (401, body
 * parsing, unknown slug, refusals, 500) is the lifecycle adapter's and is
 * tested in src/lib/lifecycle-route.test.ts; the rules are
 * completeCampaign's, tested in campaign-lifecycle.complete.test.ts. This
 * file proves only that the request reaches completeCampaign with the right
 * input and status.
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

const OWNER = { user: { id: 'creator-1', assignments: [] } };
const ADMIN = { user: { id: 'admin-1', assignments: ['ADMIN'] } };
const REASON = 'Program selesai dan laporan akhir sudah terbit.';

function post(body?: unknown): Promise<Response> {
  const slug = 'bantu-korban-banjir';
  const req = new NextRequest(`http://localhost:3000/api/campaigns/${slug}/complete`, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
  return POST(req, { params: Promise.resolve({ slug }) });
}

describe('POST /api/campaigns/[slug]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'ACTIVE' })],
      campaignUpdates: [{ id: 'update-1', campaignId: 'campaign-1' }],
    });
  });

  it('completes the Campaign for its owner without a body, answering 200 with its new state', async () => {
    mockSession.mockResolvedValue(OWNER);

    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      campaign: { id: 'campaign-1', slug: 'bantu-korban-banjir', lifecycleStatus: 'COMPLETED', isUrgent: false },
    });
    expect(state.db.statusChanges).toEqual([
      expect.objectContaining({ action: 'COMPLETED', actorId: 'creator-1', capacity: 'FUNDRAISER', reason: null }),
    ]);
  });

  it("passes an Admin's reason to the command", async () => {
    mockSession.mockResolvedValue(ADMIN);

    const response = await post({ reason: REASON });

    expect(response.status).toBe(200);
    expect(state.db.statusChanges).toEqual([
      expect.objectContaining({ action: 'COMPLETED', actorId: 'admin-1', capacity: 'ADMIN', reason: REASON }),
    ]);
  });
});
