import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { checklistItemRow, makeCampaignDb } from '../../../../../../tests/support/in-memory-campaign-db';

/**
 * Editing one checklist item and moving it, through the real handlers and the
 * real checklist module, with the session and the database stood in. The
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

import { PATCH } from './route';
import { POST as MOVE } from './move/route';
import { getServerSession } from '@/lib/auth';

const mockSession = getServerSession as unknown as Mock;

function patch(id: string, body: unknown): Promise<Response> {
  const req = new NextRequest(`http://localhost:3000/api/admin/verification-checklist/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id }) });
}

function move(id: string, body: unknown): Promise<Response> {
  const req = new NextRequest(`http://localhost:3000/api/admin/verification-checklist/${id}/move`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return MOVE(req, { params: Promise.resolve({ id }) });
}

const ITEMS = [
  checklistItemRow({ id: 'a', label: 'Pertama', position: 1 }),
  checklistItemRow({ id: 'b', label: 'Kedua', position: 2 }),
];

describe('/api/admin/verification-checklist/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.db = makeCampaignDb({ checklistItems: ITEMS });
    mockSession.mockResolvedValue({ user: { id: 'admin-1', assignments: ['ADMIN'] } });
  });

  it('PATCH rewords, marks optional and deactivates an item as the acting Admin', async () => {
    const res = await patch('b', { label: 'Kedua, revisi', required: false, active: false });

    expect(res.status).toBe(200);
    expect((await res.json()).item).toEqual({ id: 'b', label: 'Kedua, revisi', required: false, position: 2, active: false, kind: null });
    expect(state.db.checklistAudits).toEqual([expect.objectContaining({ itemId: 'b', action: 'UPDATED', actedById: 'admin-1' })]);
  });

  it('PATCH scopes an item to one Kind and back to general, refusing an unknown Kind', async () => {
    expect((await patch('b', { kind: 'ZAKAT' })).status).toBe(200);
    expect(state.db.checklistItems.find((i) => i.id === 'b')).toMatchObject({ kind: 'ZAKAT' });

    expect((await patch('b', { kind: null })).status).toBe(200);
    expect(state.db.checklistItems.find((i) => i.id === 'b')).toMatchObject({ kind: null });

    const res = await patch('b', { kind: 'SEDEKAH' });
    expect(res.status).toBe(400);
    expect(state.db.checklistItems.find((i) => i.id === 'b')).toMatchObject({ kind: null });
  });

  it('PATCH answers 404 for an unknown item and 400 for an empty change', async () => {
    expect((await patch('nope', { active: false })).status).toBe(404);
    expect((await patch('a', {})).status).toBe(400);
  });

  it('POST move swaps the item with its neighbour, answering the new order', async () => {
    const res = await move('b', { direction: 'up' });

    expect(res.status).toBe(200);
    expect((await res.json()).items.map((i: { id: string }) => i.id)).toEqual(['b', 'a']);
    expect(state.db.checklistAudits).toHaveLength(2);
  });

  it('POST move answers 400 for an unknown direction', async () => {
    expect((await move('b', { direction: 'left' })).status).toBe(400);
  });

  it.each([
    ['nobody signed in', null, 401],
    ['a Verifier without the ADMIN assignment', { user: { id: 'verifier-1', assignments: ['VERIFIER'] } }, 403],
  ])('refuses %s, writing nothing', async (_name, session, status) => {
    mockSession.mockResolvedValue(session);

    expect((await patch('a', { active: false })).status).toBe(status);
    expect((await move('b', { direction: 'up' })).status).toBe(status);
    expect(state.db.checklistItems).toEqual(ITEMS);
    expect(state.db.checklistAudits).toEqual([]);
  });
});
