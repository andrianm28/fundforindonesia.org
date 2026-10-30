// @vitest-environment node
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

/**
 * Short links (ticket E1/02, PRD FFI-06): `/s/<code>` on the apex domain
 * stands in for a long shared Campaign link and carries the same Traffic
 * Source the long link would, so the Donation it produces records it.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    shortLink: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import {
  SHARE_CHANNELS,
  ensureShareLinks,
  followShortLink,
  generateShortCode,
  isWellFormedShortCode,
  shortLinkPath,
} from './short-links';

const findMany = prisma.shortLink.findMany as unknown as Mock;
const create = prisma.shortLink.create as unknown as Mock;
const findUnique = prisma.shortLink.findUnique as unknown as Mock;
const update = prisma.shortLink.update as unknown as Mock;

const NOW = new Date('2026-10-30T00:00:00Z');

function uniqueViolation(target: string[]) {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateShortCode', () => {
  it('makes well-formed codes that differ from call to call', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateShortCode()));
    expect(codes.size).toBe(50);
    for (const code of codes) expect(isWellFormedShortCode(code)).toBe(true);
  });

  it('never uses look-alike characters a reader could mistype', () => {
    for (let i = 0; i < 200; i++) expect(generateShortCode()).not.toMatch(/[0O1lI]/);
  });
});

describe('isWellFormedShortCode', () => {
  it.each(['', 'abc', 'a/b', '../x', 'x'.repeat(40), 'abc def', 'abcO0123'])('refuses %j', (code) => {
    expect(isWellFormedShortCode(code)).toBe(false);
  });
});

describe('shortLinkPath', () => {
  it('is the apex-domain prefix the owner chose', () => {
    expect(shortLinkPath('Abc23xyz')).toBe('/s/Abc23xyz');
  });
});

describe('ensureShareLinks', () => {
  it('creates one link per share channel the first time and returns every code', async () => {
    findMany.mockResolvedValue([]);
    create.mockImplementation(async ({ data }) => ({ ...data }));

    const links = await ensureShareLinks('campaign-1');

    expect(create).toHaveBeenCalledTimes(SHARE_CHANNELS.length);
    expect(Object.keys(links).sort()).toEqual([...SHARE_CHANNELS].sort());
    for (const channel of SHARE_CHANNELS) {
      expect(create).toHaveBeenCalledWith({
        data: { campaignId: 'campaign-1', source: channel, code: links[channel] },
      });
    }
  });

  it('reuses the links that already exist, so a shared code stays stable', async () => {
    findMany.mockResolvedValue(SHARE_CHANNELS.map((source, i) => ({ source, code: `Code${i}abc` })));

    const links = await ensureShareLinks('campaign-1');

    expect(create).not.toHaveBeenCalled();
    expect(links.whatsapp).toBe('Code0abc');
  });

  it('tries a fresh code when a random one is already taken', async () => {
    findMany.mockResolvedValue(SHARE_CHANNELS.filter((s) => s !== 'copy').map((source) => ({ source, code: `${source}xyz` })));
    create.mockRejectedValueOnce(uniqueViolation(['code'])).mockImplementation(async ({ data }) => ({ ...data }));

    const links = await ensureShareLinks('campaign-1');

    expect(create).toHaveBeenCalledTimes(2);
    expect(isWellFormedShortCode(links.copy)).toBe(true);
  });

  it('takes the winner when a concurrent share created the same channel first', async () => {
    findMany.mockResolvedValueOnce(SHARE_CHANNELS.filter((s) => s !== 'copy').map((source) => ({ source, code: `${source}xyz` })));
    create.mockRejectedValueOnce(uniqueViolation(['campaignId', 'source']));
    findUnique.mockResolvedValueOnce({ code: 'Winner23' });

    const links = await ensureShareLinks('campaign-1');

    expect(findUnique).toHaveBeenCalledWith({
      where: { campaignId_source: { campaignId: 'campaign-1', source: 'copy' } },
      select: { code: true },
    });
    expect(links.copy).toBe('Winner23');
  });

  it('rethrows anything that is not a unique violation', async () => {
    findMany.mockResolvedValue([]);
    create.mockRejectedValue(new Error('db down'));

    await expect(ensureShareLinks('campaign-1')).rejects.toThrow('db down');
  });
});

describe('followShortLink', () => {
  const link = {
    id: 'link-1',
    source: 'whatsapp',
    campaign: { slug: 'bantu korban', lifecycleStatus: 'ACTIVE', deadline: null },
  };

  it('answers the Campaign page with the link source as src, and counts the visit', async () => {
    findUnique.mockResolvedValue(link);

    const target = await followShortLink('Abc23xyz', NOW);

    expect(target).toBe('/campaign/bantu%20korban?src=whatsapp');
    expect(update).toHaveBeenCalledWith({ where: { id: 'link-1' }, data: { clickCount: { increment: 1 } } });
  });

  it('answers null for an unknown code', async () => {
    findUnique.mockResolvedValue(null);

    expect(await followShortLink('Abc23xyz', NOW)).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('never reaches the database for a malformed code', async () => {
    expect(await followShortLink('../admin', NOW)).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('answers null for a Campaign that is no longer public, without saying it exists', async () => {
    findUnique.mockResolvedValue({ ...link, campaign: { ...link.campaign, lifecycleStatus: 'DRAFT' } });

    expect(await followShortLink('Abc23xyz', NOW)).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('still redirects an Expired Campaign, whose page stays public', async () => {
    findUnique.mockResolvedValue({
      ...link,
      campaign: { ...link.campaign, deadline: new Date('2026-01-01T00:00:00Z') },
    });

    expect(await followShortLink('Abc23xyz', NOW)).toBe('/campaign/bantu%20korban?src=whatsapp');
  });

  it('still redirects when counting the visit fails', async () => {
    findUnique.mockResolvedValue(link);
    update.mockRejectedValue(new Error('db busy'));

    expect(await followShortLink('Abc23xyz', NOW)).toBe('/campaign/bantu%20korban?src=whatsapp');
  });
});
