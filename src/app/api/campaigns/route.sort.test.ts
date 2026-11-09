import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * GET /api/campaigns?sort= (PKS Pasal 3.7): each of the four orders, ranked on
 * the COUNTED figure where the order depends on money.
 */

const holder = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  sandboxGross: [] as Array<{ amount: number; donation: { campaignId: string } }>,
  findManyCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: {
      findMany: vi.fn(async (args: { select?: unknown; where: { id?: { in: string[] } }; skip?: number; take?: number }) => {
        holder.findManyCalls.push(args as Record<string, unknown>);
        const ids = args.where?.id?.in;
        if (ids) return ids.map((id) => holder.rows.find((r) => r.id === id)!);
        // Not a by-id read: the slim projection of every listed Campaign, or an
        // ordered page. The test double returns insertion order; the route must
        // not depend on the database for the money orders.
        return holder.rows;
      }),
      count: vi.fn(async () => holder.rows.length),
    },
    payment: { findMany: vi.fn(async () => holder.sandboxGross) },
  },
}));
vi.mock('@/lib/subject-guard', () => ({ listableCampaignWhere: vi.fn(async () => ({ lifecycleStatus: 'ACTIVE' })) }));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));

import { GET } from './route';

const row = (id: string, collectedAmount: number, targetAmount: number, createdAt: string, deadline: string | null = null) => ({
  id,
  slug: id,
  title: id,
  collectedAmount,
  targetAmount,
  createdAt: new Date(createdAt),
  deadline: deadline ? new Date(deadline) : null,
  creator: { name: 'x' },
});

async function get(query: string) {
  return GET(new NextRequest(new URL(`http://localhost:3000/api/campaigns${query}`)));
}
const slugs = async (query: string) => (await (await get(query)).json()).campaigns.map((c: { slug: string }) => c.slug);

beforeEach(() => {
  holder.findManyCalls = [];
  holder.sandboxGross = [];
  holder.rows = [
    row('a', 100, 1000, '2026-01-01T00:00:00Z', '2026-12-01T00:00:00Z'),
    row('b', 900, 1000, '2026-02-01T00:00:00Z', null),
    row('c', 500, 1000, '2026-03-01T00:00:00Z', '2026-11-20T00:00:00Z'),
  ];
});

describe('GET /api/campaigns?sort=', () => {
  it('terbaru (the default) orders by creation, newest first', async () => {
    await get('');
    expect(holder.findManyCalls[0].orderBy).toEqual({ createdAt: 'desc' });
    holder.findManyCalls = [];
    await get('?sort=terbaru');
    expect(holder.findManyCalls[0].orderBy).toEqual({ createdAt: 'desc' });
  });

  it('segera-berakhir orders by deadline ascending with no-deadline Campaigns last', async () => {
    await get('?sort=segera-berakhir');
    expect(holder.findManyCalls[0].orderBy).toEqual([
      { deadline: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'desc' },
    ]);
  });

  it('hampir-tercapai ranks by share of target collected', async () => {
    expect(await slugs('?sort=hampir-tercapai')).toEqual(['b', 'c', 'a']);
  });

  it('terbanyak ranks by collected amount', async () => {
    expect(await slugs('?sort=terbanyak')).toEqual(['b', 'c', 'a']);
  });

  it('ranks on the counted figure: beta money in the stored counter does not lift a Campaign', async () => {
    // b's 900 is 850 of sandbox money: counted, it is 50 and falls last.
    holder.sandboxGross = [{ amount: 850, donation: { campaignId: 'b' } }];
    expect(await slugs('?sort=terbanyak')).toEqual(['c', 'a', 'b']);
    expect(await slugs('?sort=hampir-tercapai')).toEqual(['c', 'a', 'b']);
  });

  it('pages the ranked list: page 2 of limit 1 is the second Campaign', async () => {
    const body = await (await get('?sort=terbanyak&limit=1&page=2')).json();
    expect(body.campaigns.map((c: { slug: string }) => c.slug)).toEqual(['c']);
    expect(body.total).toBe(3);
    expect(body.totalPages).toBe(3);
  });

  it('refuses an unknown order with 400', async () => {
    const response = await get('?sort=populer');
    expect(response.status).toBe(400);
  });
});
