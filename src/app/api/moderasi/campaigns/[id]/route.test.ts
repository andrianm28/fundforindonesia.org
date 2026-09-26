import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  campaignRow,
  makeCampaignDb,
  verificationRequestRow,
} from '../../../../../../tests/support/in-memory-campaign-db';

/**
 * End to end through the real handler and the real lifecycle module, with
 * the session and the database stood in. The HTTP handling (401, body
 * parsing, refusals, 500) is the lifecycle adapter's and is tested in
 * src/lib/lifecycle-route.test.ts; the rules are decideVerificationRequest's,
 * tested in campaign-lifecycle.decide.test.ts. This file proves that the
 * request reaches the command with the Campaign id from the path and the
 * decision, request, ticks, reason and note from the body, plus the route's
 * own validation of `action` and `requestId`.
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

const VERIFIER = { user: { id: 'verifier-1', assignments: ['VERIFIER'] } };
const CHECKLIST = [
  { id: 'item-1', label: 'KTP penanggung jawab', required: true, position: 1, ticked: false },
  { id: 'item-2', label: 'Rencana anggaran', required: true, position: 2, ticked: false },
];

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
    state.db = makeCampaignDb({
      campaigns: [campaignRow()],
      verificationRequests: [verificationRequestRow({ id: 'verification-1', checklist: CHECKLIST })],
    });
  });

  it('approve decides the named request with its ticks and note, answering 200 with the Campaign and request', async () => {
    const response = await patch({
      action: 'approve',
      requestId: 'verification-1',
      ticked: ['item-1', 'item-2'],
      identityNote: 'KTP cocok.',
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.campaign).toEqual({
      id: 'campaign-1',
      slug: 'bantu-korban-banjir',
      lifecycleStatus: 'ACTIVE',
      isUrgent: false,
    });
    expect(body.verificationRequest).toMatchObject({ id: 'verification-1', outcome: 'APPROVED', decidedById: 'verifier-1' });
    expect(body.identityVerificationRecorded).toBe(true);
    expect(state.db.verificationRequests[0].checklist).toEqual(CHECKLIST.map((e) => ({ ...e, ticked: true })));
    expect(state.db.identityVerifications).toEqual([expect.objectContaining({ userId: 'creator-1', note: 'KTP cocok.' })]);
    expect(state.db.statusChanges).toEqual([
      expect.objectContaining({ action: 'SUBMISSION_APPROVED', actorId: 'verifier-1', capacity: 'VERIFIER' }),
    ]);
  });

  it('answers 422 REQUIRED_CHECKLIST_ITEMS_UNTICKED to an approval missing a required tick, naming it, and changes nothing', async () => {
    const response = await patch({ action: 'approve', requestId: 'verification-1', ticked: ['item-1'] });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'Campaign belum dapat diloloskan. Butir wajib yang belum dicentang: Rencana anggaran.',
      code: 'REQUIRED_CHECKLIST_ITEMS_UNTICKED',
    });
    expect(state.db.verificationRequests[0]).toMatchObject({ outcome: 'PENDING', checklist: CHECKLIST });
    expect(state.db.campaign().lifecycleStatus).toBe('SUBMITTED');
    expect(state.db.identityVerifications).toEqual([]);
  });

  it('reject with a reason makes the Campaign Rejected and keeps the reason', async () => {
    const response = await patch({ action: 'reject', requestId: 'verification-1', reason: 'KTP buram.' });

    expect(response.status).toBe(200);
    expect((await response.json()).campaign.lifecycleStatus).toBe('REJECTED');
    expect(state.db.verificationRequests[0]).toMatchObject({ outcome: 'REJECTED', reason: 'KTP buram.' });
  });

  it('answers 400 to a rejection without a reason and changes nothing', async () => {
    const response = await patch({ action: 'reject', requestId: 'verification-1' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION' });
    expect(state.db.verificationRequests[0].outcome).toBe('PENDING');
  });

  it.each(['APPROVED', 'REJECTED', 'WITHDRAWN'] as const)(
    'answers 409 to a request already %s and leaves it as it was',
    async (outcome) => {
      const closed = verificationRequestRow({
        id: 'verification-1',
        outcome,
        reason: outcome === 'REJECTED' ? 'Alasan lama.' : null,
        decidedById: outcome === 'WITHDRAWN' ? null : 'verifier-2',
      });
      state.db = makeCampaignDb({ campaigns: [campaignRow()], verificationRequests: [closed] });

      const response = await patch({ action: 'reject', requestId: 'verification-1', reason: 'Alasan baru.' });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'VERIFICATION_REQUEST_NOT_PENDING' });
      expect(state.db.verificationRequests).toEqual([closed]);
    },
  );

  it('answers 403 OWN_CAMPAIGN_CONFLICT to the Verifier who owns the Campaign', async () => {
    mockSession.mockResolvedValue({ user: { id: 'creator-1', assignments: ['VERIFIER'] } });

    const response = await patch({ action: 'approve', requestId: 'verification-1' });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'OWN_CAMPAIGN_CONFLICT' });
    expect(state.db.verificationRequests[0].outcome).toBe('PENDING');
  });

  it("answers a missing Verifier assignment with the command's Indonesian refusal, not a bare Forbidden", async () => {
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });

    const response = await patch({ action: 'approve', requestId: 'verification-1' });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Hanya Verifier yang dapat menyetujui atau menolak Campaign.',
      code: 'NOT_AUTHORIZED',
    });
    expect(state.db.statusChanges).toEqual([]);
  });

  it.each([
    ['suspend, which a Verifier no longer does', { action: 'suspend', requestId: 'verification-1' }],
    ['a missing action', { requestId: 'verification-1' }],
    ['an unknown action', { action: 'delete', requestId: 'verification-1' }],
    ['an inherited object key', { action: 'constructor', requestId: 'verification-1' }],
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

  it.each([
    ['missing', { action: 'approve' }],
    ['empty', { action: 'approve', requestId: '' }],
    ['not a string', { action: 'approve', requestId: 7 }],
  ])('answers 400 when the requestId is %s, so a stale page never decides a newer request', async (_label, body) => {
    const response = await patch(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION' });
    expect(state.db.verificationRequests[0].outcome).toBe('PENDING');
  });
});
