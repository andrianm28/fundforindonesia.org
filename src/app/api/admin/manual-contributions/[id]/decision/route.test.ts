import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The second Admin decides a recorded Manual Contribution (prd-compliance 34;
 * PRD FFI-07c): approve, reject, or reverse.
 *
 * One URL with an explicit `decision` rather than three near-identical route
 * files, and rather than a caller-chosen `status`: the three answers are
 * enumerated here, so a request can never ask for a state the service layer
 * does not recognise, and the two-person rule stays in one place.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    manualContribution: { findUniqueOrThrow: vi.fn() },
    $transaction: (fn: (client: unknown) => unknown) => fn({}),
  },
}));
vi.mock('@/lib/money/manual-contributions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/money/manual-contributions')>();
  return {
    ...actual,
    approveManualContribution: vi.fn(),
    rejectManualContribution: vi.fn(),
    reverseManualContribution: vi.fn(),
  };
});

import { POST } from './route';
import { getServerSession } from '@/lib/auth';
import {
  approveManualContribution,
  rejectManualContribution,
  reverseManualContribution,
  SelfApprovalError,
  ManualContributionAlreadySpentError,
  ManualContributionNotPendingError,
  ManualContributionInputError,
} from '@/lib/money/manual-contributions';

const mockSession = getServerSession as unknown as Mock;
const mockApprove = approveManualContribution as unknown as Mock;
const mockReject = rejectManualContribution as unknown as Mock;
const mockReverse = reverseManualContribution as unknown as Mock;

function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest('http://localhost:3000/api/admin/manual-contributions/mc-1/decision', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'mc-1' }) },
  );
}

describe('POST /api/admin/manual-contributions/[id]/decision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-2', assignments: ['ADMIN'] } });
    mockApprove.mockResolvedValue({ id: 'mc-1', status: 'APPROVED' });
    mockReject.mockResolvedValue({ id: 'mc-1', status: 'REJECTED' });
    mockReverse.mockResolvedValue({ id: 'mc-1', status: 'REVERSED' });
  });

  it('answers 401 with no session and 403 without the ADMIN assignment, for every decision', async () => {
    mockSession.mockResolvedValue(null);
    for (const decision of ['approve', 'reject', 'reverse']) {
      expect((await post({ decision, reason: 'x' })).status).toBe(401);
    }

    mockSession.mockResolvedValue({ user: { id: 'verifier-1', assignments: ['VERIFIER'] } });
    for (const decision of ['approve', 'reject', 'reverse']) {
      expect((await post({ decision, reason: 'x' })).status).toBe(403);
    }

    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockReject).not.toHaveBeenCalled();
    expect(mockReverse).not.toHaveBeenCalled();
  });

  it('approves as the acting Admin and answers 200 with the new status', async () => {
    const res = await post({ decision: 'approve' });

    expect(res.status).toBe(200);
    expect(mockApprove).toHaveBeenCalledWith(expect.anything(), {
      manualContributionId: 'mc-1',
      decidedById: 'admin-2',
    });
    expect(await res.json()).toMatchObject({ contribution: { status: 'APPROVED' } });
  });

  it('answers 403 when the Admin who recorded it tries to approve it', async () => {
    mockApprove.mockRejectedValue(new SelfApprovalError('Manual Contribution'));

    const res = await post({ decision: 'approve' });

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('SELF_APPROVAL');
  });

  it('answers 409 when someone else already decided it', async () => {
    mockApprove.mockRejectedValue(new ManualContributionNotPendingError('APPROVED'));

    const res = await post({ decision: 'approve' });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('MANUAL_CONTRIBUTION_NOT_PENDING');
  });

  it('answers 409 when the money has already been paid out and cannot be reversed', async () => {
    mockReverse.mockRejectedValue(new ManualContributionAlreadySpentError(250_000, 50_000));

    const res = await post({ decision: 'reverse', reason: 'Salah rekening' });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('MANUAL_CONTRIBUTION_ALREADY_SPENT');
  });

  it('passes the reason through, and does not decide a missing one itself', async () => {
    // The route holds no opinion about what a valid reason is: that judgement,
    // and its refusal, belong to the service layer, which is also where a
    // direct caller is held to it.
    expect((await post({ decision: 'reject', reason: 'Bukan untuk Campaign ini' })).status).toBe(200);
    expect(mockReject).toHaveBeenCalledWith(expect.anything(), {
      manualContributionId: 'mc-1',
      decidedById: 'admin-2',
      reason: 'Bukan untuk Campaign ini',
    });

    expect((await post({ decision: 'reverse', reason: 'Salah rekening tujuan' })).status).toBe(200);
    expect(mockReverse).toHaveBeenCalledWith(expect.anything(), {
      manualContributionId: 'mc-1',
      reversedById: 'admin-2',
      reason: 'Salah rekening tujuan',
    });
  });

  it('answers the refusal the service layer raises for a blank reason, with its own code', async () => {
    // Not the target's code: a mistyped note is a different mistake from a
    // contribution that names two targets, and a client fixing one should not
    // be sent looking for the other.
    mockReject.mockRejectedValue(new ManualContributionInputError('Alasan wajib diisi.'));

    const res = await post({ decision: 'reject' });

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('MANUAL_CONTRIBUTION_INVALID');
  });

  it('refuses a decision it does not know, rather than guessing at one', async () => {
    const res = await post({ decision: 'delete' });

    expect(res.status).toBe(400);
    expect(mockApprove).not.toHaveBeenCalled();
    expect(mockReject).not.toHaveBeenCalled();
    expect(mockReverse).not.toHaveBeenCalled();
  });
});
