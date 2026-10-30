import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.stubGlobal('fetch', vi.fn());

import { getServerSession } from '@/lib/auth';
import CampaignUpdatesPage from './page';

describe('Kabar Terbaru screen of a Fundraiser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends a signed-out visitor to sign in', async () => {
    (getServerSession as Mock).mockResolvedValue(null);
    await expect(CampaignUpdatesPage({ params: Promise.resolve({ slug: 's' }) })).rejects.toThrow('NEXT_REDIRECT:/login');
  });

  it('renders the form for a signed-in user', async () => {
    (getServerSession as Mock).mockResolvedValue({ user: { id: 'u' } });
    render(await CampaignUpdatesPage({ params: Promise.resolve({ slug: 's' }) }));
    expect(screen.getByLabelText('Judul')).toBeDefined();
  });
});
