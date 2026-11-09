import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: { siteSetting: { findUnique: vi.fn() } } }));
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

  it('posts the changed switches to the Admin API and refreshes', async () => {
    vi.mocked(prisma.siteSetting.findUnique).mockResolvedValue(null);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(await AdminOperationsPage());
    fireEvent.click(screen.getByLabelText('Terima donasi'));
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/operations',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ donationsOpen: false, maintenanceOn: false, maintenanceMessage: '' }) }),
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
});
