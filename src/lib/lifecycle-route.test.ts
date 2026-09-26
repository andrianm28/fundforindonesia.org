import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { campaignRow, makeCampaignDb } from '../../tests/support/in-memory-campaign-db';

/**
 * The lifecycle HTTP adapter, tested once so the route tests don't have to:
 * a request goes in, an HTTP status and body come out. The commands are
 * stand-ins (the route tests prove the real ones are reached); the session
 * and the database are stood in as everywhere else.
 */
const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof makeCampaignDb> }));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    { get: (_target, key) => (state.db.prisma as Record<string | symbol, unknown>)[key] },
  ),
}));

import { lifecycleRoute } from './lifecycle-route';
import {
  CampaignNotFoundError,
  CancellationAlreadyPendingError,
  CancellationNotPendingError,
  CancellationRequestNotFoundError,
  ConcurrentTransitionError,
  FlagAlreadyResolvedError,
  FlagNotFoundError,
  InvalidTransitionError,
  LifecycleValidationError,
  MissingCampaignUpdateError,
  NotAuthorizedError,
  OwnSubjectConflictError,
  PayoutAlreadyCompletedError,
  SameAdminLiftError,
} from './campaign-lifecycle';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;

const SLUG = 'bantu-korban-banjir';
const ADMIN = { user: { id: 'admin-1', role: 'ADMIN', assignments: ['ADMIN'] } };
const RESULT = { campaign: { id: 'campaign-1', slug: SLUG, lifecycleStatus: 'ACTIVE', isUrgent: false } };

