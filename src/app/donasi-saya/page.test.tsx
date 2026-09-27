import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Donasi Saya links a confirmed Donation to its Receipt's print page
 * (CONTEXT.md, Receipt) -- reachable from the dashboard, per the ticket --
 * without breaking the existing click-through to the Campaign.
 */

vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated' }),
}));

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

import DonasiSayaPage from './page';

function donation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'donation-1',
    amount: 100_000,
    paymentMethod: 'qris',
    paymentStatus: 'confirmed',
    isAnonymous: false,
    message: null,
    createdAt: '2026-09-26T00:00:00.000Z',
    campaign: { title: 'Test Campaign', slug: 'test-campaign', coverImage: '' },
    receiptToken: 'tok-1',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  router.push.mockReset();
});

describe('Donasi Saya', () => {
  it('links a confirmed Donation with a Receipt to its print page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ donations: [donation()], total: 1, page: 1, limit: 10, totalPages: 1 }),
      }),
    );

    render(<DonasiSayaPage />);

    const link = await screen.findByRole('link', { name: /bukti donasi/i });
    expect(link.getAttribute('href')).toBe('/receipt/tok-1');
  });

  it('shows no Receipt link for a Donation still pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          donations: [donation({ paymentStatus: 'pending', receiptToken: null })],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      }),
    );

    render(<DonasiSayaPage />);

    await screen.findByText('Test Campaign');
    expect(screen.queryByRole('link', { name: /bukti donasi/i })).toBeNull();
  });

  it('still navigates to the Campaign when the card itself is clicked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ donations: [donation()], total: 1, page: 1, limit: 10, totalPages: 1 }),
      }),
    );

    render(<DonasiSayaPage />);

    const card = await screen.findByText('Test Campaign');
    fireEvent.click(card);

    expect(router.push).toHaveBeenCalledWith('/campaign/test-campaign');
  });
});
