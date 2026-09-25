import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  makeCampaignDb,
  type StatusChangeRow,
} from '../../../../../../tests/support/in-memory-campaign-db';

/**
 * End to end through the real handlers and the real lifecycle module, with
 * the session and the database stood in. The HTTP handling (401, body
 * parsing, unknown slug, refusals, 500) is the lifecycle adapter's and is
 * tested in src/lib/lifecycle-route.test.ts; the rules are suspendCampaign's
 * and liftSuspension's, tested in campaign-lifecycle.suspension.test.ts and
 * campaign-lifecycle.flags.test.ts. This file proves only that each method
 * reaches its command with the right input and status.
 */
const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof makeCampaignDb> }));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    { get: (_target, key) => (state.db.prisma as Record<string | symbol, unknown>)[key] },
  ),
}));

import { POST, DELETE } from './route';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;

const SLUG = 'bantu-korban-banjir';
const FUTURE = new Date('2099-12-31T00:00:00Z');

function session(id: string) {
  return { user: { id, role: 'ADMIN', assignments: ['ADMIN'] } };
}

function suspensionRow(): StatusChangeRow {
  return {
    id: 'suspension-1', campaignId: 'campaign-1', action: 'SUSPENDED', fromStatus: 'ACTIVE', toStatus: 'SUSPENDED',
    actorId: 'admin-a', capacity: 'ADMIN', reason: 'Laporan penipuan', createdAt: new Date('2026-09-21T00:00:00Z'),
  };
}

function call(handler: typeof POST, method: 'POST' | 'DELETE', body: unknown): Promise<Response> {
  const req = new NextRequest(`http://localhost:3000/api/campaigns/${SLUG}/suspension`, {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return handler(req, { params: Promise.resolve({ slug: SLUG }) });
}

describe('POST /api/campaigns/[slug]/suspension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue(session('admin-a'));
    state.db = makeCampaignDb({
      campaigns: [campaignRow({ status: 'active', lifecycleStatus: 'ACTIVE', deadline: FUTURE })],
    });
  });

  it('suspends the Campaign with the reason, answering 200 with its new state', async () => {
    const response = await call(POST, 'POST', { reason: 'Penipuan terverifikasi' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      campaign: { id: 'campaign-1', slug: SLUG, lifecycleStatus: 'SUSPENDED', isUrgent: false },
    });
    expect(state.db.statusChanges).toEqual([
      expect.objectContaining({ action: 'SUSPENDED', actorId: 'admin-a', capacity: 'ADMIN', reason: 'Penipuan terverifikasi' }),
    ]);
  });
});

describe('DELETE /api/campaigns/[slug]/suspension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue(session('admin-b'));
    state.db = makeCampaignDb({
      campaigns: [campaignRow({ status: 'suspended', lifecycleStatus: 'SUSPENDED', deadline: FUTURE })],
      statusChanges: [suspensionRow()],
    });
  });

  it('lifts the Suspension with the reason, answering 200 with its new state', async () => {
    const response = await call(DELETE, 'DELETE', { reason: 'Klarifikasi diterima' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      campaign: { id: 'campaign-1', slug: SLUG, lifecycleStatus: 'ACTIVE', isUrgent: false },
    });
    expect(state.db.statusChanges[1]).toMatchObject({
      action: 'SUSPENSION_LIFTED', actorId: 'admin-b', capacity: 'ADMIN', reason: 'Klarifikasi diterima',
    });
  });
});
