import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import { AdminSiteSettingForm } from './AdminSiteSettingForm';
import { DEFAULT_SITE_SETTINGS } from '@/lib/site-settings';

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  global.fetch = originalFetch;
});

describe('AdminSiteSettingForm', () => {
  it('posts the whole section under its own key and refreshes on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;
    render(<AdminSiteSettingForm settingKey="contact" initial={DEFAULT_SITE_SETTINGS.contact} />);

    expect((screen.getByRole('button', { name: 'Simpan' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Email dukungan'), { target: { value: 'baru@fundforindonesia.id' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    const [url, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe('/api/admin/site-settings');
    expect(JSON.parse(init.body as string)).toEqual({
      key: 'contact',
      value: { ...DEFAULT_SITE_SETTINGS.contact, email: 'baru@fundforindonesia.id' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Tersimpan.');
  });

  it("shows the server's refusal in its own words", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Alamat email tidak valid.' }),
    }) as unknown as typeof fetch;
    render(<AdminSiteSettingForm settingKey="contact" initial={DEFAULT_SITE_SETTINGS.contact} />);

    fireEvent.change(screen.getByLabelText('Email dukungan'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Alamat email tidak valid.');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('adds, reorders and removes hero slides', () => {
    render(<AdminSiteSettingForm settingKey="hero" initial={DEFAULT_SITE_SETTINGS.hero} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tambah slide' }));
    expect(screen.getByLabelText('Judul (slide 4)')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Hapus slide 4' }));
    expect(screen.queryByLabelText('Judul (slide 4)')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Turun' })[0]);
    expect((screen.getByLabelText('Label tombol (slide 1)') as HTMLInputElement).value).toBe('Bayar Zakat');
  });

  it('splits the About text into paragraphs on blank lines', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;
    render(<AdminSiteSettingForm settingKey="pages" initial={DEFAULT_SITE_SETTINGS.pages} />);

    fireEvent.change(screen.getByLabelText('Isi halaman Tentang Kami'), { target: { value: 'Satu.\n\nDua.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const init = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1];
    expect(JSON.parse(init.body as string).value.aboutParagraphs).toEqual(['Satu.', 'Dua.']);
  });
});
