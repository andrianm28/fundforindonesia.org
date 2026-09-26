import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  cancellationRequestRow,
  makeCampaignDb,
} from '../../../../../../../tests/support/in-memory-campaign-db';

/**
 * Both decision routes, end to end through the real handlers and the real
 * lifecycle module, with the session and the database stood in. The HTTP
 * handling (401, body parsing, unknown slug, refusals, 500) is the
 * lifecycle adapter's and is tested in src/lib/lifecycle-route.test.ts; the
 * rules are decideCancellation's, tested in
 * campaign-lifecycle.cancellation.test.ts. This file proves only that each
 * route reaches decideCancellation with its decision, the request named in
 * the path, the reason and status 200.
 */
const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof makeCampaignDb> }));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    { get: (_target, key) => (state.db.prisma as Record<string | symbol, unknown>)[key] },
  ),
}));

import { POST as approve } from './approve/route';
import { POST as reject } from './reject/route';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;

const ADMIN = { user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } };
const ROUTES = { approve, reject };
const SLUG = 'bantu-korban-banjir';

function call(decision: keyof typeof ROUTES, body: unknown, id = 'request-2'): Promise<Response> {
  const req = new NextRequest(
    `http://localhost:3000/api/campaigns/${SLUG}/cancellation-requests/${id}/${decision}`,
    { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
  );
  return ROUTES[decision](req, { params: Promise.resolve({ slug: SLUG, id }) });
}

describe('POST /api/campaigns/[slug]/cancellation-requests/[id]/approve and reject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue(ADMIN);
    state.db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'ACTIVE' })],
      // Only request-2 is PENDING, so reaching it proves the path's id was used.
      cancellationRequests: [
        cancellationRequestRow({ status: 'REJECTED' }),
        cancellationRequestRow({ id: 'request-2' }),
      ],
    });
  });

  it('approve cancels the Campaign and approves the request named in the path, with the reason', async () => {
    const response = await call('approve', { reason: 'Dana belum dicairkan.' });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.campaign).toMatchObject({ lifecycleStatus: 'CANCELLED' });
    expect(body.cancellationRequest).toMatchObject({
      id: 'request-2', status: 'APPROVED', decidedById: 'admin-1', decisionReason: 'Dana belum dicairkan.',
    });
  });

  it('reject rejects the request named in the path, with the reason, leaving the Campaign Active', async () => {
    const response = await call('reject', { reason: 'Masih ada Donor aktif.' });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.campaign).toMatchObject({ lifecycleStatus: 'ACTIVE' });
    expect(body.cancellationRequest).toMatchObject({
      id: 'request-2', status: 'REJECTED', decidedById: 'admin-1', decisionReason: 'Masih ada Donor aktif.',
    });
  });

  it.each(['approve', 'reject'] as const)(
    "%s answers a missing Admin assignment with the command's Indonesian refusal, not a bare Forbidden",
    async (decision) => {
      mockSession.mockResolvedValue({ user: { id: 'admin-9', role: 'ADMIN', assignments: [] } });

      const response = await call(decision, { reason: 'Alasan.' });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: 'Hanya Admin yang dapat memutuskan pengajuan Cancellation.',
        code: 'NOT_AUTHORIZED',
      });
      expect(state.db.cancellationRequest('request-2').status).toBe('PENDING');
    },
  );
});
