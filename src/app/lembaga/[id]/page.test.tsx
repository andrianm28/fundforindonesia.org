import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The public organisation profile page (PKS Pasal 12(5)): shows the name,
 * permit number, issuer, validity and status and the active Campaigns,
 * renders whatever is stored honestly, and nothing private.
 */

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
const lookup = vi.hoisted(() => ({ getOrganisationProfile: vi.fn() }));
vi.mock('@/lib/organisation-profile', () => lookup);
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import OrganisationPage, { generateMetadata } from './page';

const params = (id = 'org1') => ({ params: Promise.resolve({ id }) });
const permit = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  number: 'SK-123/2026',
  issuer: 'Kementerian Sosial',
  kinds: ['DONATION'],
  validFrom: new Date('2026-01-01T00:00:00Z'),
  validTo: new Date('2026-12-31T00:00:00Z'),
  status: 'valid',
  ...over,
});
const profile = (over: Record<string, unknown> = {}) => ({
  id: 'org1',
  name: 'Yayasan Contoh',
  permitStatus: 'valid',
  permits: [permit()],
  campaigns: [{ slug: 'sumur-desa', title: 'Sumur untuk Desa' }],
  ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('/lembaga/[id]', () => {
  it('404s for an unknown organisation', async () => {
    lookup.getOrganisationProfile.mockResolvedValue(null);
    await expect(OrganisationPage(params('nope'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows name, permit number, issuer, validity, kind and active campaigns', async () => {
    lookup.getOrganisationProfile.mockResolvedValue(profile());
    render(await OrganisationPage(params()));
    expect(screen.getByRole('heading', { level: 1, name: 'Yayasan Contoh' })).toBeDefined();
    expect(screen.getByText(/SK-123\/2026/)).toBeDefined();
    expect(screen.getByText(/Kementerian Sosial/)).toBeDefined();
    expect(screen.getByText(/1 Jan 2026/)).toBeDefined();
    expect(screen.getByText(/31 Des 2026/)).toBeDefined();
    expect(screen.getByText('Berlaku')).toBeDefined();
    const link = screen.getByRole('link', { name: /Sumur untuk Desa/ });
    expect(link.getAttribute('href')).toBe('/campaign/sumur-desa');
  });

  it('marks an expired permit clearly', async () => {
    lookup.getOrganisationProfile.mockResolvedValue(
      profile({ permitStatus: 'none_valid', permits: [permit({ status: 'expired' })] }),
    );
    render(await OrganisationPage(params()));
    expect(screen.getByText('Kedaluwarsa')).toBeDefined();
    expect(screen.getByText(/tidak memiliki izin penghimpunan yang berlaku/i)).toBeDefined();
  });

  it('says honestly that no permit is on record', async () => {
    lookup.getOrganisationProfile.mockResolvedValue(profile({ permitStatus: 'none', permits: [], campaigns: [] }));
    render(await OrganisationPage(params()));
    expect(screen.getByText(/belum ada nomor izin penghimpunan yang tercatat/i)).toBeDefined();
    expect(screen.getByText(/tidak ada kampanye aktif/i)).toBeDefined();
  });

  it('renders stored text as text, not markup', async () => {
    lookup.getOrganisationProfile.mockResolvedValue(
      profile({ name: '<img src=x onerror=alert(1)>', permits: [permit({ number: '<b>X</b>' })] }),
    );
    const { container } = render(await OrganisationPage(params()));
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(within(container).getByText(/<b>X<\/b>/)).toBeDefined();
  });

  it('is indexable and titled with the organisation name', async () => {
    lookup.getOrganisationProfile.mockResolvedValue(profile());
    const meta = await generateMetadata(params());
    expect(String(meta.title)).toContain('Yayasan Contoh');
    expect(meta.robots).toBeUndefined();
  });
});
