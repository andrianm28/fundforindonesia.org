import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { AdminRefundApproveForm } from './AdminRefundApproveForm';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/**
 * A different Admin approves a REQUESTED Refund (ticket 23; CONTEXT.md,
 * Refund's two-person rule). Server already enforces SelfApprovalError --
 * this form only names the rule before the Admin submits into a refusal it
 * could have been told about first, the same choice AdminPayoutActionForm
 * already makes for Payout.
 */
describe('AdminRefundApproveForm', () => {
  it('shows the two-person rule notice, not a button, when the viewer requested this Refund', () => {
    render(
      <AdminRefundApproveForm
        refundId="refund-1"
        subject={{ type: 'campaign', slug: 'wakaf-sumur' }}
        actorId="admin-1"
        requestedById="admin-1"
      />,
    );

    expect(screen.getByText(/tidak bisa menyetujuinya sendiri/i)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('posts to the Campaign refund approve route for a different Admin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AdminRefundApproveForm
        refundId="refund-1"
        subject={{ type: 'campaign', slug: 'wakaf-sumur' }}
        actorId="admin-2"
        requestedById="admin-1"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /setujui refund/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/campaigns/wakaf-sumur/refunds/refund-1/approve', {
      method: 'PATCH',
    }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('posts to the Volunteer Trip refund approve route for a Trip subject', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AdminRefundApproveForm
        refundId="refund-2"
        subject={{ type: 'trip', slug: 'trip-lombok' }}
        actorId="admin-2"
        requestedById="admin-1"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /setujui refund/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/volunteer-trips/trip-lombok/refunds/refund-2/approve', {
        method: 'PATCH',
      }),
    );
  });

  it('shows the server refusal in its own words', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Sudah disetujui Admin lain.' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AdminRefundApproveForm
        refundId="refund-1"
        subject={{ type: 'campaign', slug: 'wakaf-sumur' }}
        actorId="admin-2"
        requestedById="admin-1"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /setujui refund/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sudah disetujui Admin lain.');
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
