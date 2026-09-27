import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * "Kampanye Saya" shows each Campaign's status badge in Indonesian, from
 * the effective `lifecycleStatus` GET /api/user/campaigns sends, so the
 * Fundraiser's list matches the public page and the Admin list.
 */

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'creator-1', assignments: [] } }, status: 'authenticated' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn() }),
}));

const swr = vi.hoisted(() => ({ data: undefined as unknown, mutate: vi.fn() }));
vi.mock('swr', () => ({
  default: () => ({ data: swr.data, isLoading: false, error: undefined, mutate: swr.mutate }),
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  swr.mutate.mockReset();
});

describe('Kampanye Saya', () => {
  it('points a user with no Campaign straight to creating one (FFI-04)', () => {
    swr.data = { campaigns: [], total: 0, page: 1, totalPages: 0 };

    render(<MyCampaignsPage />);

    expect(screen.getByRole('link', { name: 'Buat Kampanye' }).getAttribute('href')).toBe('/campaign/create');
    expect(screen.queryByRole('link', { name: 'Verifikasi Sekarang' })).toBeNull();
  });

  it('shows each Campaign under its Indonesian status badge', () => {
    swr.data = {
      campaigns: [
        campaign('waiting', 'SUBMITTED'),
        campaign('running', 'ACTIVE'),
        // An Active Campaign past its deadline: the API already sends it as
        // EXPIRED (covered in src/app/api/user/campaigns/route.test.ts).
        campaign('lapsed', 'EXPIRED'),
        campaign('frozen', 'SUSPENDED'),
      ],
      total: 4,
      page: 1,
      totalPages: 1,
    };

    render(<MyCampaignsPage />);

    for (const [slug, label] of [
      ['waiting', 'Diajukan'],
      ['running', 'Aktif'],
      ['lapsed', 'Berakhir'],
      ['frozen', 'Dibekukan'],
    ]) {
      const card = screen.getByText(`Campaign ${slug}`).parentElement!;
      expect(card.textContent).toContain(label);
    }
  });

  it('links each Campaign to its own Payout screen, so the money a Fundraiser raised is reachable', () => {
    // Without this the Payout screen exists but no Fundraiser can find it:
    // FFI-07's whole subject is a person asking for their own money back out.
    swr.data = { campaigns: [campaign('running', 'ACTIVE')], total: 1, page: 1, totalPages: 1 };

    render(<MyCampaignsPage />);

    const card = screen.getByTestId('campaign-running');
    const link = within(card).getByRole('link', { name: 'Cairkan dana' });
    expect(link.getAttribute('href')).toBe('/akun/kampanye-saya/running/pencairan');
  });

  it('offers "Ajukan ke Verifier" on a Draft or Rejected Campaign only, and submits it', async () => {
    swr.data = {
      campaigns: [campaign('draft', 'DRAFT'), campaign('refused', 'REJECTED'), campaign('waiting', 'SUBMITTED'), campaign('running', 'ACTIVE')],
      total: 4,
      page: 1,
      totalPages: 1,
    };
    const fetchMock = vi.fn(async () => Response.json({}, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<MyCampaignsPage />);

    const buttons = screen.getAllByRole('button', { name: 'Ajukan ke Verifier' });
    expect(buttons).toHaveLength(2);
    expect(within(screen.getByTestId('campaign-waiting')).queryByRole('button', { name: 'Ajukan ke Verifier' })).toBeNull();

    fireEvent.click(within(screen.getByTestId('campaign-draft')).getByRole('button', { name: 'Ajukan ke Verifier' }));

    await waitFor(() => expect(swr.mutate).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/campaigns/draft/verification-requests', { method: 'POST' });
  });

  it('offers "Tarik pengajuan" only while a request is pending, and withdraws that request', async () => {
    swr.data = {
      campaigns: [
        { ...campaign('waiting', 'SUBMITTED'), pendingVerificationRequestId: 'verification-open' },
        { ...campaign('draft', 'DRAFT'), pendingVerificationRequestId: null },
        { ...campaign('running', 'ACTIVE'), pendingVerificationRequestId: null },
      ],
      total: 3,
      page: 1,
      totalPages: 1,
    };
    const fetchMock = vi.fn(async () => Response.json({}, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<MyCampaignsPage />);

    expect(screen.getAllByRole('button', { name: 'Tarik pengajuan' })).toHaveLength(1);
    fireEvent.click(within(screen.getByTestId('campaign-waiting')).getByRole('button', { name: 'Tarik pengajuan' }));

    await waitFor(() => expect(swr.mutate).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/campaigns/waiting/verification-requests/verification-open/withdraw',
      { method: 'POST' },
    );
  });

  it('shows why a withdrawal was refused', async () => {
    swr.data = {
      campaigns: [{ ...campaign('waiting', 'SUBMITTED'), pendingVerificationRequestId: 'verification-open' }],
      total: 1,
      page: 1,
      totalPages: 1,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Verification Request ini sudah diputuskan.' }, { status: 409 })),
    );

    render(<MyCampaignsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Tarik pengajuan' }));

    expect(await screen.findByText('Verification Request ini sudah diputuskan.')).toBeDefined();
    expect(swr.mutate).not.toHaveBeenCalled();
  });

  it('shows why a submission was refused', async () => {
    swr.data = { campaigns: [campaign('draft', 'DRAFT')], total: 1, page: 1, totalPages: 1 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Tindakan ini tidak dapat dilakukan.' }, { status: 409 })),
    );

    render(<MyCampaignsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajukan ke Verifier' }));

    expect(await screen.findByText('Tindakan ini tidak dapat dilakukan.')).toBeDefined();
    expect(swr.mutate).not.toHaveBeenCalled();
  });
});
