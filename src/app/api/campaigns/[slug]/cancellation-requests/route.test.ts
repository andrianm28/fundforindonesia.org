import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  cancellationRequestRow,
  makeCampaignDb,
  type CampaignRow,
  type CancellationRequestRow,
} from '../../../../../../tests/support/in-memory-campaign-db';

/**
 * End to end through the real handler and the real lifecycle module. Only
 * the session and the database are stood in: the database is the in-memory
 * Prisma stand-in, so assertions are about the rows a request leaves behind.
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

const OWNER = { user: { id: 'creator-1', role: 'CAMPAIGN_CREATOR', assignments: [] } };

function seed(overrides: Partial<CampaignRow> = {}, requests: CancellationRequestRow[] = []) {
  state.db = makeCampaignDb({
    campaigns: [campaignRow({ status: 'active', lifecycleStatus: 'ACTIVE', ...overrides })],
    cancellationRequests: requests,
  });
}

function post(body: unknown, slug = 'bantu-korban-banjir'): Promise<Response> {
  const req = new NextRequest(`http://localhost:3000/api/campaigns/${slug}/cancellation-requests`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return POST(req, { params: Promise.resolve({ slug }) });
}

describe('POST /api/campaigns/[slug]/cancellation-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue(OWNER);
    seed();
  });

  it('records a PENDING request for the owner, answers 201, and the Campaign stays Active', async () => {
    const response = await post({ reason: 'Pasien sudah sembuh.' });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.campaign).toEqual({
      id: 'campaign-1',
      slug: 'bantu-korban-banjir',
      lifecycleStatus: 'ACTIVE',
      isUrgent: false,
    });
    expect(body.cancellationRequest).toMatchObject({
      campaignId: 'campaign-1',
      requestedById: 'creator-1',
      reason: 'Pasien sudah sembuh.',
      status: 'PENDING',
    });
    expect(state.db.cancellationRequests).toEqual([expect.objectContaining({ status: 'PENDING' })]);
    expect(state.db.campaign()).toMatchObject({ status: 'active', lifecycleStatus: 'ACTIVE' });
    expect(state.db.statusChanges).toEqual([]);
  });

  it('answers 401 without a session and records nothing', async () => {
    mockSession.mockResolvedValue(null);

    const response = await post({ reason: 'Alasan.' });

    expect(response.status).toBe(401);
    expect(state.db.cancellationRequests).toEqual([]);
  });

  it.each([
    ['another Fundraiser', { user: { id: 'stranger-1', role: 'CAMPAIGN_CREATOR', assignments: [] } }],
    ['an Admin who does not own it', { user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } }],
  ])('answers 403 to %s and records nothing', async (_label, session) => {
    mockSession.mockResolvedValue(session);

    const response = await post({ reason: 'Alasan.' });

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('NOT_AUTHORIZED');
    expect(state.db.cancellationRequests).toEqual([]);
  });

  it('answers 500, not a refusal, when the database fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.db.prisma.campaign.findUnique = async () => {
      throw new Error('connection reset');
    };

    const response = await post({ reason: 'Alasan.' });

    expect(response.status).toBe(500);
    spy.mockRestore();
  });

  it('answers 404 for an unknown slug', async () => {
    const response = await post({ reason: 'Alasan.' }, 'tidak-ada');

    expect(response.status).toBe(404);
  });

  it.each([
    ['no reason', {}],
    ['a blank reason', { reason: '   ' }],
    ['a reason over 1000 characters', { reason: 'a'.repeat(1001) }],
    ['a body that is not JSON', 'not json'],
  ])('answers 400 to %s and records nothing', async (_label, body) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('VALIDATION');
    expect(state.db.cancellationRequests).toEqual([]);
  });

  it.each([
    ['SUBMITTED', 'pending'],
    ['SUSPENDED', 'suspended'],
    ['COMPLETED', 'completed'],
    ['CANCELLED', 'cancelled'],
  ] as const)('answers 409 for a Campaign that is %s', async (lifecycleStatus, status) => {
    seed({ lifecycleStatus, status });

    const response = await post({ reason: 'Alasan.' });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('INVALID_TRANSITION');
    expect(state.db.cancellationRequests).toEqual([]);
  });

  it('answers 409 for an Active Campaign past its deadline, which is recorded Expired', async () => {
    seed({ deadline: new Date('2020-01-01T00:00:00Z') });

    const response = await post({ reason: 'Alasan.' });

    expect(response.status).toBe(409);
    expect(state.db.campaign().lifecycleStatus).toBe('EXPIRED');
    expect(state.db.cancellationRequests).toEqual([]);
  });

  it('answers 409 while another request is PENDING', async () => {
    seed({}, [cancellationRequestRow()]);

    const response = await post({ reason: 'Lagi.' });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('CANCELLATION_ALREADY_PENDING');
    expect(state.db.cancellationRequests).toHaveLength(1);
  });
});
