import { render, screen, within, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_SITE_SETTINGS } from '@/lib/site-settings';

const mockResolve = vi.fn();
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/site-settings', async (orig) => ({
  ...(await orig<typeof import('@/lib/site-settings')>()),
  resolveSiteSettingsOrDefaults: (...a: unknown[]) => mockResolve(...a),
}));

import Page, { metadata } from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function settings(contact: Partial<typeof DEFAULT_SITE_SETTINGS.contact> = {}) {
  return { ...DEFAULT_SITE_SETTINGS, contact: { ...DEFAULT_SITE_SETTINGS.contact, ...contact } };
}

describe('/wakaf landing', () => {
  it('has a heading and a status box that still says wakaf is not open for money', async () => {
    mockResolve.mockResolvedValue(settings());
    render(await Page());

    expect(screen.getByRole('heading', { level: 1, name: 'Wakaf' })).toBeInTheDocument();
    const status = screen.getByRole('complementary', { name: 'Status' });
    expect(status).toHaveTextContent('Status saat ini');
    expect(status).toHaveTextContent('Wakaf belum dibuka untuk umum');
  });

  it('shows the four wakaf categories as cards, not a plain list', async () => {
    mockResolve.mockResolvedValue(settings());
    render(await Page());

    const section = screen.getByRole('heading', { name: 'Empat kategori wakaf' }).closest('section')!;
    const cards = within(section).getAllByRole('listitem');
    expect(cards.map((c) => within(c).getByRole('heading').textContent)).toEqual([
      'Masjid',
      'Sekolah',
      'Fasilitas Kesehatan',
      'Fasilitas Umum',
    ]);
    for (const card of cards) expect(card.querySelector('svg')).not.toBeNull();
  });

  it('invites land wakaf with two buttons that reach the team, never a payment page', async () => {
    mockResolve.mockResolvedValue(settings({ email: 'halo@contoh.id', whatsapp: '0812 3456 7890' }));
    render(await Page());

    expect(
      screen.getByRole('heading', { name: 'Wakafkan Tanah Anda, Hadirkan Manfaat dan Pahala yang Terus Mengalir' }),
    ).toBeInTheDocument();
    const apply = screen.getByRole('link', { name: 'Ajukan Wakaf Tanah Anda' });
    const consult = screen.getByRole('link', { name: 'Konsultasi Wakaf Tanah' });
    expect(apply.getAttribute('href')).toMatch(/^mailto:halo@contoh\.id\?subject=Pengajuan%20Wakaf%20Tanah/);
    expect(consult.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/6281234567890\?text=/);
  });

  it('falls back to email for consultation when no WhatsApp number is set', async () => {
    mockResolve.mockResolvedValue(settings({ email: 'halo@contoh.id', whatsapp: '' }));
    render(await Page());

    expect(screen.getByRole('link', { name: 'Konsultasi Wakaf Tanah' }).getAttribute('href')).toMatch(
      /^mailto:halo@contoh\.id\?subject=Konsultasi%20Wakaf%20Tanah/,
    );
  });

  it('has SEO metadata', () => {
    expect(String(metadata.title)).toContain('Wakaf');
    expect(metadata.description).toBeTruthy();
  });
});
