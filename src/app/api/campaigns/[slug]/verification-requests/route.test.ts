import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  checklistItemRow,
  makeCampaignDb,
} from '../../../../../../tests/support/in-memory-campaign-db';

/**
 * End to end through the real handler and the real lifecycle module, with
 * the session and the database stood in. The HTTP handling is the lifecycle
 * adapter's (src/lib/lifecycle-route.test.ts) and the rules are
 * submitCampaign's (campaign-lifecycle.submit.test.ts); this file proves the
 * request reaches submitCampaign and answers with its result.
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

function post(): Promise<Response> {
  const slug = 'bantu-korban-banjir';
  const req = new NextRequest(`http://localhost:3000/api/campaigns/${slug}/verification-requests`, {
    method: 'POST',
  });
  return POST(req, { params: Promise.resolve({ slug }) });
}

describe('POST /api/campaigns/[slug]/verification-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'DRAFT' })],
      checklistItems: [checklistItemRow({ id: 'rencana-anggaran', label: 'Rencana anggaran' })],
    });
  });

  it("submits the Fundraiser's Draft, answering 201 with the Submitted Campaign and its PENDING request", async () => {
    mockSession.mockResolvedValue({ user: { id: 'creator-1', assignments: [] } });

    const response = await post();

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.campaign).toEqual({
      id: 'campaign-1',
      slug: 'bantu-korban-banjir',
      lifecycleStatus: 'SUBMITTED',
      isUrgent: false,
    });
    expect(body.verificationRequest).toMatchObject({
      campaignId: 'campaign-1',
      outcome: 'PENDING',
      isFirst: true,
      checklist: [{ id: 'rencana-anggaran', label: 'Rencana anggaran', required: true, position: 1, ticked: false }],
    });
  });

  it("refuses someone who is not the Campaign's Fundraiser with 403 NOT_AUTHORIZED", async () => {
    mockSession.mockResolvedValue({ user: { id: 'stranger-1', assignments: [] } });

    const response = await post();

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'NOT_AUTHORIZED' });
    expect(state.db.verificationRequests).toEqual([]);
  });

  it('refuses a Campaign that is already Submitted with 409', async () => {
    state.db = makeCampaignDb({ campaigns: [campaignRow({ lifecycleStatus: 'SUBMITTED' })] });
    mockSession.mockResolvedValue({ user: { id: 'creator-1', assignments: [] } });

    const response = await post();

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});
