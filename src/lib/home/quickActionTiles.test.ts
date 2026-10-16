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

  it('does not include a Zakat or Volunteer tile -- Zakat is out of scope, Volunteer moved to a secondary menu', () => {
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

  it('links Kolaborasi CSR, Wakaf, and Hibah to their own landings', () => {
    const hrefOf = (label: string) => {
      const tile = quickActionTiles.find((t) => t.label === label);
      return tile && !tile.comingSoon ? tile.href : undefined;
    };

    expect(hrefOf('Kolaborasi CSR')).toBe('/kolaborasi-csr');
    expect(hrefOf('Wakaf')).toBe('/wakaf');
    expect(hrefOf('Hibah')).toBe('/hibah');
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
