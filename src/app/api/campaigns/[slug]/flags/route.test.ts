import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignFlagRow,
  campaignRow,
  makeCampaignDb,
  type CampaignRow,
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

import { POST as FLAG } from './route';
import { POST as DISMISS } from './[id]/dismiss/route';
import { POST as SUSPEND } from '../suspension/route';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;

const SLUG = 'bantu-korban-banjir';
const PAST = new Date('2020-01-01T00:00:00Z');
const FUTURE = new Date('2099-12-31T00:00:00Z');

function session(id: string, assignments: string[]) {
  return { user: { id, role: assignments.includes('ADMIN') ? 'ADMIN' : 'DONOR', assignments } };
}
const VERIFIER = session('verifier-1', ['VERIFIER']);
const ADMIN_A = session('admin-a', ['ADMIN']);

function active(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return campaignRow({ status: 'active', lifecycleStatus: 'ACTIVE', deadline: FUTURE, ...overrides });
}

function request(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/campaigns/${path}`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function flagReq(body: unknown, slug = SLUG): Promise<Response> {
  return FLAG(request(`${slug}/flags`, body), { params: Promise.resolve({ slug }) });
}

function dismissReq(body: unknown, id = 'flag-1', slug = SLUG): Promise<Response> {
  return DISMISS(request(`${slug}/flags/${id}/dismiss`, body), { params: Promise.resolve({ slug, id }) });
}

describe('POST /api/campaigns/[slug]/flags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue(VERIFIER);
    state.db = makeCampaignDb({ campaigns: [active()] });
  });

  it('answers 401 without a session and raises nothing', async () => {
    mockSession.mockResolvedValue(null);

    const response = await flagReq({ reason: 'Foto palsu' });

    expect(response.status).toBe(401);
    expect(state.db.campaignFlags).toEqual([]);
  });

  it('raises a Flag on an Active Campaign: answers 201 with the Campaign state and the open Flag', async () => {
    const response = await flagReq({ reason: '  Foto palsu  ' });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      campaign: { id: 'campaign-1', slug: SLUG, lifecycleStatus: 'ACTIVE', isUrgent: false },
      flag: {
        id: expect.any(String),
        campaignId: 'campaign-1',
        verifierId: 'verifier-1',
        reason: 'Foto palsu',
        createdAt: expect.any(String),
        resolution: null,
        resolvedById: null,
        resolutionReason: null,
        resolvedAt: null,
      },
    });
    expect(state.db.campaignFlags).toEqual([
      expect.objectContaining({ id: body.flag.id, verifierId: 'verifier-1', reason: 'Foto palsu', resolution: null }),
    ]);
    expect(state.db.campaign().lifecycleStatus).toBe('ACTIVE');
    expect(state.db.statusChanges).toEqual([]);
    expect(state.db.notifications).toEqual([]);
  });

  it.each([
    ['expired', 'EXPIRED'],
    ['completed', 'COMPLETED'],
  ] as const)('raises a Flag on a %s Campaign', async (status, lifecycleStatus) => {
    state.db = makeCampaignDb({ campaigns: [campaignRow({ status, lifecycleStatus, deadline: PAST })] });

    const response = await flagReq({ reason: 'Dana tidak disalurkan' });

    expect(response.status).toBe(201);
    expect((await response.json()).campaign.lifecycleStatus).toBe(lifecycleStatus);
    expect(state.db.campaignFlags).toHaveLength(1);
  });

  it('raises a Flag on an Active Campaign past its deadline after recording it Expired', async () => {
    state.db = makeCampaignDb({ campaigns: [active({ deadline: PAST })] });

    const response = await flagReq({ reason: 'Dana tidak disalurkan' });

    expect(response.status).toBe(201);
    expect((await response.json()).campaign.lifecycleStatus).toBe('EXPIRED');
    expect(state.db.statusChanges.map((s) => s.action)).toEqual(['EXPIRED']);
  });

  it('keeps several open Flags on the same Campaign separately', async () => {
    await flagReq({ reason: 'Foto palsu' });
    mockSession.mockResolvedValue(session('verifier-2', ['VERIFIER']));
    await flagReq({ reason: 'Rekening atas nama orang lain' });

    expect(state.db.campaignFlags.map((f) => [f.verifierId, f.reason, f.resolution])).toEqual([
      ['verifier-1', 'Foto palsu', null],
      ['verifier-2', 'Rekening atas nama orang lain', null],
    ]);
  });

  it.each([
    ['suspended', 'SUSPENDED'],
    ['cancelled', 'CANCELLED'],
    ['rejected', 'REJECTED'],
    ['pending', 'SUBMITTED'],
  ] as const)('answers 409 for a Campaign that is %s and raises nothing', async (status, lifecycleStatus) => {
    state.db = makeCampaignDb({ campaigns: [campaignRow({ status, lifecycleStatus })] });

    const response = await flagReq({ reason: 'Foto palsu' });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'INVALID_TRANSITION', error: expect.stringContaining('berstatus') });
    expect(state.db.campaignFlags).toEqual([]);
  });

  it('answers 403 to an Admin without the Verifier assignment (ADR 0005)', async () => {
    mockSession.mockResolvedValue(ADMIN_A);

    const response = await flagReq({ reason: 'Foto palsu' });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'NOT_AUTHORIZED', error: expect.stringContaining('Verifier') });
    expect(state.db.campaignFlags).toEqual([]);
  });

  it('answers 403 to a Verifier who owns the Campaign and raises nothing', async () => {
    state.db = makeCampaignDb({ campaigns: [active({ creatorId: 'verifier-1' })] });

    const response = await flagReq({ reason: 'Foto palsu' });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'OWN_CAMPAIGN_CONFLICT', error: expect.stringContaining('Verifier lain') });
    expect(state.db.campaignFlags).toEqual([]);
  });

  it.each([
    ['no reason', {}],
    ['a blank reason', { reason: '   ' }],
    ['a reason over 1000 characters', { reason: 'x'.repeat(1001) }],
    ['a body that is not JSON', 'not json'],
  ])('answers 400 for %s and raises nothing', async (_label, body) => {
    const response = await flagReq(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION', error: expect.stringContaining('Alasan') });
    expect(state.db.campaignFlags).toEqual([]);
  });

  it('answers 404 for an unknown slug', async () => {
    const response = await flagReq({ reason: 'Foto palsu' }, 'tidak-ada');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'CAMPAIGN_NOT_FOUND' });
  });

  it('answers 500 without leaking details when the database fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.db.prisma.campaign.findUnique = async () => {
      throw new Error('connection lost');
    };

    const response = await flagReq({ reason: 'Foto palsu' });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Terjadi kesalahan server' });
  });
});

describe('POST /api/campaigns/[slug]/flags/[id]/dismiss', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue(ADMIN_A);
    state.db = makeCampaignDb({
      campaigns: [active()],
      campaignFlags: [campaignFlagRow(), campaignFlagRow({ id: 'flag-2' })],
    });
  });

  it('answers 401 without a session and leaves the Flag open', async () => {
    mockSession.mockResolvedValue(null);

    const response = await dismissReq({ reason: 'Sudah diklarifikasi' });

    expect(response.status).toBe(401);
    expect(state.db.campaignFlag().resolution).toBeNull();
  });

  it('dismisses the Flag: answers 200 with the Campaign state and the dismissed Flag, other Flags untouched', async () => {
    const response = await dismissReq({ reason: '  Sudah diklarifikasi  ' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      campaign: { id: 'campaign-1', slug: SLUG, lifecycleStatus: 'ACTIVE', isUrgent: false },
      flag: expect.objectContaining({
        id: 'flag-1',
        verifierId: 'verifier-1',
        resolution: 'DISMISSED',
        resolvedById: 'admin-a',
        resolutionReason: 'Sudah diklarifikasi',
        resolvedAt: expect.any(String),
      }),
    });
    expect(state.db.campaignFlag('flag-1')).toMatchObject({
      resolution: 'DISMISSED', resolvedById: 'admin-a', resolutionReason: 'Sudah diklarifikasi',
    });
    expect(state.db.campaignFlag('flag-2').resolution).toBeNull();
    expect(state.db.campaign().lifecycleStatus).toBe('ACTIVE');
    expect(state.db.notifications).toEqual([]);
  });

  it('answers 403 to an Admin who owns the Campaign', async () => {
    state.db = makeCampaignDb({
      campaigns: [active({ creatorId: 'admin-a' })],
      campaignFlags: [campaignFlagRow()],
    });

    const response = await dismissReq({ reason: 'Sudah diklarifikasi' });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'OWN_CAMPAIGN_CONFLICT' });
    expect(state.db.campaignFlag().resolution).toBeNull();
  });

  it('answers 403 to a Verifier without the Admin assignment', async () => {
    mockSession.mockResolvedValue(VERIFIER);

    const response = await dismissReq({ reason: 'Sudah diklarifikasi' });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'NOT_AUTHORIZED', error: expect.stringContaining('Admin') });
    expect(state.db.campaignFlag().resolution).toBeNull();
  });

  it.each([
    ['DISMISSED', 'ditolak'],
    ['SUSPENDED', 'Suspended'],
  ] as const)('answers 409 for a Flag already %s and keeps its resolution', async (resolution, wording) => {
    state.db = makeCampaignDb({
      campaigns: [active()],
      campaignFlags: [campaignFlagRow({ resolution, resolvedById: 'admin-b', resolutionReason: 'Keputusan awal' })],
    });

    const response = await dismissReq({ reason: 'Sudah diklarifikasi' });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'FLAG_ALREADY_RESOLVED', error: expect.stringContaining(wording) });
    expect(state.db.campaignFlag()).toMatchObject({ resolution, resolvedById: 'admin-b', resolutionReason: 'Keputusan awal' });
  });

  it('answers 409 when a Suspension resolves the Flag first: the Suspension stands', async () => {
    mockSession.mockResolvedValue(session('admin-b', ['ADMIN']));
    await SUSPEND(request(`${SLUG}/suspension`, { reason: 'Penipuan' }), { params: Promise.resolve({ slug: SLUG }) });
    mockSession.mockResolvedValue(ADMIN_A);

    const response = await dismissReq({ reason: 'Sudah diklarifikasi' });

    expect(response.status).toBe(409);
    expect(state.db.campaignFlags.map((f) => [f.id, f.resolution, f.resolvedById])).toEqual([
      ['flag-1', 'SUSPENDED', 'admin-b'],
      ['flag-2', 'SUSPENDED', 'admin-b'],
    ]);
  });

  it.each([
    ['no reason', {}],
    ['a blank reason', { reason: '   ' }],
    ['a body that is not JSON', 'not json'],
  ])('answers 400 for %s and leaves the Flag open', async (_label, body) => {
    const response = await dismissReq(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION' });
    expect(state.db.campaignFlag().resolution).toBeNull();
  });

  it('answers 404 for an unknown Flag, or one belonging to another Campaign', async () => {
    state.db = makeCampaignDb({
      campaigns: [active(), active({ id: 'campaign-2', slug: 'lain' })],
      campaignFlags: [campaignFlagRow({ id: 'flag-other', campaignId: 'campaign-2' })],
    });

    const unknown = await dismissReq({ reason: 'Sudah diklarifikasi' }, 'tidak-ada');
    const elsewhere = await dismissReq({ reason: 'Sudah diklarifikasi' }, 'flag-other');

    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: 'FLAG_NOT_FOUND' });
    expect(elsewhere.status).toBe(404);
    expect(state.db.campaignFlag('flag-other').resolution).toBeNull();
  });

  it('answers 404 for an unknown slug', async () => {
    const response = await dismissReq({ reason: 'Sudah diklarifikasi' }, 'flag-1', 'tidak-ada');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'CAMPAIGN_NOT_FOUND' });
  });

  it('answers 500 without leaking details when the database fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.db.prisma.campaign.findUnique = async () => {
      throw new Error('connection lost');
    };

    const response = await dismissReq({ reason: 'Sudah diklarifikasi' });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Terjadi kesalahan server' });
  });
});
