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

  it('does not include an Experience tile -- it is relabeled Volunteer', () => {
    const labels = quickActionTiles.map((tile) => tile.label);
    expect(labels).not.toContain('Experience');
    expect(labels).toContain('Volunteer');
  });

  it('keeps Donasi, Zakat, and Galang Dana as real, working links', () => {
    const donasi = quickActionTiles.find((tile) => tile.label === 'Donasi');
    const zakat = quickActionTiles.find((tile) => tile.label === 'Zakat');
    const galangDana = quickActionTiles.find((tile) => tile.label === 'Galang Dana');

    expect(donasi).toMatchObject({ href: '/explore/all', comingSoon: undefined });
    expect(zakat).toMatchObject({ href: '/zakat', comingSoon: undefined });
    expect(galangDana).toMatchObject({ href: '/campaign/create', comingSoon: undefined });
  });

  it('marks Volunteer and Kolaborasi CSR as coming soon, with no href', () => {
    const volunteer = quickActionTiles.find((tile) => tile.label === 'Volunteer');
    const csr = quickActionTiles.find((tile) => tile.label === 'Kolaborasi CSR');

    expect(volunteer).toMatchObject({ comingSoon: true });
    expect(csr).toMatchObject({ comingSoon: true });
    expect(volunteer).not.toHaveProperty('href');
    expect(csr).not.toHaveProperty('href');
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
