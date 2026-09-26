import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { checklistItemRow, makeCampaignDb } from '../../../../../tests/support/in-memory-campaign-db';

/**
 * The Admin checklist editor's collection route, through the real handler and
 * the real checklist module, with the session and the database stood in. The
 * rules are the module's (src/lib/verification-checklist.test.ts); this file
 * proves the ADMIN gate and that requests reach the module.
 */
const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof makeCampaignDb> }));

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy(
    {},
    { get: (_target, key) => (state.db.prisma as Record<string | symbol, unknown>)[key] },
  ),
}));

import { GET, POST } from './route';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;
const URL = 'http://localhost:3000/api/admin/verification-checklist';

function post(body: unknown): Promise<Response> {
  return POST(new NextRequest(URL, { method: 'POST', body: JSON.stringify(body) }));
}

describe('/api/admin/verification-checklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.db = makeCampaignDb({
      checklistItems: [
        checklistItemRow({ id: 'b', label: 'Kedua', position: 2, active: false }),
        checklistItemRow({ id: 'a', label: 'Pertama', position: 1 }),
      ],
    });
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
  });

  it('lists every item, inactive ones included, in checklist order', async () => {
    const res = await GET(new NextRequest(URL));

    expect(res.status).toBe(200);
    expect((await res.json()).items.map((i: { id: string }) => i.id)).toEqual(['a', 'b']);
  });

  it('adds an item as the acting Admin, answering 201', async () => {
    const res = await post({ label: 'Surat keterangan RT', required: true });

    expect(res.status).toBe(201);
    expect((await res.json()).item).toMatchObject({ label: 'Surat keterangan RT', position: 3, active: true });
    expect(state.db.checklistAudits).toEqual([expect.objectContaining({ action: 'CREATED', actedById: 'admin-1' })]);
  });

  it('answers 400 with the reason for a blank label', async () => {
    const res = await post({ label: ' ', required: true });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Label item checklist wajib diisi.');
    expect(state.db.checklistItems).toHaveLength(2);
  });

  it('answers 400 for a body that is not JSON', async () => {
    const res = await POST(new NextRequest(URL, { method: 'POST', body: 'nope' }));

    expect(res.status).toBe(400);
  });

  it.each([
    ['nobody signed in', null, 401],
    ['a Verifier without the ADMIN assignment', { user: { id: 'verifier-1', assignments: ['VERIFIER'] } }, 403],
    ['a Fundraiser', { user: { id: 'creator-1', assignments: [] } }, 403],
  ])('refuses %s, reading and writing nothing', async (_name, session, status) => {
    mockSession.mockResolvedValue(session);

    expect((await GET(new NextRequest(URL))).status).toBe(status);
    expect((await post({ label: 'Surat keterangan RT', required: true })).status).toBe(status);
    expect(state.db.checklistItems).toHaveLength(2);
    expect(state.db.checklistAudits).toEqual([]);
  });
});
