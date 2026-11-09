import { describe, it, expect } from 'vitest';
import { CAMPAIGN_SORTS, DEFAULT_CAMPAIGN_SORT, parseCampaignSort, rankByCountedProgress } from './campaign-sort';

const row = (id: string, collectedAmount: number, targetAmount: number, createdAt = '2026-01-01T00:00:00Z') => ({
  id,
  collectedAmount,
  targetAmount,
  createdAt: new Date(createdAt),
});

describe('parseCampaignSort (PKS 3.7)', () => {
  it('defaults to terbaru when the parameter is absent or blank', () => {
    expect(parseCampaignSort(null)).toBe(DEFAULT_CAMPAIGN_SORT);
    expect(parseCampaignSort('')).toBe('terbaru');
  });

  it('accepts the four contract orders and refuses anything else', () => {
    for (const sort of CAMPAIGN_SORTS) expect(parseCampaignSort(sort)).toBe(sort);
    expect(CAMPAIGN_SORTS).toEqual(['terbaru', 'hampir-tercapai', 'terbanyak', 'segera-berakhir']);
    expect(parseCampaignSort('populer')).toBeNull();
    expect(parseCampaignSort('createdAt')).toBeNull();
  });
});

describe('rankByCountedProgress', () => {
  it('hampir-tercapai: the highest share of target below 100% first, targets already reached last', () => {
    const ranked = rankByCountedProgress(
      [row('a', 10, 100), row('b', 90, 100), row('reached', 500, 100), row('c', 50, 100)],
      'hampir-tercapai',
    );
    expect(ranked.map((r) => r.id)).toEqual(['b', 'c', 'a', 'reached']);
  });

  it('terbanyak: the largest collected amount first, newest first on a tie', () => {
    const ranked = rankByCountedProgress(
      [row('small', 10, 100), row('old', 300, 1000, '2026-01-01T00:00:00Z'), row('new', 300, 5000, '2026-02-01T00:00:00Z')],
      'terbanyak',
    );
    expect(ranked.map((r) => r.id)).toEqual(['new', 'old', 'small']);
  });

  it('does not mutate its input', () => {
    const input = [row('a', 1, 10), row('b', 9, 10)];
    rankByCountedProgress(input, 'terbanyak');
    expect(input.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
