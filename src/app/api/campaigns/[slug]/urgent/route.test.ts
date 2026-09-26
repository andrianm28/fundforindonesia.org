import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  makeCampaignDb,
  type CampaignRow,
} from '../../../../../../tests/support/in-memory-campaign-db';

/**
 * End to end through the real handler and the real lifecycle module, with
 * the session and the database stood in. The HTTP handling (401, body
 * parsing, unknown slug, refusals, 500) is the lifecycle adapter's and is
 * tested in src/lib/lifecycle-route.test.ts; the rules are setUrgent's,
 * tested in campaign-lifecycle.urgent.test.ts. This file proves that the
 * request reaches setUrgent with the right input and status, plus the
 * route's own validation of `urgent`.
 */
const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof makeCampaignDb> }));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    { get: (_target, key) => (state.db.prisma as Record<string | symbol, unknown>)[key] },
  ),
}));

import { PUT } from './route';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;

const ADMIN = { user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } };
const SLUG = 'bantu-korban-banjir';
const REASON = 'Korban banjir bertambah, butuh bantuan segera';

function seed(overrides: Partial<CampaignRow> = {}) {
  state.db = makeCampaignDb({
    campaigns: [campaignRow({ lifecycleStatus: 'ACTIVE', ...overrides })],
  });
}

function put(body: unknown): Promise<Response> {
  const req = new NextRequest(`http://localhost:3000/api/campaigns/${SLUG}/urgent`, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return PUT(req, { params: Promise.resolve({ slug: SLUG }) });
}

describe('PUT /api/campaigns/[slug]/urgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue(ADMIN);
    seed();
  });

  it('sets Urgent with the reason, answering 200 with the Campaign state', async () => {
    const response = await put({ urgent: true, reason: REASON });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      campaign: { id: 'campaign-1', slug: SLUG, lifecycleStatus: 'ACTIVE', isUrgent: true },
    });
    expect(state.db.statusChanges).toEqual([
      expect.objectContaining({ action: 'URGENT_SET', actorId: 'admin-1', capacity: 'ADMIN', reason: REASON }),
    ]);
  });

  it('passes urgent: false through, clearing Urgent', async () => {
    seed({ isUrgent: true });

    const response = await put({ urgent: false, reason: 'Kebutuhan sudah terpenuhi' });

    expect(response.status).toBe(200);
    expect(state.db.statusChanges).toEqual([
      expect.objectContaining({ action: 'URGENT_CLEARED', reason: 'Kebutuhan sudah terpenuhi' }),
    ]);
  });

  it("answers a missing Admin assignment with the command's Indonesian refusal, not a bare Forbidden", async () => {
    mockSession.mockResolvedValue({ user: { id: 'verifier-1', role: 'MODERATOR', assignments: ['VERIFIER'] } });

    const response = await put({ urgent: true, reason: REASON });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Hanya Admin yang dapat memasang atau melepas Urgent.',
      code: 'NOT_AUTHORIZED',
    });
    expect(state.db.statusChanges).toEqual([]);
  });

  it.each([
    ['a missing urgent', { reason: REASON }],
    ['a non-boolean urgent', { urgent: 'true', reason: REASON }],
    ['a body that is not an object', ['urgent']],
  ])('answers 400 on the urgent field to %s and changes nothing', async (_what, body) => {
    const response = await put(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Kolom urgent wajib diisi true atau false.', code: 'VALIDATION' });
    expect(state.db.campaign().isUrgent).toBe(false);
    expect(state.db.statusChanges).toEqual([]);
  });
});
