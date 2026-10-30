import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { AdminCampaignTransferDecisionForm } from './AdminCampaignTransferDecisionForm';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/**
 * The second Admin decides a PENDING Campaign Transfer (ticket 77; CONTEXT.md,
 * Campaign Transfer). The service layer owns the two-person rule and the Kind
 * rules; this form only collects the decision and shows the server's refusal
 * in its own words.
 */
describe('AdminCampaignTransferDecisionForm', () => {
  it('shows the two-person notice, not the buttons, to the Admin who requested the transfer', () => {
    render(<AdminCampaignTransferDecisionForm transferId="t-1" actorId="admin-1" requestedById="admin-1" />);

    expect(screen.getByText(/tidak bisa memutuskannya sendiri/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /setujui/i })).toBeNull();
  });

  it('posts decision=approve for a different Admin and refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminCampaignTransferDecisionForm transferId="t-1" actorId="admin-2" requestedById="admin-1" />);
    fireEvent.click(screen.getByRole('button', { name: /setujui/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/campaign-transfers/t-1/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('requires a reason before rejecting and posts decision=reject with it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminCampaignTransferDecisionForm transferId="t-1" actorId="admin-2" requestedById="admin-1" />);

    expect(screen.getByRole('button', { name: /tolak/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/alasan/i), { target: { value: 'tujuan tidak cocok' } });
    fireEvent.click(screen.getByRole('button', { name: /tolak/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/campaign-transfers/t-1/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'reject', reason: 'tujuan tidak cocok' }),
      }),
    );
  });

  it('shows the server refusal in its own words and does not refresh', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Transfer lintas jenis tidak diizinkan.' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminCampaignTransferDecisionForm transferId="t-1" actorId="admin-2" requestedById="admin-1" />);
    fireEvent.click(screen.getByRole('button', { name: /setujui/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Transfer lintas jenis tidak diizinkan.');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('falls back to a generic message when the refusal has no body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));

    render(<AdminCampaignTransferDecisionForm transferId="t-1" actorId="admin-2" requestedById="admin-1" />);
    fireEvent.click(screen.getByRole('button', { name: /setujui/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/gagal menyetujui/i);
  });
});
