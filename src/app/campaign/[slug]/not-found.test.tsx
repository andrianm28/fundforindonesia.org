import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

/**
 * The cached Campaign page renders the 404 for every unapproved Campaign,
 * since it cannot know who is looking. This view, shown in its place, asks
 * the session-aware API: the Campaign's Fundraiser, Verifiers and Admins get
 * it back and see the Campaign with its status banner; anyone else gets the
 * API's 404 and sees the not-found message.
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'sumur-desa' }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

import CampaignNotFound from './not-found';

const draft = {
  id: 'campaign-1',
  slug: 'sumur-desa',
  title: 'Sumur untuk Desa',
  description: 'Deskripsi',
  story: '<p>Cerita</p>',
  coverImage: 'https://example.com/a.jpg',
  targetAmount: 10_000_000,
  collectedAmount: 0,
  category: 'lingkungan',
  lifecycleStatus: 'DRAFT',
  isUrgent: false,
  isDemo: false,
  deadline: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  creator: { id: 'owner-1', name: 'Pemilik', avatar: null },
  donationCount: 0,
};

function apiAnswers(status: number, body: unknown) {
  global.fetch = vi.fn(async () =>
    ({ ok: status < 400, status, json: async () => body }) as Response
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('the Campaign not-found view', () => {
  it('shows a privileged viewer the unapproved Campaign with its status banner', async () => {
    apiAnswers(200, { campaign: draft });

    render(<CampaignNotFound />);

    expect((await screen.findAllByText('Sumur untuk Desa')).length).toBeGreaterThan(0);
    expect(screen.getByRole('status', { name: 'Status Campaign' }).textContent).toContain('Draf');
    expect(screen.queryByText('Donasi sekarang')).toBeNull();
  });

  it('asks the API for this slug, past every cache, with the session cookie', async () => {
    apiAnswers(200, { campaign: draft });

    render(<CampaignNotFound />);
    await screen.findAllByText('Sumur untuk Desa');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/campaigns/sumur-desa',
      expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' })
    );
  });

  it('tells anyone else the Campaign was not found', async () => {
    apiAnswers(404, { code: 'NOT_FOUND', message: 'Campaign tidak ditemukan', status: 404 });

    render(<CampaignNotFound />);

    expect(await screen.findByText('Campaign tidak ditemukan')).toBeDefined();
    expect(screen.queryByRole('status', { name: 'Status Campaign' })).toBeNull();
  });

  it('tells them the same when the API cannot be reached', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    render(<CampaignNotFound />);

    expect(await screen.findByText('Campaign tidak ditemukan')).toBeDefined();
  });
});
