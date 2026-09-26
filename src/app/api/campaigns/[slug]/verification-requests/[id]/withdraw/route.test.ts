import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  makeCampaignDb,
  verificationRequestRow,
} from '../../../../../../../../tests/support/in-memory-campaign-db';

/**
 * End to end through the real handler and the real lifecycle module, with
 * the session and the database stood in. The rules are
 * withdrawVerificationRequest's (campaign-lifecycle.withdraw.test.ts); this
 * file proves the request reaches it, addressed by slug and request id, and
 * answers with its result.
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

function withdraw(id = 'verification-open'): Promise<Response> {
  const slug = 'bantu-korban-banjir';
  const req = new NextRequest(
    `http://localhost:3000/api/campaigns/${slug}/verification-requests/${id}/withdraw`,
    { method: 'POST' },
  );
  return POST(req, { params: Promise.resolve({ slug, id }) });
}

describe('POST /api/campaigns/[slug]/verification-requests/[id]/withdraw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'SUBMITTED' })],
      verificationRequests: [verificationRequestRow({ id: 'verification-open', isFirst: true })],
    });
  });

  it("withdraws the Fundraiser's pending request, answering 200 with the Draft Campaign and the WITHDRAWN request", async () => {
    mockSession.mockResolvedValue({ user: { id: 'creator-1', assignments: [] } });

    const response = await withdraw();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.campaign).toEqual({
      id: 'campaign-1',
      slug: 'bantu-korban-banjir',
      lifecycleStatus: 'DRAFT',
      isUrgent: false,
    });
    expect(body.verificationRequest).toMatchObject({
      id: 'verification-open',
      outcome: 'WITHDRAWN',
      decidedById: 'creator-1',
    });
  });

  it("refuses someone who is not the Campaign's Fundraiser with 403 NOT_AUTHORIZED", async () => {
    mockSession.mockResolvedValue({ user: { id: 'stranger-1', assignments: [] } });

    const response = await withdraw();

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'NOT_AUTHORIZED' });
    expect(state.db.verificationRequests[0].outcome).toBe('PENDING');
  });

  it('refuses a request already decided with 409', async () => {
    state.db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'ACTIVE' })],
      verificationRequests: [
        verificationRequestRow({ id: 'verification-open', outcome: 'APPROVED', decidedById: 'verifier-1' }),
      ],
    });
    mockSession.mockResolvedValue({ user: { id: 'creator-1', assignments: [] } });

    const response = await withdraw();

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'VERIFICATION_REQUEST_NOT_PENDING' });
  });

  it('answers 404 for a request that does not exist', async () => {
    mockSession.mockResolvedValue({ user: { id: 'creator-1', assignments: [] } });

    const response = await withdraw('verification-missing');

    expect(response.status).toBe(404);
  });
});
