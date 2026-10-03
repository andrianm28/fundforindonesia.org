import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

/**
 * The public Volunteer Trip catalog, /volunteer-trip (ticket 33): a card per
 * Trip the catalog read returns -- title, destination, Trip Fee, nearest Batch
 * date -- each linking to its detail page. Nothing here starts a Registration.
 */

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
const catalog = vi.hoisted(() => ({ listCatalogTrips: vi.fn() }));
vi.mock('@/lib/volunteer/catalog', () => catalog);

import VolunteerCatalogPage, * as pageModule from './page';

const card = {
  slug: 'mengajar-di-pulau-terpencil',
  title: 'Mengajar di Pulau Terpencil',
  destination: 'Pulau Sebatik',
  coverImage: 'https://example.com/cover.jpg',
  tripFeeAmount: 2_500_000,
  nearestBatchStart: new Date(2026, 11, 1),
};

beforeEach(() => catalog.listCatalogTrips.mockReset());
afterEach(cleanup);

describe('/volunteer-trip', () => {
  it('is rendered per request, since it reads the database', () => {
    expect(pageModule.dynamic).toBe('force-dynamic');
  });

  it('shows each Trip with destination, Trip Fee and nearest Batch date, linked to its detail page', async () => {
    catalog.listCatalogTrips.mockResolvedValue([card]);

    const { container } = render(await VolunteerCatalogPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Volunteer Trip' })).toBeInTheDocument();
    expect(screen.getByText('Mengajar di Pulau Terpencil')).toBeInTheDocument();
    expect(screen.getByText('Pulau Sebatik')).toBeInTheDocument();
    expect(screen.getByText('Rp2.500.000')).toBeInTheDocument();
    expect(screen.getByText(/1 Des 2026/)).toBeInTheDocument();
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/volunteer-trip/mengajar-di-pulau-terpencil']);
  });

  it('shows the nearest Batch start as its WIB date across the UTC day boundary', async () => {
    // 1 Des 2026 00:00 WIB is still 30 Nov in UTC.
    catalog.listCatalogTrips.mockResolvedValue([{ ...card, nearestBatchStart: new Date('2026-11-30T17:00:00Z') }]);

    render(await VolunteerCatalogPage());

    expect(screen.getByText('Batch terdekat: 1 Des 2026')).toBeInTheDocument();
  });

  it('says so when no Trip is taking Registrations', async () => {
    catalog.listCatalogTrips.mockResolvedValue([]);

    render(await VolunteerCatalogPage());

    expect(screen.getByText(/Belum ada Volunteer Trip/)).toBeInTheDocument();
  });

  it('offers no Daftar action', async () => {
    catalog.listCatalogTrips.mockResolvedValue([card]);

    render(await VolunteerCatalogPage());

    expect(screen.queryByText(/Daftar/)).toBeNull();
  });
});