function request(body?: unknown, method = 'POST'): NextRequest {
  return new NextRequest(`http://localhost:3000/api/campaigns/${SLUG}/something`, {
    method,
    ...(body === undefined
      ? {}
      : { body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
}

function slugRoute(overrides: { input?: (req: { body: Record<string, unknown>; params: Record<string, string> }) => object; status?: 200 | 201 } = {}) {
  const command = vi.fn(async (_prisma: unknown, _input: { campaignId: string; actor: unknown }) => RESULT);
  const input = vi.fn(overrides.input ?? (({ body }) => ({ reason: body.reason })));
  const handler = lifecycleRoute({ campaign: 'slug', command, input, status: overrides.status });
  const call = (body?: unknown, params: Record<string, string> = { slug: SLUG }) =>
    handler(request(body), { params: Promise.resolve(params) });
  return { command, input, call };
}

describe('lifecycleRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockSession.mockResolvedValue(ADMIN);
    state.db = makeCampaignDb({ campaigns: [campaignRow()] });
  });

  it('answers 401 with a code without a session, and never calls the command', async () => {
    mockSession.mockResolvedValue(null);
    const { command, call } = slugRoute();

    const response = await call({ reason: 'x' });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Anda harus login terlebih dahulu.', code: 'UNAUTHENTICATED' });
    expect(command).not.toHaveBeenCalled();
  });

  it('calls the command with the Campaign id behind the slug, the actor and the built input, and answers 200 with its result', async () => {
    const { command, call } = slugRoute();

    const response = await call({ reason: 'Alasan' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(RESULT);
    expect(command).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[0][1]).toEqual({
      campaignId: 'campaign-1',
      actor: { userId: 'admin-1', assignments: ['ADMIN'] },
      reason: 'Alasan',
    });
  });

  it('answers 201 when the route declares creation', async () => {
    const { call } = slugRoute({ status: 201 });

    const response = await call({ reason: 'Alasan' });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(RESULT);
  });

  it('hands the input builder the route params, and an actor without assignments an empty list', async () => {
    mockSession.mockResolvedValue({ user: { id: 'creator-1', role: 'USER' } });
    const { command, input, call } = slugRoute({ input: ({ params }) => ({ flagId: params.id }) });

    await call({}, { slug: SLUG, id: 'flag-7' });

    expect(input).toHaveBeenCalledWith({ body: {}, params: { slug: SLUG, id: 'flag-7' } });
    expect(command.mock.calls[0][1]).toEqual({
      campaignId: 'campaign-1',
      actor: { userId: 'creator-1', assignments: [] },
      flagId: 'flag-7',
    });
  });

  it.each([
    ['no body', undefined],
    ['malformed JSON', '{not json'],
    ['a JSON array', ['reason']],
    ['JSON null', 'null'],
    ['a JSON string', '"alasan"'],
  ])('hands the input builder an empty object for %s', async (_label, body) => {
    const { command, input, call } = slugRoute();

    const response = await call(body);

    expect(response.status).toBe(200);
    expect(input.mock.calls[0][0].body).toEqual({});
    expect(command.mock.calls[0][1]).toMatchObject({ reason: undefined });
  });

  it('answers one 404 shape for an unknown slug, and never calls the command', async () => {
    const { command, call } = slugRoute();

    const response = await call({ reason: 'x' }, { slug: 'tidak-ada' });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Campaign tidak ditemukan.',
      code: 'CAMPAIGN_NOT_FOUND',
      by: 'slug',
    });
    expect(command).not.toHaveBeenCalled();
  });

  it('passes the id param through unchanged when the route addresses the Campaign by id', async () => {
    const command = vi.fn(async (_prisma: unknown, _input: { campaignId: string; actor: unknown }) => RESULT);
    const handler = lifecycleRoute({ campaign: 'id', command, input: () => ({}) });

    const response = await handler(request({}, 'PATCH'), { params: Promise.resolve({ id: 'no-lookup-needed' }) });

    expect(response.status).toBe(200);
    expect(command.mock.calls[0][1]).toMatchObject({ campaignId: 'no-lookup-needed' });
  });

  it('answers 400 when the input builder refuses the body, and never calls the command', async () => {
    const { command, call } = slugRoute({
      input: () => {
        throw new LifecycleValidationError('Kolom urgent wajib diisi true atau false.', 'urgent');
      },
    });

    const response = await call({ urgent: 'ya' }, { slug: 'tidak-ada' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Kolom urgent wajib diisi true atau false.', code: 'VALIDATION' });
    expect(command).not.toHaveBeenCalled();
  });

  it.each([
    [new LifecycleValidationError('Alasan wajib diisi.'), 400, 'VALIDATION'],
    [new NotAuthorizedError('Hanya Admin yang dapat membekukan Campaign.'), 403, 'NOT_AUTHORIZED'],
    [new OwnSubjectConflictError('campaign', 'ADMIN'), 403, 'OWN_CAMPAIGN_CONFLICT'],
    [new SameAdminLiftError(), 403, 'SAME_ADMIN_LIFT'],
    [new InvalidTransitionError('SUSPENDED'), 409, 'INVALID_TRANSITION'],
    [new ConcurrentTransitionError(), 409, 'CONCURRENT_TRANSITION'],
    [new PayoutAlreadyCompletedError(), 409, 'PAYOUT_ALREADY_COMPLETED'],
    [new CancellationAlreadyPendingError(), 409, 'CANCELLATION_ALREADY_PENDING'],
    [new MissingCampaignUpdateError(), 422, 'MISSING_CAMPAIGN_UPDATE'],
    [new CancellationRequestNotFoundError('request-1'), 404, 'CANCELLATION_REQUEST_NOT_FOUND'],
    [new CancellationNotPendingError('APPROVED'), 409, 'CANCELLATION_NOT_PENDING'],
    [new FlagNotFoundError('flag-1'), 404, 'FLAG_NOT_FOUND'],
    [new FlagAlreadyResolvedError('DISMISSED'), 409, 'FLAG_ALREADY_RESOLVED'],
  ] as const)('answers the command refusal %s with %i and its code and message', async (error, status, code) => {
    const { command, call } = slugRoute();
    command.mockRejectedValue(error);

    const response = await call({ reason: 'x' });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: error.message, code });
  });

  it('answers a command refusal of an unknown Campaign id with the same 404 shape, by id', async () => {
    const { command, call } = slugRoute();
    command.mockRejectedValue(new CampaignNotFoundError('campaign-1'));

    const response = await call({ reason: 'x' });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Campaign tidak ditemukan.', code: 'CAMPAIGN_NOT_FOUND', by: 'id' });
  });

  it('logs an unexpected command failure and answers one Indonesian 500 with a code, leaking nothing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('connection reset');
    const { command, call } = slugRoute();
    command.mockRejectedValue(failure);

    const response = await call({ reason: 'x' });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Terjadi kesalahan pada server.', code: 'INTERNAL_ERROR' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('POST /api/campaigns/bantu-korban-banjir/something'), failure);
  });

  it('answers the same logged 500 when the slug lookup itself fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('database down');
    state.db = { ...state.db, prisma: { campaign: { findUnique: async () => { throw failure; } } } } as unknown as typeof state.db;
    const { command, call } = slugRoute();

    const response = await call({ reason: 'x' });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Terjadi kesalahan pada server.', code: 'INTERNAL_ERROR' });
    expect(log).toHaveBeenCalledWith(expect.any(String), failure);
    expect(command).not.toHaveBeenCalled();
  });

  it('answers the same logged 500 when reading the session fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('session store down');
    mockSession.mockRejectedValue(failure);
    const { call } = slugRoute();

    const response = await call({ reason: 'x' });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Terjadi kesalahan pada server.', code: 'INTERNAL_ERROR' });
    expect(log).toHaveBeenCalledWith(expect.any(String), failure);
  });
});
