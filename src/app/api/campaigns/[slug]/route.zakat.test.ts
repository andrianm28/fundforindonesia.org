import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/** GET /api/campaigns/[slug] for a zakat Campaign: 404 while the zakat module is OFF (ADR 0028). */

const holder = vi.hoisted(() => ({ operations: null as unknown }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: vi.fn(), update: vi.fn() },
    payment: { findMany: vi.fn().mockResolvedValue([]) },
    platformFeeRule: { findFirst: vi.fn().mockResolvedValue(null) },
    platformFeeThreshold: { findFirst: vi.fn().mockResolvedValue(null) },
    escrowHoldSetting: { findFirst: vi.fn().mockResolvedValue(null) },
    siteSetting: {
      findUnique: vi.fn(async () =>
        holder.operations ? { key: 'operations', value: holder.operations, updatedAt: new Date(1) } : null,
      ),
    },
  },
}));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn().mockResolvedValue(null) }));

import { GET } from './route';
import { prisma } from '@/lib/prisma';

const campaign = {
  id: 'campaign-1',
  slug: 'zakat-yayasan',
  title: 'Zakat melalui Yayasan',
  description: 'Deskripsi',
  story: '<p>Cerita</p>',
  coverImage: 'https://example.com/a.jpg',
  targetAmount: 50_000_000,
  collectedAmount: 0,
  category: 'bencana-alam',
  kind: 'ZAKAT',
  lifecycleStatus: 'ACTIVE',
  isUrgent: false,
  isDemo: false,
  deadline: null,
  creatorId: 'user-1',
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  creator: { id: 'user-1', name: 'Yayasan', avatar: null },
  collectingEntity: null,
  _count: { donations: 0 },
};

const get = () =>
  GET(new NextRequest('http://localhost:3000/api/campaigns/zakat-yayasan'), {
    params: Promise.resolve({ slug: 'zakat-yayasan' }),
  });

beforeEach(() => {
  holder.operations = null;
  vi.mocked(prisma.campaign.findUnique).mockResolvedValue(campaign as never);
});

describe('GET /api/campaigns/[slug] for a zakat Campaign', () => {
  it('answers 404, as for a missing Campaign, while the module is OFF', async () => {
    const response = await get();
    expect(response.status).toBe(404);
  });

  it('answers the Campaign once the module is ON', async () => {
    holder.operations = {
      donationsOpen: true,
      maintenance: { on: false, message: '' },
      zakat: { enabled: true, nisabAmount: 85_000_000, recipientOrganisationId: 'org-1' },
      history: [],
    };
    const response = await get();
    expect(response.status).toBe(200);
  });
});
