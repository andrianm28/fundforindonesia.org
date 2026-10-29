import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
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
    isUrgent: false,
    canSetUrgent: false,
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
        openFlags={[{ id: 'flag-1', reason: 'Dokumen mencurigakan.', verifierName: 'Sari', flaggedAtLabel: '8 Oktober 2026 pukul 03.30 WIB' }]}
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
    isUrgent: false,
    canSetUrgent: false,
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
    isUrgent: false,
    canSetUrgent: false,
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

/**
 * rilis-1-benda 66: the Admin sees the open Flags a Verifier raised and
 * dismisses one with a reason (dismissFlag). Who may dismiss -- an Admin who
 * is not the Campaign's Fundraiser -- and from which status are the lifecycle
 * module's; this screen keeps no copy of either and shows the server's words
 * when it refuses.
 */
describe('AdminCampaignLifecycleActions -- open Flags', () => {
  const baseProps = {
    campaignSlug: 'sumur-desa',
    status: 'ACTIVE' as const,
    canSuspend: true,
    isOwnCampaign: false,
    suspendedBySameAdmin: false,
    isUrgent: false,
    canSetUrgent: false,
    pendingCancellationRequest: null,
    openFlags: [
      { id: 'flag-1', reason: 'Foto sampul dipakai ulang.', verifierName: 'Sari', flaggedAtLabel: '8 Oktober 2026 pukul 03.30 WIB' },
      { id: 'flag-2', reason: 'Nomor rekening beda dari dokumen.', verifierName: 'Dewi', flaggedAtLabel: '8 Oktober 2026 pukul 08.00 WIB' },
    ],
  };

  const flagItem = (reason: string) => screen.getByText(reason).closest('li') as HTMLElement;

  it('lists every open Flag with its reason, who raised it, and when', () => {
    render(<AdminCampaignLifecycleActions {...baseProps} />);

    const first = within(flagItem('Foto sampul dipakai ulang.'));
    expect(first.getByText(/Sari/)).toBeDefined();
    expect(first.getByText(/8 Oktober 2026 pukul 03\.30 WIB/)).toBeDefined();
    const second = within(flagItem('Nomor rekening beda dari dokumen.'));
    expect(second.getByText(/Dewi/)).toBeDefined();
    expect(second.getByText(/8 Oktober 2026 pukul 08\.00 WIB/)).toBeDefined();
  });

  it("dismisses the Flag it was asked about, with the reason typed under it, and refreshes", async () => {
    mockFetch.mockImplementation(() => ok({ flag: { id: 'flag-2' } }));

    render(<AdminCampaignLifecycleActions {...baseProps} />);
    const second = within(flagItem('Nomor rekening beda dari dokumen.'));
    fireEvent.change(second.getByLabelText(/alasan penolakan flag/i), {
      target: { value: 'Sudah dicocokkan dengan dokumen terbaru.' },
    });
    fireEvent.click(second.getByRole('button', { name: /tolak flag/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/campaigns/sumur-desa/flags/flag-2/dismiss');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ reason: 'Sudah dicocokkan dengan dokumen terbaru.' });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
  });

  it("keeps each Flag's reason apart and offers no dismissal without one", () => {
    render(<AdminCampaignLifecycleActions {...baseProps} />);
    const first = within(flagItem('Foto sampul dipakai ulang.'));
    const second = within(flagItem('Nomor rekening beda dari dokumen.'));

    expect(first.getByRole('button', { name: /tolak flag/i })).toBeDisabled();
    expect(second.getByRole('button', { name: /tolak flag/i })).toBeDisabled();

    fireEvent.change(first.getByLabelText(/alasan penolakan flag/i), { target: { value: 'Tidak berdasar.' } });
    expect(first.getByRole('button', { name: /tolak flag/i })).not.toBeDisabled();
    expect(second.getByRole('button', { name: /tolak flag/i })).toBeDisabled();
  });

  it("shows the server's refusal in its own words, under the Flag it concerns", async () => {
    mockFetch.mockImplementation(() =>
      refused(409, { error: 'Flag ini sudah selesai karena Campaign telah dibekukan (Suspended).', code: 'FLAG_ALREADY_RESOLVED' }),
    );

    render(<AdminCampaignLifecycleActions {...baseProps} />);
    const first = within(flagItem('Foto sampul dipakai ulang.'));
    fireEvent.change(first.getByLabelText(/alasan penolakan flag/i), { target: { value: 'Tidak berdasar.' } });
    fireEvent.click(first.getByRole('button', { name: /tolak flag/i }));

    expect(await first.findByRole('alert')).toHaveTextContent(
      'Flag ini sudah selesai karena Campaign telah dibekukan (Suspended).',
    );
    expect(within(flagItem('Nomor rekening beda dari dokumen.')).queryByRole('alert')).toBeNull();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('lists the Flags of a Campaign that can no longer be suspended, since dismissing never depended on its status', () => {
    render(<AdminCampaignLifecycleActions {...baseProps} status="CANCELLED" canSuspend={false} />);

    expect(screen.getByText('Foto sampul dipakai ulang.')).toBeDefined();
    expect(within(flagItem('Foto sampul dipakai ulang.')).getByRole('button', { name: /tolak flag/i })).toBeDefined();
    expect(screen.queryByLabelText(/alasan suspension/i)).toBeNull();
  });

  it('shows no Flag section when none is open', () => {
    render(<AdminCampaignLifecycleActions {...baseProps} openFlags={[]} />);

    expect(screen.queryByRole('button', { name: /tolak flag/i })).toBeNull();
  });
});

/**
 * rilis-1-benda 66: the Admin sets or clears Urgent (setUrgent). Whether
 * Urgent can be set -- an effectively Active Campaign, never one the Admin
 * owns -- is the lifecycle module's judgement: the page passes only the
 * answer it read from the module's own list (`canSetUrgent`), and every
 * refusal reaches the Admin as the server's sentence.
 */
describe('AdminCampaignLifecycleActions -- Urgent', () => {
  const baseProps = {
    campaignSlug: 'sumur-desa',
    status: 'ACTIVE' as const,
    canSuspend: true,
    isOwnCampaign: false,
    suspendedBySameAdmin: false,
    openFlags: [],
    isUrgent: false,
    canSetUrgent: true,
    pendingCancellationRequest: null,
  };

  it("sets Urgent with a reason through the Campaign's urgent route and refreshes", async () => {
    mockFetch.mockImplementation(() => ok({ campaign: { isUrgent: true } }));

    render(<AdminCampaignLifecycleActions {...baseProps} />);
    expect(screen.getByText(/campaign ini tidak urgent/i)).toBeDefined();
    fireEvent.change(screen.getByLabelText(/alasan memasang urgent/i), {
      target: { value: 'Banjir bandang, dana dibutuhkan segera.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^pasang urgent$/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/campaigns/sumur-desa/urgent');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ urgent: true, reason: 'Banjir bandang, dana dibutuhkan segera.' });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
  });

  it('clears Urgent the same way, with urgent false', async () => {
    mockFetch.mockImplementation(() => ok({ campaign: { isUrgent: false } }));

    render(<AdminCampaignLifecycleActions {...baseProps} isUrgent />);
    expect(screen.getByText(/campaign ini sedang urgent/i)).toBeDefined();
    fireEvent.change(screen.getByLabelText(/alasan melepas urgent/i), {
      target: { value: 'Kebutuhan sudah terpenuhi.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^lepas urgent$/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/campaigns/sumur-desa/urgent');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ urgent: false, reason: 'Kebutuhan sudah terpenuhi.' });
  });

  it('confirms the change and empties the reason', async () => {
    mockFetch.mockImplementation(() => ok({ campaign: { isUrgent: true } }));

    render(<AdminCampaignLifecycleActions {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/alasan memasang urgent/i), { target: { value: 'Mendesak.' } });
    fireEvent.click(screen.getByRole('button', { name: /^pasang urgent$/i }));

    expect(await screen.findByRole('status')).toHaveTextContent('Urgent dipasang.');
    expect(screen.getByLabelText(/alasan memasang urgent/i)).toHaveValue('');
  });

  it('offers no change without a reason', () => {
    render(<AdminCampaignLifecycleActions {...baseProps} />);
    const button = screen.getByRole('button', { name: /^pasang urgent$/i });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/alasan memasang urgent/i), { target: { value: 'Mendesak.' } });
    expect(button).not.toBeDisabled();
  });

  it("shows the server's refusal in its own words", async () => {
    mockFetch.mockImplementation(() =>
      refused(409, {
        error: 'Tindakan ini tidak dapat dilakukan pada Campaign berstatus Berakhir.',
        code: 'INVALID_TRANSITION',
      }),
    );

    render(<AdminCampaignLifecycleActions {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/alasan memasang urgent/i), { target: { value: 'Mendesak.' } });
    fireEvent.click(screen.getByRole('button', { name: /^pasang urgent$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tindakan ini tidak dapat dilakukan pada Campaign berstatus Berakhir.',
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("does not decide for the server who may act: an Admin who owns the Campaign is still offered the form, and told the server's reason", async () => {
    const refusal =
      'Anda tidak dapat bertindak sebagai Admin atas Campaign milik Anda sendiri. Tindakan ini harus dilakukan Admin lain.';
    mockFetch.mockImplementation(() => refused(403, { error: refusal, code: 'OWN_CAMPAIGN_CONFLICT' }));

    render(<AdminCampaignLifecycleActions {...baseProps} isOwnCampaign />);
    fireEvent.change(screen.getByLabelText(/alasan memasang urgent/i), { target: { value: 'Mendesak.' } });
    fireEvent.click(screen.getByRole('button', { name: /^pasang urgent$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(refusal);
  });

  it('still offers to clear Urgent when it can no longer be set, since clearing never depended on the status', () => {
    render(<AdminCampaignLifecycleActions {...baseProps} status="EXPIRED" isUrgent canSetUrgent={false} />);

    expect(screen.getByRole('button', { name: /^lepas urgent$/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /^pasang urgent$/i })).toBeNull();
  });

  it('offers nothing for Urgent when it is not set and cannot be set', () => {
    render(<AdminCampaignLifecycleActions {...baseProps} status="SUSPENDED" canSuspend={false} canSetUrgent={false} />);

    expect(screen.queryByRole('button', { name: /urgent/i })).toBeNull();
    expect(screen.queryByText(/campaign ini tidak urgent/i)).toBeNull();
  });
});
