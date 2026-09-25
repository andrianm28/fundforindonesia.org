import { describe, it, expect } from 'vitest';
import { quickActionTiles } from './quickActionTiles';

describe('quickActionTiles', () => {
  it('has exactly five tiles', () => {
    expect(quickActionTiles).toHaveLength(5);
  });

  it('does not include an Asuransi tile', () => {
    const labels = quickActionTiles.map((tile) => tile.label);
    expect(labels).not.toContain('Asuransi');
  });

  it('does not include a Zakat or Volunteer tile -- Zakat is folded under Donasi, Volunteer moved to a secondary menu', () => {
    const labels = quickActionTiles.map((tile) => tile.label);
    expect(labels).not.toContain('Zakat');
    expect(labels).not.toContain('Volunteer');
    expect(labels).not.toContain('Experience');
  });

  it('keeps Donasi and Galang Dana as real, working links', () => {
    const donasi = quickActionTiles.find((tile) => tile.label === 'Donasi');
    const galangDana = quickActionTiles.find((tile) => tile.label === 'Galang Dana');

    expect(donasi).toMatchObject({ href: '/explore/all' });
    expect(donasi?.comingSoon).toBeFalsy();
    expect(galangDana).toMatchObject({ href: '/campaign/create' });
    expect(galangDana?.comingSoon).toBeFalsy();
  });

  it('marks Kolaborasi CSR, Wakaf, and Hibah as coming soon, with no href', () => {
    const csr = quickActionTiles.find((tile) => tile.label === 'Kolaborasi CSR');
    const wakaf = quickActionTiles.find((tile) => tile.label === 'Wakaf');
    const hibah = quickActionTiles.find((tile) => tile.label === 'Hibah');

    expect(csr).toMatchObject({ comingSoon: true });
    expect(wakaf).toMatchObject({ comingSoon: true });
    expect(hibah).toMatchObject({ comingSoon: true });
    expect(csr).not.toHaveProperty('href');
    expect(wakaf).not.toHaveProperty('href');
    expect(hibah).not.toHaveProperty('href');
  });

  it('gives every real tile a Ledger Line brand color, not the old generic pastels', () => {
    const oldPastels = ['#E3F2FD', '#E8F5E9', '#FFF3E0', '#E0F7FA', '#FCE4EC', '#E8EAF6'];
    quickActionTiles.forEach((tile) => {
      if (!tile.comingSoon) {
        expect(oldPastels).not.toContain(tile.color);
      }
    });
  });
});
