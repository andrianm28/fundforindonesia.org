import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * "Kampanye Saya" names each Campaign's status as the glossary does, from
 * the effective `lifecycleStatus` GET /api/user/campaigns sends, so the
 * Fundraiser's list matches the public page and the Admin list.
 */

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'creator-1', role: 'FUNDRAISER' } }, status: 'authenticated' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn() }),
}));

const swr = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock('swr', () => ({
  default: () => ({ data: swr.data, isLoading: false, error: undefined }),
}));

import MyCampaignsPage from './page';

function campaign(slug: string, lifecycleStatus: string) {
  return {
    id: slug,
    slug,
    title: `Campaign ${slug}`,
    coverImage: '',
    collectedAmount: 0,
    targetAmount: 1_000_000,
    lifecycleStatus,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

afterEach(() => cleanup());

describe('Kampanye Saya', () => {
  it('shows each Campaign under its glossary status name', () => {
    swr.data = {
      campaigns: [
        campaign('waiting', 'SUBMITTED'),
        campaign('running', 'ACTIVE'),
        campaign('lapsed', 'EXPIRED'),
        campaign('frozen', 'SUSPENDED'),
      ],
      total: 4,
      page: 1,
      totalPages: 1,
    };

    render(<MyCampaignsPage />);

    for (const [slug, label] of [
      ['waiting', 'Submitted'],
      ['running', 'Active'],
      ['lapsed', 'Expired'],
      ['frozen', 'Suspended'],
    ]) {
      const card = screen.getByText(`Campaign ${slug}`).parentElement!;
      expect(card.textContent).toContain(label);
    }
  });
});
