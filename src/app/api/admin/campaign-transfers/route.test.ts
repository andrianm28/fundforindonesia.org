import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The two Campaign Transfer routes (prd-compliance 33; PRD §7.2): who may
 * request and decide, and that every domain refusal reaches the caller with
 * its own code. The Kind rules themselves are tested through the service
 * (src/lib/money/campaign-transfers.test.ts); here only the HTTP seam.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: (fn: (client: unknown) => unknown) => fn({}) },
}));
vi.mock('@/lib/money/campaign-transfers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/money/campaign-transfers')>();
  return {
    ...actual,
    requestCampaignTransfer: vi.fn(),
    approveCampaignTransfer: vi.fn(),
    rejectCampaignTransfer: vi.fn(),
  };
});

import { POST as REQUEST } from './route';
import { POST as DECISION } from './[id]/decision/route';
import { getServerSession } from '@/lib/auth';
import {
  requestCampaignTransfer,
  approveCampaignTransfer,
  rejectCampaignTransfer,
  CampaignTransferBalanceChangedError,
  CampaignTransferCrossKindError,
  CampaignTransferNotPendingError,
  SelfApprovalError,
} from '@/lib/money/campaign-transfers';

const mockSession = getServerSession as unknown as Mock;
const mockRequest = requestCampaignTransfer as unknown as Mock;
const mockApprove = approveCampaignTransfer as unknown as Mock;
const mockReject = rejectCampaignTransfer as unknown as Mock;

function request(body: unknown): Promise<Response> {
  return REQUEST(
    new NextRequest('http://localhost:3000/api/admin/campaign-transfers', { method: 'POST', body: JSON.stringify(body) }),
  );
}
function decide(body: unknown): Promise<Response> {
  return DECISION(
    new NextRequest('http://localhost:3000/api/admin/campaign-transfers/ct-1/decision', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'ct-1' }) },
  );
}

const BODY = { sourceId: 'a', targetId: 'b', reason: 'Suspended' };

const actual = await vi.importActual<typeof import('@/lib/money/campaign-transfers')>('@/lib/money/campaign-transfers');

describe('POST /api/admin/campaign-transfers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockRequest.mockResolvedValue({ id: 'ct-1', status: 'PENDING' });
    mockApprove.mockResolvedValue({ id: 'ct-1', status: 'APPROVED' });
    mockReject.mockResolvedValue({ id: 'ct-1', status: 'REJECTED' });
  });

  it('answers 401 with no session and 403 without the ADMIN assignment', async () => {
    mockSession.mockResolvedValue(null);
    expect((await request(BODY)).status).toBe(401);
    expect((await decide({ decision: 'approve' })).status).toBe(401);

    mockSession.mockResolvedValue({ user: { id: 'verifier-1', assignments: ['VERIFIER'] } });
    expect((await request(BODY)).status).toBe(403);
    expect((await decide({ decision: 'approve' })).status).toBe(403);

    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it('requests as the acting Admin and answers 201 with a PENDING transfer', async () => {
    const res = await request(BODY);
    expect(res.status).toBe(201);
    expect(mockRequest).toHaveBeenCalledWith(expect.anything(), { ...BODY, requestedById: 'admin-1' });
    expect(await res.json()).toMatchObject({ transfer: { status: 'PENDING' } });
  });

  it('never passes a body-supplied amount to the service: the server computes the full balance', async () => {
    await request({ ...BODY, amount: 1 });
    expect(mockRequest).toHaveBeenCalledWith(expect.anything(), { ...BODY, requestedById: 'admin-1' });
    expect(mockRequest.mock.calls[0][1]).not.toHaveProperty('amount');
  });

  it('answers a cross-Kind request 403 with its own code, never a warning', async () => {
    mockRequest.mockRejectedValue(new CampaignTransferCrossKindError('ZAKAT', 'WAKAF'));
    const res = await request(BODY);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('CAMPAIGN_TRANSFER_CROSS_KIND');
  });

  it('approves and rejects as the acting Admin', async () => {
    mockSession.mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } });
    expect((await decide({ decision: 'approve' })).status).toBe(200);
    expect(mockApprove).toHaveBeenCalledWith(expect.anything(), { campaignTransferId: 'ct-1', decidedById: 'admin-2' });

    expect((await decide({ decision: 'reject', reason: 'Tidak sesuai' })).status).toBe(200);
    expect(mockReject).toHaveBeenCalledWith(expect.anything(), {
      campaignTransferId: 'ct-1',
      decidedById: 'admin-2',
      reason: 'Tidak sesuai',
    });
  });

  it('answers 403 for the requester approving and 409 for a transfer already decided', async () => {
    mockApprove.mockRejectedValueOnce(new SelfApprovalError('Campaign Transfer'));
    const own = await decide({ decision: 'approve' });
    expect(own.status).toBe(403);
    expect((await own.json()).code).toBe('SELF_APPROVAL');

    mockApprove.mockRejectedValueOnce(new CampaignTransferNotPendingError('APPROVED'));
    const decided = await decide({ decision: 'approve' });
    expect(decided.status).toBe(409);
    expect((await decided.json()).code).toBe('CAMPAIGN_TRANSFER_NOT_PENDING');
  });

  it('answers 409 CAMPAIGN_TRANSFER_BALANCE_CHANGED when the balance moved since the request', async () => {
    mockSession.mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } });
    mockApprove.mockRejectedValueOnce(new CampaignTransferBalanceChangedError(400_000, 250_000));
    const res = await decide({ decision: 'approve' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('CAMPAIGN_TRANSFER_BALANCE_CHANGED');
  });

  it('refuses a decision it does not enumerate', async () => {
    expect((await decide({ decision: 'delete' })).status).toBe(400);
    expect(mockApprove).not.toHaveBeenCalled();
  });

  describe('a body of the wrong type', () => {
    it.each([['an array', []], ['a string', 'x'], ['null', null]])(
      'answers 400 on both routes when the body is %s, and calls no command',
      async (_name, body) => {
        expect((await request(body)).status).toBe(400);
        expect((await decide(body)).status).toBe(400);
        expect(mockRequest).not.toHaveBeenCalled();
        expect(mockApprove).not.toHaveBeenCalled();
        expect(mockReject).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['sourceId is a number', { ...BODY, sourceId: 5 }],
      ['targetId is missing', { ...BODY, targetId: undefined }],
      ['reason is an object', { ...BODY, reason: { text: 'x' } }],
    ])('answers 400 CAMPAIGN_TRANSFER_INVALID, through the real service, when %s', async (_name, body) => {
      mockRequest.mockImplementation(actual.requestCampaignTransfer);
      const res = await request(body);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('CAMPAIGN_TRANSFER_INVALID');
    });

    it('answers 400 CAMPAIGN_TRANSFER_INVALID when a reject carries a non-string reason, and a decision of the wrong type is refused', async () => {
      mockSession.mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } });
      mockReject.mockImplementation(actual.rejectCampaignTransfer);
      const res = await decide({ decision: 'reject', reason: 42 });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('CAMPAIGN_TRANSFER_INVALID');

      expect((await decide({ decision: ['approve'] })).status).toBe(400);
      expect(mockApprove).not.toHaveBeenCalled();
    });
  });
});
