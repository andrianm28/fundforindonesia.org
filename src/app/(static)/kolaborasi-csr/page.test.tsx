import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Page, { metadata } from './page';

describe('/kolaborasi-csr landing', () => {
  it('has a heading, a status box and a next step', () => {
    render(<Page />);

    expect(screen.getByRole('heading', { level: 1, name: 'Kolaborasi CSR' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Status' })).toHaveTextContent('Status saat ini');
    expect(screen.getByRole('link', { name: 'Lihat portofolio Program' })).toHaveAttribute('href', '/program');
  });

  it('offers the four pillars as cards, each leading to its Sector on the portfolio', () => {
    render(<Page />);

    const section = screen.getByRole('heading', { name: 'Pilih pilar kolaborasi' }).closest('section')!;
    const cards = within(section).getAllByRole('listitem');
    expect(cards.map((c) => within(c).getByRole('heading').textContent)).toEqual([
      'Kesehatan',
      'Pendidikan',
      'Lingkungan',
      'Inklusi Penyandang Disabilitas',
    ]);
    expect(within(cards[3]).getByRole('link')).toHaveAttribute('href', '/program#inklusi-penyandang-disabilitas');
  });

  it('has SEO metadata', () => {
    expect(String(metadata.title)).toContain('Kolaborasi CSR');
    expect(metadata.description).toBeTruthy();
  });
});
