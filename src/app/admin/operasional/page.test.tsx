import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: { siteSetting: { findUnique: vi.fn() }, partnerOrganisation: { findMany: vi.fn().mockResolvedValue([]) } },
}));
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { prisma } from '@/lib/prisma';
import AdminOperationsPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const stored = (value: unknown) => vi.mocked(prisma.siteSetting.findUnique).mockResolvedValue({ key: 'operations', value } as never);

describe('AdminOperationsPage', () => {
  it('shows donations open and maintenance off when nothing was ever stored', async () => {
    vi.mocked(prisma.siteSetting.findUnique).mockResolvedValue(null);

    render(await AdminOperationsPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Pengaturan Operasional' })).toBeDefined();
    expect(screen.getByLabelText('Terima donasi')).toBeChecked();
    expect(screen.getByLabelText('Mode pemeliharaan')).not.toBeChecked();
    expect(screen.getByText(/Belum ada perubahan/)).toBeDefined();
  });

  it('tells the Admin when the environment keeps donations shut whatever the switch says', async () => {
    vi.stubEnv('NEXT_PUBLIC_DONATIONS_ENABLED', 'false');
    vi.mocked(prisma.siteSetting.findUnique).mockResolvedValue(null);

    render(await AdminOperationsPage());

    expect(screen.getByText(/NEXT_PUBLIC_DONATIONS_ENABLED/)).toBeDefined();
  });

  it('shows the stored switches and the change history with who, when, old and new value', async () => {
    stored({
      donationsOpen: false,
      maintenance: { on: true, message: 'Kembali pukul 10.00 WIB.' },
      history: [
        {
          at: '2026-11-09T03:00:00.000Z',
          actorId: 'a1',
          actorName: 'Dewi Admin',
          changes: [{ field: 'donationsOpen', from: true, to: false }],
        },
      ],
    });

    render(await AdminOperationsPage());

    expect(screen.getByLabelText('Terima donasi')).not.toBeChecked();
    expect(screen.getByLabelText('Mode pemeliharaan')).toBeChecked();
    expect(screen.getByLabelText('Pesan pemeliharaan')).toHaveValue('Kembali pukul 10.00 WIB.');
    expect(screen.getByText(/Dewi Admin/)).toBeDefined();
    expect(screen.getByText(/Terima donasi: hidup → mati/)).toBeDefined();
  });

  it('posts only what the Admin changed to the Admin API and refreshes', async () => {
    vi.mocked(prisma.siteSetting.findUnique).mockResolvedValue(null);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(await AdminOperationsPage());
    fireEvent.click(screen.getByLabelText('Terima donasi'));
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/operations',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ donationsOpen: false }) }),
    );
  });

  it('shows the server\'s own refusal', async () => {
    vi.mocked(prisma.siteSetting.findUnique).mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Pesan maksimal 500 karakter.' }) }));

    render(await AdminOperationsPage());
    fireEvent.click(screen.getByLabelText('Mode pemeliharaan'));
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

    expect(await screen.findByText('Pesan maksimal 500 karakter.')).toBeDefined();
  });

  it('shows the donation presets in force, the old defaults when none were stored', async () => {
    vi.mocked(prisma.siteSetting.findUnique).mockResolvedValue(null);

    render(await AdminOperationsPage());

    expect(screen.getByLabelText('Preset nominal donasi')).toHaveValue('20000, 50000, 100000, 250000, 500000');
  });

  it('shows stored presets and their change in the history', async () => {
    stored({
      donationsOpen: true,
      maintenance: { on: false, message: '' },
      donationPresets: [10000, 25000, 50000],
      history: [
        {
          at: '2026-11-09T03:00:00.000Z',
          actorId: 'a1',
          actorName: 'Dewi Admin',
          changes: [{ field: 'donationPresets', from: [20000, 50000, 100000], to: [10000, 25000, 50000] }],
        },
      ],
    });

    render(await AdminOperationsPage());

    expect(screen.getByLabelText('Preset nominal donasi')).toHaveValue('10000, 25000, 50000');
    expect(screen.getByText(/Preset nominal donasi: 20000, 50000, 100000 → 10000, 25000, 50000/)).toBeDefined();
  });

  it('posts edited presets as a list of numbers, and shows the server refusal for a bad list', async () => {
    vi.mocked(prisma.siteSetting.findUnique).mockResolvedValue(null);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Preset nominal minimal 1.000.' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(await AdminOperationsPage());
    const field = screen.getByLabelText('Preset nominal donasi');
    fireEvent.change(field, { target: { value: '500, 10000, 25000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('Preset nominal minimal 1.000.')).toBeDefined();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ donationPresets: [500, 10000, 25000] });

    fireEvent.change(field, { target: { value: '5.000; 10000 25000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ donationPresets: [5000, 10000, 25000] });
  });
});
