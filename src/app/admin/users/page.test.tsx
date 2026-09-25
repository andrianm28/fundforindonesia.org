import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    status: 'authenticated',
    data: { user: { id: 'admin-1', role: 'ADMIN', isVerified: false, verificationType: null, assignments: [] }, expires: '2099-01-01' },
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import AdminUsersPage from './page';

describe('AdminUsersPage verification column', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        users: [
          { id: 'u-1', name: 'Budi', email: 'budi@test.com', role: 'CAMPAIGN_CREATOR', isVerified: true, createdAt: '2026-09-01T00:00:00.000Z' },
        ],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      }),
    }) as any;
  });

  afterEach(() => {
    cleanup();
  });

  it('labels a stored isVerified as a self-declared claim, not as verified, for the Admin checking identity (gap C2)', async () => {
    render(<AdminUsersPage />);

    expect(await screen.findByText('Klaim sendiri')).toBeDefined();
    expect(screen.queryByText('Terverifikasi')).toBeNull();
  });
});
