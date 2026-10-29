import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: { siteSetting: { findMany: vi.fn() } } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { prisma } from '@/lib/prisma';
import AdminSiteSettingsPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminSiteSettingsPage', () => {
  it('shows the text visitors see today for a section nobody has changed', async () => {
    vi.mocked(prisma.siteSetting.findMany).mockResolvedValue([] as never);

    render(await AdminSiteSettingsPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Pengaturan Laman Publik' })).toBeDefined();
    expect(screen.getByLabelText('Email dukungan')).toHaveValue('halo@fundforindonesia.org');
    expect(screen.getByLabelText('Judul (slide 1)')).toHaveValue(
      'Bantu mereka yang membutuhkan, salurkan donasimu sekarang',
    );
    expect(screen.getAllByText('Belum pernah diubah: teks bawaan yang tampil.')).toHaveLength(5);
  });

  it('shows the stored value and who last changed it', async () => {
    vi.mocked(prisma.siteSetting.findMany).mockResolvedValue([
      {
        key: 'footer',
        value: { about: 'Teks footer dari Admin.' },
        updatedAt: new Date('2026-10-16T03:00:00Z'),
        updatedBy: { name: 'Ira' },
      },
    ] as never);

    render(await AdminSiteSettingsPage());

    expect(screen.getByLabelText(/Teks "Tentang Fund for Indonesia"/)).toHaveValue('Teks footer dari Admin.');
    expect(screen.getByText(/Terakhir diubah oleh Ira/)).toBeDefined();
  });
});
