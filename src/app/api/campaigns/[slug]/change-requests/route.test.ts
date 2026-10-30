import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  checklistItemRow,
  makeCampaignDb,
} from '../../../../../../tests/support/in-memory-campaign-db';

/**
 * Through the real handler and the real requestCampaignChange, session and
 * database stood in (ticket 72). The rules are the command's, tested in
 * campaign-lifecycle.change-request.test.ts; this proves the request reaches
 * it with the proposed values, answering 201.
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

function post(body?: unknown): Promise<Response> {
  const slug = 'bantu-korban-banjir';
  const req = new NextRequest(`http://localhost:3000/api/campaigns/${slug}/change-requests`, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
  return POST(req, { params: Promise.resolve({ slug }) });
}

describe('POST /api/campaigns/[slug]/change-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.db = makeCampaignDb({
      campaigns: [
        campaignRow({ lifecycleStatus: 'ACTIVE', deadline: new Date('2099-12-31T00:00:00Z'), targetAmount: 50_000_000 }),
      ],
      checklistItems: [checklistItemRow({ id: 'rencana-anggaran', label: 'Rencana anggaran', position: 1 })],
    });
  });

  it('opens a change request for the owner and answers 201, leaving the Campaign untouched', async () => {
    mockSession.mockResolvedValue({ user: { id: 'creator-1', assignments: [] } });

    const response = await post({ targetAmount: 75_000_000 });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.verificationRequest.proposedChanges).toEqual({ targetAmount: 75_000_000 });
    expect(state.db.campaigns[0].targetAmount).toBe(50_000_000);
  });

  it('refuses a second change while one waits, with the domain code', async () => {
    mockSession.mockResolvedValue({ user: { id: 'creator-1', assignments: [] } });
    await post({ targetAmount: 75_000_000 });

    const response = await post({ targetAmount: 80_000_000 });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('CHANGE_REQUEST_ALREADY_PENDING');
  });

  it('refuses someone who does not own the Campaign', async () => {
    mockSession.mockResolvedValue({ user: { id: 'stranger', assignments: [] } });

    const response = await post({ targetAmount: 75_000_000 });

    expect(response.status).toBe(403);
  });

  it('answers 401 when signed out', async () => {
    mockSession.mockResolvedValue(null);
    expect((await post({ targetAmount: 1 })).status).toBe(401);
  });
});
