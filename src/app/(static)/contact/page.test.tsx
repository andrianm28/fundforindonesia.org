import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_SITE_SETTINGS } from '@/lib/site-settings';

const mockResolve = vi.fn();
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/site-settings', async (orig) => ({
  ...(await orig<typeof import('@/lib/site-settings')>()),
  resolveSiteSettingsOrDefaults: (...a: unknown[]) => mockResolve(...a),
}));

import ContactPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Kontak page', () => {
  it('shows the contact details an Admin set', async () => {
    mockResolve.mockResolvedValue({
      ...DEFAULT_SITE_SETTINGS,
      contact: { ...DEFAULT_SITE_SETTINGS.contact, email: 'halo@contoh.id', address: 'Jl. Baru 1' },
    });
    render(await ContactPage());

    expect(screen.getByRole('link', { name: 'halo@contoh.id' })).toHaveAttribute('href', 'mailto:halo@contoh.id');
    expect(screen.getByText('Jl. Baru 1')).toBeDefined();
  });

  it('hides the cards an Admin emptied', async () => {
    mockResolve.mockResolvedValue({
      ...DEFAULT_SITE_SETTINGS,
      contact: { ...DEFAULT_SITE_SETTINGS.contact, phone: '', whatsapp: '', address: '' },
      social: { instagram: '', twitter: '', facebook: '' },
    });
    render(await ContactPage());

    expect(screen.queryByText('Telepon')).toBeNull();
    expect(screen.queryByText('WhatsApp')).toBeNull();
    expect(screen.queryByText('Media Sosial')).toBeNull();
    expect(screen.queryByText('Alamat Kantor')).toBeNull();
  });
});
