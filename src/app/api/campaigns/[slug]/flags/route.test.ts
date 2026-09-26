import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignFlagRow,
  campaignRow,
  makeCampaignDb,
} from '../../../../../../tests/support/in-memory-campaign-db';

/**
 * End to end through the real handlers and the real lifecycle module, with
 * the session and the database stood in. The HTTP handling (401, body
 * parsing, unknown slug, refusals, 500) is the lifecycle adapter's and is
 * tested in src/lib/lifecycle-route.test.ts; the rules are flagCampaign's
 * and dismissFlag's, tested in campaign-lifecycle.flags.test.ts. This file
 * proves only that each request reaches its command with the right input
 * and status.
 */
const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof makeCampaignDb> }));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    { get: (_target, key) => (state.db.prisma as Record<string | symbol, unknown>)[key] },
  ),
}));

import { POST as FLAG } from './route';
import { POST as DISMISS } from './[id]/dismiss/route';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;

const SLUG = 'bantu-korban-banjir';
const FUTURE = new Date('2099-12-31T00:00:00Z');

function request(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/campaigns/${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function activeCampaign() {
  return campaignRow({ lifecycleStatus: 'ACTIVE', deadline: FUTURE });
}

describe('POST /api/campaigns/[slug]/flags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'verifier-1', assignments: ['VERIFIER'] } });
    state.db = makeCampaignDb({ campaigns: [activeCampaign()] });
  });

  it('raises a Flag with the reason, answering 201 with the Campaign state and the open Flag', async () => {
    const response = await FLAG(request(`${SLUG}/flags`, { reason: 'Foto palsu' }), {
      params: Promise.resolve({ slug: SLUG }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      campaign: { id: 'campaign-1', slug: SLUG, lifecycleStatus: 'ACTIVE', isUrgent: false },
      flag: expect.objectContaining({ campaignId: 'campaign-1', verifierId: 'verifier-1', reason: 'Foto palsu', resolution: null }),
    });
  });
});

describe('POST /api/campaigns/[slug]/flags/[id]/dismiss', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-a', assignments: ['ADMIN'] } });
    state.db = makeCampaignDb({
      campaigns: [activeCampaign()],
      campaignFlags: [campaignFlagRow(), campaignFlagRow({ id: 'flag-2' })],
    });
  });

  it('dismisses the Flag named in the path with the reason, answering 200', async () => {
    const response = await DISMISS(request(`${SLUG}/flags/flag-2/dismiss`, { reason: 'Sudah diklarifikasi' }), {
      params: Promise.resolve({ slug: SLUG, id: 'flag-2' }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).flag).toMatchObject({
      id: 'flag-2', resolution: 'DISMISSED', resolvedById: 'admin-a', resolutionReason: 'Sudah diklarifikasi',
    });
    expect(state.db.campaignFlag('flag-1').resolution).toBeNull();
  });
});
