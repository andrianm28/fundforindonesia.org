import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { campaignRow, makeCampaignDb } from '../../../../../../tests/support/in-memory-campaign-db';

/**
 * End to end through the real handler and the real lifecycle module, with
 * the session and the database stood in. The HTTP handling (401, body
 * parsing, refusals, 500) is the lifecycle adapter's and is tested in
 * src/lib/lifecycle-route.test.ts; the rules are decideSubmission's, tested
 * in campaign-lifecycle.test.ts. This file proves that the request reaches
 * decideSubmission with the Campaign id from the path and the decision,
 * plus the route's own validation of `action`.
 */
const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof makeCampaignDb> }));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    { get: (_target, key) => (state.db.prisma as Record<string | symbol, unknown>)[key] },
  ),
}));

import { PATCH } from './route';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;

const VERIFIER = { user: { id: 'verifier-1', role: 'MODERATOR', assignments: ['VERIFIER'] } };

function patch(body: unknown): Promise<Response> {
  const req = new NextRequest('http://localhost:3000/api/moderasi/campaigns/campaign-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return PATCH(req, { params: Promise.resolve({ id: 'campaign-1' }) });
}

describe('PATCH /api/moderasi/campaigns/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue(VERIFIER);
    state.db = makeCampaignDb({ campaigns: [campaignRow()] });
  });

  it.each([
    ['approve', 'ACTIVE', 'SUBMISSION_APPROVED'],
    ['reject', 'REJECTED', 'SUBMISSION_REJECTED'],
  ] as const)('%s decides the Submitted Campaign named in the path, answering 200 with its new state', async (action, lifecycleStatus, logged) => {
    const response = await patch({ action });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      campaign: { id: 'campaign-1', slug: 'bantu-korban-banjir', lifecycleStatus, isUrgent: false },
    });
    expect(state.db.statusChanges).toEqual([
      expect.objectContaining({ action: logged, actorId: 'verifier-1', capacity: 'VERIFIER' }),
    ]);
  });

  it("answers a missing Verifier assignment with the command's Indonesian refusal, not a bare Forbidden", async () => {
    mockSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } });

    const response = await patch({ action: 'approve' });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Hanya Verifier yang dapat menyetujui atau menolak Campaign.',
      code: 'NOT_AUTHORIZED',
    });
    expect(state.db.statusChanges).toEqual([]);
  });

  it.each([
    ['suspend, which a Verifier no longer does', { action: 'suspend' }],
    ['a missing action', {}],
    ['an unknown action', { action: 'delete' }],
    ['an inherited object key', { action: 'constructor' }],
  ])('answers 400 on the action field to %s and changes nothing', async (_label, body) => {
    const response = await patch(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Aksi tidak valid. Gunakan approve atau reject.',
      code: 'VALIDATION',
    });
    expect(state.db.campaign().lifecycleStatus).toBe('SUBMITTED');
    expect(state.db.statusChanges).toEqual([]);
  });
});
