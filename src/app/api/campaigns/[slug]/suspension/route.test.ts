import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  makeCampaignDb,
  type CampaignRow,
  type StatusChangeRow,
} from '../../../../../../tests/support/in-memory-campaign-db';

/**
 * End to end through the real handlers and the real lifecycle module. Only
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

import { POST, DELETE } from './route';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;

const SLUG = 'bantu-korban-banjir';
const PAST = new Date('2020-01-01T00:00:00Z');
const FUTURE = new Date('2099-12-31T00:00:00Z');

function session(id: string, assignments: string[]) {
  return { user: { id, role: assignments.includes('ADMIN') ? 'ADMIN' : 'DONOR', assignments } };
}
const ADMIN_A = session('admin-a', ['ADMIN']);
const ADMIN_B = session('admin-b', ['ADMIN']);

function active(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return campaignRow({ status: 'active', lifecycleStatus: 'ACTIVE', deadline: FUTURE, ...overrides });
}

function suspensionRow(fromStatus: StatusChangeRow['fromStatus'], actorId = 'admin-a'): StatusChangeRow {
  return {
    id: 'suspension-1', campaignId: 'campaign-1', action: 'SUSPENDED', fromStatus, toStatus: 'SUSPENDED',
    actorId, capacity: 'ADMIN', reason: 'Laporan penipuan', createdAt: new Date('2026-09-21T00:00:00Z'),
  };
}

function suspended(fromStatus: StatusChangeRow['fromStatus'], overrides: Partial<CampaignRow> = {}) {
  state.db = makeCampaignDb({
    campaigns: [campaignRow({ status: 'suspended', lifecycleStatus: 'SUSPENDED', deadline: FUTURE, ...overrides })],
    statusChanges: [suspensionRow(fromStatus)],
  });
}

function call(
  handler: typeof POST,
  method: 'POST' | 'DELETE',
  body: unknown,
  slug = SLUG,
): Promise<Response> {
  const req = new NextRequest(`http://localhost:3000/api/campaigns/${slug}/suspension`, {
    method,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return handler(req, { params: Promise.resolve({ slug }) });
}

const suspendReq = (body: unknown, slug?: string) => call(POST, 'POST', body, slug);
const liftReq = (body: unknown, slug?: string) => call(DELETE, 'DELETE', body, slug);

describe('POST /api/campaigns/[slug]/suspension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue(ADMIN_A);
    state.db = makeCampaignDb({ campaigns: [active({ isUrgent: true })] });
  });

  it('answers 401 without a session and changes nothing', async () => {
    mockSession.mockResolvedValue(null);

    const response = await suspendReq({ reason: 'Penipuan' });

    expect(response.status).toBe(401);
    expect(state.db.campaign().lifecycleStatus).toBe('ACTIVE');
    expect(state.db.statusChanges).toEqual([]);
  });

  it('suspends an Active Campaign: answers 200 with its state, clears Urgent, logs and notifies with the reason', async () => {
    const response = await suspendReq({ reason: '  Penipuan terverifikasi  ' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      campaign: { id: 'campaign-1', slug: SLUG, lifecycleStatus: 'SUSPENDED', isUrgent: false },
    });
    expect(state.db.campaign()).toMatchObject({ status: 'suspended', lifecycleStatus: 'SUSPENDED', isUrgent: false });
    expect(state.db.statusChanges).toEqual([
      expect.objectContaining({
        action: 'SUSPENDED', fromStatus: 'ACTIVE', toStatus: 'SUSPENDED',
        actorId: 'admin-a', capacity: 'ADMIN', reason: 'Penipuan terverifikasi',
      }),
      expect.objectContaining({ action: 'URGENT_CLEARED', capacity: 'SYSTEM' }),
    ]);
    expect(state.db.notifications).toEqual([
      expect.objectContaining({ userId: 'creator-1', message: expect.stringContaining('Penipuan terverifikasi') }),
    ]);
  });

  it.each([
    ['expired', 'EXPIRED'],
    ['completed', 'COMPLETED'],
  ] as const)('suspends a %s Campaign', async (status, lifecycleStatus) => {
    state.db = makeCampaignDb({ campaigns: [campaignRow({ status, lifecycleStatus, deadline: PAST })] });

    const response = await suspendReq({ reason: 'Penipuan' });

    expect(response.status).toBe(200);
    expect((await response.json()).campaign.lifecycleStatus).toBe('SUSPENDED');
    expect(state.db.statusChanges[0]).toMatchObject({ fromStatus: lifecycleStatus, toStatus: 'SUSPENDED' });
  });

  it('suspends an Active Campaign past its deadline after recording it Expired', async () => {
    state.db = makeCampaignDb({ campaigns: [active({ deadline: PAST })] });

    const response = await suspendReq({ reason: 'Penipuan' });

    expect(response.status).toBe(200);
    expect(state.db.statusChanges.map((s) => [s.action, s.fromStatus])).toEqual([
      ['EXPIRED', 'ACTIVE'],
      ['SUSPENDED', 'EXPIRED'],
    ]);
  });

  it.each([
    ['suspended', 'SUSPENDED'],
    ['cancelled', 'CANCELLED'],
    ['rejected', 'REJECTED'],
    ['pending', 'SUBMITTED'],
  ] as const)('answers 409 for a Campaign that is %s and changes nothing', async (status, lifecycleStatus) => {
    state.db = makeCampaignDb({ campaigns: [campaignRow({ status, lifecycleStatus })] });

    const response = await suspendReq({ reason: 'Penipuan' });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'INVALID_TRANSITION', error: expect.stringContaining('berstatus') });
    expect(state.db.campaign().lifecycleStatus).toBe(lifecycleStatus);
    expect(state.db.statusChanges).toEqual([]);
  });

  it('answers 403 to a Verifier without the Admin assignment (ADR 0005)', async () => {
    mockSession.mockResolvedValue(session('verifier-1', ['VERIFIER']));

    const response = await suspendReq({ reason: 'Penipuan' });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'NOT_AUTHORIZED' });
    expect(state.db.statusChanges).toEqual([]);
  });

  it('answers 403 to an Admin who owns the Campaign', async () => {
    state.db = makeCampaignDb({ campaigns: [active({ creatorId: 'admin-a' })] });

    const response = await suspendReq({ reason: 'Penipuan' });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'OWN_CAMPAIGN_CONFLICT' });
    expect(state.db.campaign().lifecycleStatus).toBe('ACTIVE');
  });

  it.each([
    ['no reason', {}],
    ['a blank reason', { reason: '   ' }],
    ['a reason over 1000 characters', { reason: 'x'.repeat(1001) }],
    ['a body that is not JSON', 'not json'],
  ])('answers 400 for %s and changes nothing', async (_label, body) => {
    const response = await suspendReq(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION', error: expect.stringContaining('Alasan') });
    expect(state.db.campaign().lifecycleStatus).toBe('ACTIVE');
    expect(state.db.statusChanges).toEqual([]);
  });

  it('answers 500 without leaking details when the database fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.db.prisma.campaign.findUnique = async () => {
      throw new Error('connection lost');
    };

    const response = await suspendReq({ reason: 'Penipuan' });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Terjadi kesalahan server' });
  });

  it('answers 404 for an unknown slug', async () => {
    const response = await suspendReq({ reason: 'Penipuan' }, 'tidak-ada');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'CAMPAIGN_NOT_FOUND' });
  });

  it('answers 409 to the loser when another Admin suspends at the same moment: one change', async () => {
    state.db.beforeNextCampaignWrite((data) => {
      Object.assign(data.campaigns[0], { status: 'suspended', lifecycleStatus: 'SUSPENDED' });
      data.statusChanges.push({ ...suspensionRow('ACTIVE', 'admin-c'), id: 'other' });
    });

    const response = await suspendReq({ reason: 'Penipuan' });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'CONCURRENT_TRANSITION' });
    expect(state.db.statusChanges.map((s) => s.actorId)).toEqual(['admin-c']);
  });
});

describe('DELETE /api/campaigns/[slug]/suspension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue(ADMIN_B);
    suspended('ACTIVE');
  });

  it('answers 401 without a session and changes nothing', async () => {
    mockSession.mockResolvedValue(null);

    const response = await liftReq({ reason: 'Klarifikasi' });

    expect(response.status).toBe(401);
    expect(state.db.campaign().lifecycleStatus).toBe('SUSPENDED');
  });

  it('lifts a Suspension imposed by another Admin: answers 200, back to Active, logged and notified with the reason', async () => {
    const response = await liftReq({ reason: 'Klarifikasi diterima' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      campaign: { id: 'campaign-1', slug: SLUG, lifecycleStatus: 'ACTIVE', isUrgent: false },
    });
    expect(state.db.campaign()).toMatchObject({ status: 'active', lifecycleStatus: 'ACTIVE' });
    expect(state.db.statusChanges[1]).toMatchObject({
      action: 'SUSPENSION_LIFTED', fromStatus: 'SUSPENDED', toStatus: 'ACTIVE',
      actorId: 'admin-b', capacity: 'ADMIN', reason: 'Klarifikasi diterima',
    });
    expect(state.db.notifications).toEqual([
      expect.objectContaining({ userId: 'creator-1', message: expect.stringContaining('Klarifikasi diterima') }),
    ]);
  });

  it.each([
    ['COMPLETED', FUTURE, 'COMPLETED'],
    ['EXPIRED', PAST, 'EXPIRED'],
    ['ACTIVE', PAST, 'EXPIRED'],
  ] as const)('restores a Campaign suspended while %s (deadline %s) to %s', async (from, deadline, to) => {
    suspended(from, { deadline });

    const response = await liftReq({ reason: 'Klarifikasi' });

    expect(response.status).toBe(200);
    expect((await response.json()).campaign.lifecycleStatus).toBe(to);
    expect(state.db.campaign().lifecycleStatus).toBe(to);
  });

  it('answers 403 to the Admin who imposed the Suspension, saying another Admin must lift it', async () => {
    mockSession.mockResolvedValue(ADMIN_A);

    const response = await liftReq({ reason: 'Klarifikasi' });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe('SAME_ADMIN_LIFT');
    expect(body.error).toMatch(/Admin lain/);
    expect(state.db.campaign().lifecycleStatus).toBe('SUSPENDED');
    expect(state.db.statusChanges).toHaveLength(1);
  });

  it('answers 409 saying why for a Suspension imposed before the status log existed', async () => {
    state.db = makeCampaignDb({
      campaigns: [campaignRow({ status: 'suspended', lifecycleStatus: 'SUSPENDED' })],
    });

    const response = await liftReq({ reason: 'Klarifikasi' });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'INVALID_TRANSITION',
      error: expect.stringContaining('sebelum riwayat status dicatat'),
    });
    expect(state.db.campaign().lifecycleStatus).toBe('SUSPENDED');
  });

  it('answers 403 to an Admin who owns the Campaign', async () => {
    suspended('ACTIVE', { creatorId: 'admin-b' });

    const response = await liftReq({ reason: 'Klarifikasi' });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'OWN_CAMPAIGN_CONFLICT' });
  });

  it('answers 403 to a Verifier without the Admin assignment', async () => {
    mockSession.mockResolvedValue(session('verifier-1', ['VERIFIER']));

    const response = await liftReq({ reason: 'Klarifikasi' });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'NOT_AUTHORIZED' });
    expect(state.db.campaign().lifecycleStatus).toBe('SUSPENDED');
  });

  it.each([
    ['active', 'ACTIVE'],
    ['expired', 'EXPIRED'],
    ['completed', 'COMPLETED'],
    ['cancelled', 'CANCELLED'],
    ['rejected', 'REJECTED'],
    ['pending', 'SUBMITTED'],
  ] as const)('answers 409 for a Campaign that is %s', async (status, lifecycleStatus) => {
    state.db = makeCampaignDb({ campaigns: [campaignRow({ status, lifecycleStatus, deadline: FUTURE })] });

    const response = await liftReq({ reason: 'Klarifikasi' });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(state.db.campaign().lifecycleStatus).toBe(lifecycleStatus);
  });

  it.each([
    ['no reason', {}],
    ['a blank reason', { reason: '' }],
    ['a reason over 1000 characters', { reason: 'x'.repeat(1001) }],
    ['a body that is not JSON', 'not json'],
  ])('answers 400 for %s and changes nothing', async (_label, body) => {
    const response = await liftReq(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION' });
    expect(state.db.campaign().lifecycleStatus).toBe('SUSPENDED');
  });

  it('answers 404 for an unknown slug', async () => {
    const response = await liftReq({ reason: 'Klarifikasi' }, 'tidak-ada');

    expect(response.status).toBe(404);
  });

  it('answers 409 to the loser when another Admin lifts at the same moment: one change', async () => {
    state.db.beforeNextCampaignWrite((data) => {
      Object.assign(data.campaigns[0], { status: 'active', lifecycleStatus: 'ACTIVE' });
      data.statusChanges.push({
        ...suspensionRow('SUSPENDED', 'admin-c'), id: 'other', action: 'SUSPENSION_LIFTED', toStatus: 'ACTIVE',
      });
    });

    const response = await liftReq({ reason: 'Klarifikasi' });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'CONCURRENT_TRANSITION' });
    expect(state.db.statusChanges.map((s) => s.action)).toEqual(['SUSPENDED', 'SUSPENSION_LIFTED']);
    expect(state.db.notifications).toEqual([]);
  });
});
