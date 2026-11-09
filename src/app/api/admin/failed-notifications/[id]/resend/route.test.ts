import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/admin/failed-notifications/[id]/resend -- thin route over
 * resendFailedNotification. The queue's rules and its concurrency are tested
 * against a real Postgres (src/__tests__/integration/failed-notification-queue-real-db.test.ts);
 * this pins the literal 404 for anyone without ADMIN, that the actor is the
 * session's and never the body's, and that a refusal is a refusal, not a 500.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/failed-notifications', () => ({ resendFailedNotification: vi.fn() }));

import { POST } from './route';
import { getServerSession } from '@/lib/auth';
import { resendFailedNotification } from '@/lib/failed-notifications';
import { NotificationNotResendableError } from '@/lib/money/errors';

const mockSession = getServerSession as unknown as Mock;
const mockResend = resendFailedNotification as unknown as Mock;

function post(): Promise<Response> {
  return POST(
    new NextRequest('http://localhost:3000/api/admin/failed-notifications/n1/resend', {
      method: 'POST',
      body: JSON.stringify({ actorId: 'someone-else' }),
    }),
    { params: Promise.resolve({ id: 'n1' }) },
  );
}

describe('POST /api/admin/failed-notifications/[id]/resend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockResend.mockResolvedValue('SENT');
  });

  it('answers 401 with no session and a literal 404 without the ADMIN assignment', async () => {
    mockSession.mockResolvedValue(null);
    expect((await post()).status).toBe(401);

    mockSession.mockResolvedValue({ user: { id: 'verifier-1', assignments: ['VERIFIER'] } });
    const res = await post();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not Found' });
    expect(mockResend).not.toHaveBeenCalled();
  });

  it('resends as the signed-in Admin, whatever the body says, and reports the outcome', async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: 'SENT' });
    expect(mockResend).toHaveBeenCalledWith('n1', 'admin-1');
  });

  it('answers 200 with FAILED when the provider refused again, so the screen can say so', async () => {
    mockResend.mockResolvedValue('FAILED');

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: 'FAILED' });
  });

  it('answers a refusal as 409, not a 500', async () => {
    mockResend.mockRejectedValue(new NotificationNotResendableError('n1'));

    const res = await post();

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'NOTIFICATION_NOT_RESENDABLE' });
  });
});
