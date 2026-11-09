import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/admin/webhook-events/[id]/resolve -- thin route over
 * resolveWebhookEvent (rules and the race are tested against a real Postgres in
 * src/__tests__/integration/failed-notification-queue-real-db.test.ts). This pins
 * the literal 404 for anyone without ADMIN, that the actor is the session's and
 * the note is the body's, and that a refusal is answered as one.
 */

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/money/payment-reconciliation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/money/payment-reconciliation')>();
  return { ...actual, resolveWebhookEvent: vi.fn() };
});

import { POST } from './route';
import { getServerSession } from '@/lib/auth';
import { resolveWebhookEvent } from '@/lib/money/payment-reconciliation';
import { WebhookEventNotOpenError, WebhookResolutionInvalidError } from '@/lib/money/errors';

const mockSession = getServerSession as unknown as Mock;
const mockResolve = resolveWebhookEvent as unknown as Mock;

function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest('http://localhost:3000/api/admin/webhook-events/e1/resolve', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'e1' }) },
  );
}

describe('POST /api/admin/webhook-events/[id]/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
    mockResolve.mockResolvedValue(undefined);
  });

  it('answers 401 with no session and a literal 404 without the ADMIN assignment', async () => {
    mockSession.mockResolvedValue(null);
    expect((await post({ note: 'x' })).status).toBe(401);

    mockSession.mockResolvedValue({ user: { id: 'verifier-1', assignments: ['VERIFIER'] } });
    const res = await post({ note: 'x' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not Found' });
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('closes the event as the signed-in Admin with the note from the body', async () => {
    const res = await post({ note: 'Refund penuh di dashboard', actorId: 'someone-else' });

    expect(res.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith(expect.anything(), {
      eventId: 'e1',
      actorId: 'admin-1',
      note: 'Refund penuh di dashboard',
    });
  });

  it('treats a missing or non-string note as an empty one, which the rule refuses', async () => {
    mockResolve.mockRejectedValue(new WebhookResolutionInvalidError('Catatan wajib diisi.'));

    const res = await post({ note: 42 });

    expect(mockResolve).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ note: '' }));
    expect(res.status).toBe(400);
  });

  it('answers an event that is already closed as 409, not a 500', async () => {
    mockResolve.mockRejectedValue(new WebhookEventNotOpenError('e1'));

    const res = await post({ note: 'x' });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'WEBHOOK_EVENT_NOT_OPEN' });
  });
});
