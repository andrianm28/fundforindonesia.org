import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { makeCampaignDb } from '../../../../../tests/support/in-memory-campaign-db';

/**
 * The Verifier's Partner Organisation register, through the real handler and
 * module with the session and database stood in. The rules are the module's
 * (src/lib/partner-organisations.test.ts); this proves the VERIFIER gate and
 * that refusals answer with their code.
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
const URL = 'http://localhost:3000/api/moderasi/partner-organisations';
const BODY = { name: 'Yayasan Indonesia Emas Merdeka', fundraiserEmail: 'yiem@example.org', acceptsIndividualCampaigns: true };

function post(body: unknown): Promise<Response> {
  return POST(new NextRequest(URL, { method: 'POST', body: JSON.stringify(body) }));
}

describe('POST /api/moderasi/partner-organisations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.db = makeCampaignDb({
      partnerOrganisations: [],
      users: [{ id: 'yiem-account', email: 'yiem@example.org', name: 'YIEM' }],
    });
    mockSession.mockResolvedValue({ user: { id: 'verifier-1', assignments: ['VERIFIER'] } });
  });

  it('registers the organisation as the acting Verifier, answering 201', async () => {
    const res = await post(BODY);

    expect(res.status).toBe(201);
    expect((await res.json()).organisation).toMatchObject({ name: BODY.name, fundraiserId: 'yiem-account' });
    expect(state.db.partnerOrganisationAudits).toEqual([
      expect.objectContaining({ action: 'REGISTERED', actedById: 'verifier-1' }),
    ]);
  });

  it('answers a refusal with its status and code', async () => {
    const res = await post({ ...BODY, fundraiserEmail: 'nobody@example.org' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Tidak ada akun dengan email itu.', code: 'PARTNER_ORGANISATION_INVALID' });
  });

  it.each([
    ['an Admin who is not a Verifier', { user: { id: 'admin-1', assignments: ['ADMIN'] } }, 403],
    ['nobody signed in', null, 401],
  ])('refuses %s, writing nothing', async (_who, session, status) => {
    mockSession.mockResolvedValue(session);

    const res = await post(BODY);

    expect(res.status).toBe(status);
    expect(state.db.partnerOrganisations).toEqual([]);
  });
});
