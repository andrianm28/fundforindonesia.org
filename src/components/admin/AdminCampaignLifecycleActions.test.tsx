import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { AdminCampaignLifecycleActions } from './AdminCampaignLifecycleActions';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
}

function refused(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) } as Response);
}

afterEach(() => {
  cleanup();
  mockFetch.mockReset();
  mockRefresh.mockReset();
});

/**
 * ticket 25: the Admin screen that reaches suspendCampaign, liftSuspension
 * and decideCancellation (src/lib/campaign-lifecycle.ts). The server holds
 * every rule this form asks about; this only asks for a reason before
 * posting, and shows the server's own refusal in its own words.
 */
describe('AdminCampaignLifecycleActions -- suspend (ACTIVE/EXPIRED/COMPLETED)', () => {
  const baseProps = {
    campaignSlug: 'sumur-desa',
    status: 'ACTIVE' as const,
    canSuspend: true,
    isOwnCampaign: false,
    suspendedBySameAdmin: false,
    openFlags: [],
    pendingCancellationRequest: null,
  };

  it('asks for a reason and posts it to the suspension route', async () => {
    mockFetch.mockImplementation(() => ok({ campaign: { id: 'c1' } }));

    render(<AdminCampaignLifecycleActions {...baseProps} />);

    fireEvent.change(screen.getByLabelText(/alasan suspension/i), {
      target: { value: 'Ada indikasi penipuan.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /jatuhkan suspension/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/campaigns/sumur-desa/suspension');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ reason: 'Ada indikasi penipuan.' });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('keeps the button disabled until a reason is typed', () => {
    render(<AdminCampaignLifecycleActions {...baseProps} />);
    expect(screen.getByRole('button', { name: /jatuhkan suspension/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/alasan suspension/i), { target: { value: 'Alasan.' } });
    expect(screen.getByRole('button', { name: /jatuhkan suspension/i })).not.toBeDisabled();
  });

  it('shows the server refusal in its own words rather than a generic message', async () => {
    mockFetch.mockImplementation(() =>
      refused(409, { error: 'Campaign sudah Dibekukan.', code: 'INVALID_TRANSITION' }),
    );

    render(<AdminCampaignLifecycleActions {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/alasan suspension/i), { target: { value: 'Alasan.' } });
    fireEvent.click(screen.getByRole('button', { name: /jatuhkan suspension/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Campaign sudah Dibekukan.');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('lists open Flags for context', () => {
    render(
      <AdminCampaignLifecycleActions
        {...baseProps}
        openFlags={[{ id: 'flag-1', reason: 'Dokumen mencurigakan.' }]}
      />,
    );
    expect(screen.getByText('Dokumen mencurigakan.')).toBeDefined();
  });

  it('shows a note instead of the form when the Admin owns this Campaign', () => {
    render(<AdminCampaignLifecycleActions {...baseProps} isOwnCampaign />);
    expect(screen.getByText(/milik anda sendiri/i)).toBeDefined();
    expect(screen.queryByLabelText(/alasan suspension/i)).toBeNull();
  });

  it('renders nothing to suspend for a status that is not suspendable', () => {
    render(<AdminCampaignLifecycleActions {...baseProps} status="DRAFT" canSuspend={false} />);
    expect(screen.queryByLabelText(/alasan suspension/i)).toBeNull();
  });
});

describe('AdminCampaignLifecycleActions -- lift (SUSPENDED)', () => {
  const baseProps = {
    campaignSlug: 'sumur-desa',
    status: 'SUSPENDED' as const,
    canSuspend: false,
    isOwnCampaign: false,
    suspendedBySameAdmin: false,
    openFlags: [],
    pendingCancellationRequest: null,
  };

  it('asks for a reason and sends it as a DELETE to the suspension route', async () => {
    mockFetch.mockImplementation(() => ok({ campaign: { id: 'c1' } }));

    render(<AdminCampaignLifecycleActions {...baseProps} />);

    fireEvent.change(screen.getByLabelText(/alasan pencabutan/i), {
      target: { value: 'Flag terbukti tidak berdasar.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /cabut suspension/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/campaigns/sumur-desa/suspension');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ reason: 'Flag terbukti tidak berdasar.' });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('shows a note instead of the form for the Admin who imposed this Suspension (ADR 0015)', () => {
    render(<AdminCampaignLifecycleActions {...baseProps} suspendedBySameAdmin />);
    expect(screen.getByText(/admin lain/i)).toBeDefined();
    expect(screen.queryByLabelText(/alasan pencabutan/i)).toBeNull();
  });
});

describe('AdminCampaignLifecycleActions -- Cancellation decision', () => {
  const baseProps = {
    campaignSlug: 'sumur-desa',
    status: 'ACTIVE' as const,
    canSuspend: true,
    isOwnCampaign: false,
    suspendedBySameAdmin: false,
    openFlags: [],
    pendingCancellationRequest: { id: 'req-1', reason: 'Dana sudah tidak dibutuhkan.', requestedByName: 'Budi' },
  };

  it('shows the Fundraiser reason and approves with a reason', async () => {
    mockFetch.mockImplementation(() => ok({ campaign: { id: 'c1' } }));

    render(<AdminCampaignLifecycleActions {...baseProps} />);
    expect(screen.getByText('Dana sudah tidak dibutuhkan.')).toBeDefined();
    expect(screen.getByText(/diajukan oleh budi/i)).toBeDefined();

    fireEvent.change(screen.getByLabelText(/alasan keputusan/i), { target: { value: 'Disetujui.' } });
    fireEvent.click(screen.getByRole('button', { name: /^setujui cancellation$/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/campaigns/sumur-desa/cancellation-requests/req-1/approve');
    expect(JSON.parse(init.body)).toEqual({ reason: 'Disetujui.' });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('rejects with a reason', async () => {
    mockFetch.mockImplementation(() => ok({ campaign: { id: 'c1' } }));

    render(<AdminCampaignLifecycleActions {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/alasan keputusan/i), { target: { value: 'Ditolak.' } });
    fireEvent.click(screen.getByRole('button', { name: /tolak cancellation/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch.mock.calls[0][0]).toBe('/api/campaigns/sumur-desa/cancellation-requests/req-1/reject');
  });

  it('renders nothing for the Cancellation section when there is no pending request', () => {
    render(<AdminCampaignLifecycleActions {...baseProps} pendingCancellationRequest={null} />);
    expect(screen.queryByLabelText(/alasan keputusan/i)).toBeNull();
  });

  it('shows a note instead of the form when the Admin owns this Campaign', () => {
    render(<AdminCampaignLifecycleActions {...baseProps} isOwnCampaign />);
    expect(screen.queryByLabelText(/alasan keputusan/i)).toBeNull();
  });
});
