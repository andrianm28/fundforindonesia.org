import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * A Campaign of Kind ZAKAT can be drafted only while the zakat module is ON
 * and only by an institution (PKS pemenuhan 19, ADR 0028). It then rides the
 * ordinary lifecycle: a Verifier approves it like any other Kind.
 */

const holder = vi.hoisted(() => ({ operations: null as unknown }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { create: vi.fn() },
    category: { findUnique: vi.fn() },
    partnerOrganisation: { findUnique: vi.fn() },
    siteSetting: {
      findUnique: vi.fn(async () =>
        holder.operations ? { key: 'operations', value: holder.operations, updatedAt: new Date(1) } : null,
      ),
    },
  },
}));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));

import { POST } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

const BODY = {
  title: 'Zakat melalui Yayasan Contoh',
  description: 'Penghimpunan zakat',
  story: '<p>Zakat disalurkan kepada mustahik oleh lembaga berizin.</p>',
  coverImage: 'https://example.com/image.jpg',
  targetAmount: 50_000_000,
  category: 'bencana-alam',
  kind: 'ZAKAT',
  deadline: new Date(Date.now() + 90 * 86_400_000).toISOString(),
};

const post = () =>
  POST(
    new NextRequest('http://localhost:3000/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BODY),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  holder.operations = null;
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'user-1' }, expires: '2099-01-01' } as never);
  vi.mocked(prisma.category.findUnique).mockResolvedValue({ id: 'cat-1', slug: 'bencana-alam' } as never);
  vi.mocked(prisma.partnerOrganisation.findUnique).mockResolvedValue({ id: 'org-1', acceptsIndividualCampaigns: false } as never);
  vi.mocked(prisma.campaign.create).mockResolvedValue({ id: 'campaign-9' } as never);
});

describe('POST /api/campaigns with Kind ZAKAT', () => {
  it('is refused as an unknown Kind while the module is OFF (the default), creating nothing', async () => {
    const response = await post();

    expect(response.status).toBe(400);
    expect(prisma.campaign.create).not.toHaveBeenCalled();
  });

  it('creates a Draft of Kind ZAKAT once the module is ON', async () => {
    holder.operations = {
      donationsOpen: true,
      maintenance: { on: false, message: '' },
      zakat: { enabled: true, nisabAmount: 85_000_000, recipientOrganisationId: 'org-1' },
      history: [],
    };

    const response = await post();

    expect(response.status).toBe(201);
    const { data } = vi.mocked(prisma.campaign.create).mock.calls[0][0];
    expect(data.kind).toBe('ZAKAT');
    expect(data.lifecycleStatus).toBe('DRAFT');
  });
});
