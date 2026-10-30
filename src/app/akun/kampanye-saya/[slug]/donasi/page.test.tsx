import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.stubGlobal('fetch', vi.fn(async () => Response.json({ donations: [], total: 0, page: 1, totalPages: 0 })));

import { getServerSession } from '@/lib/auth';
import CampaignDonationsPage from './page';

const session = getServerSession as unknown as Mock;

beforeEach(() => vi.clearAllMocks());

describe('Daftar Donasi page', () => {
  it('mengarahkan ke /login tanpa sesi', async () => {
    session.mockResolvedValue(null);
    await expect(CampaignDonationsPage({ params: Promise.resolve({ slug: 'a' }) })).rejects.toThrow('NEXT_REDIRECT:/login');
  });

  it('merender daftar untuk yang masuk', async () => {
    session.mockResolvedValue({ user: { id: 'u1' } });
    render(await CampaignDonationsPage({ params: Promise.resolve({ slug: 'a' }) }));
    expect(screen.getByText('Daftar Donasi')).toBeTruthy();
    expect(await screen.findByText('Belum ada donasi.')).toBeTruthy();
  });
});
