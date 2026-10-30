import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/campaigns/[slug]/short-links (ticket E1/02): the short link per
 * share channel ShareModal hands out. Anyone may share a public Campaign,
 * so no session is asked for; a Campaign that is not public does not exist
 * here, the same 404 every other Campaign read gives.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: { campaign: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/short-links', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/short-links')>()),
  ensureShareLinks: vi.fn(),
}));

import { POST } from './route';
import { prisma } from '@/lib/prisma';
import { ensureShareLinks } from '@/lib/short-links';

const findCampaign = prisma.campaign.findUnique as unknown as Mock;
const mockEnsure = ensureShareLinks as unknown as Mock;

function call(slug = 'test-slug') {
  return POST(new NextRequest(`http://localhost:3000/api/campaigns/${slug}/short-links`, { method: 'POST' }), {
    params: Promise.resolve({ slug }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://fundforindonesia.org');
  findCampaign.mockResolvedValue({ id: 'campaign-1', lifecycleStatus: 'ACTIVE', deadline: null });
  mockEnsure.mockResolvedValue({ whatsapp: 'Wa234567', facebook: 'Fb234567', twitter: 'Tw234567', copy: 'Cp234567' });
});

describe('POST /api/campaigns/[slug]/short-links', () => {
  it('answers one absolute short link per share channel', async () => {
    const response = await call();

    expect(response.status).toBe(200);
    expect(mockEnsure).toHaveBeenCalledWith('campaign-1');
    expect(await response.json()).toEqual({
      links: {
        whatsapp: 'https://fundforindonesia.org/s/Wa234567',
        facebook: 'https://fundforindonesia.org/s/Fb234567',
        twitter: 'https://fundforindonesia.org/s/Tw234567',
        copy: 'https://fundforindonesia.org/s/Cp234567',
      },
    });
  });

  it('answers 404 for a slug that does not exist', async () => {
    findCampaign.mockResolvedValue(null);

    expect((await call('nope')).status).toBe(404);
    expect(mockEnsure).not.toHaveBeenCalled();
  });

  it('answers the same 404 for a Campaign that is not public, and makes no link for it', async () => {
    findCampaign.mockResolvedValue({ id: 'campaign-1', lifecycleStatus: 'SUBMITTED', deadline: null });

    expect((await call()).status).toBe(404);
    expect(mockEnsure).not.toHaveBeenCalled();
  });

  it('answers 500 without detail when making the links fails', async () => {
    mockEnsure.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await call();

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('db down');
  });
});
