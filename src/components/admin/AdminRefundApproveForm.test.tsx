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

function fillDestination() {
  fireEvent.change(screen.getByLabelText('Kode bank'), { target: { value: 'BCA' } });
  fireEvent.change(screen.getByLabelText('Nama pemilik rekening'), { target: { value: 'Budi Santoso' } });
  fireEvent.change(screen.getByLabelText('Nomor rekening'), { target: { value: '1234567890' } });
}

/**
 * A different Admin approves a REQUESTED Refund (ticket 23; CONTEXT.md,
 * Refund's two-person rule) and records the Donor destination (Q7(c), ADR
 * 0018 Amendment 2026-09-28). Server already enforces SelfApprovalError and
 * REFUND_DESTINATION_INVALID -- this form only names the rule and asks for
 * the right fields before the Admin submits into a refusal it could have
 * been told about first, the same choice AdminPayoutActionForm already
 * makes for Payout.
 */
describe('AdminRefundApproveForm', () => {
  it('shows the two-person rule notice, not a button, when the viewer requested this Refund', () => {
    render(
      <AdminRefundApproveForm
        refundId="refund-1"
        subject={{ type: 'campaign', slug: 'wakaf-sumur' }}
        actorId="admin-1"
        requestedById="admin-1"
        isOwnSubject={false}
      />,
    );

    expect(screen.getByText(/tidak bisa menyetujuinya sendiri/i)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('disables the button until the destination is filled in', () => {
    render(
      <AdminRefundApproveForm
        refundId="refund-1"
        subject={{ type: 'campaign', slug: 'wakaf-sumur' }}
        actorId="admin-2"
        requestedById="admin-1"
        isOwnSubject={false}
      />,
    );

    expect(screen.getByRole('button', { name: /setujui refund/i })).toBeDisabled();
    fillDestination();
    expect(screen.getByRole('button', { name: /setujui refund/i })).not.toBeDisabled();
  });

  it('never renders the account number as page text -- it only ever lives in the input\'s own value', () => {
    render(
      <AdminRefundApproveForm
        refundId="refund-1"
        subject={{ type: 'campaign', slug: 'wakaf-sumur' }}
        actorId="admin-2"
        requestedById="admin-1"
        isOwnSubject={false}
      />,
    );

    fillDestination();
    // An input's value is a DOM property, not text content -- so this checks
    // the number is nowhere in the rendered TEXT of the page (a static echo
    // would be), while still confirming the field itself holds it.
    expect(document.body.textContent ?? '').not.toContain('1234567890');
    expect(screen.getByLabelText('Nomor rekening')).toHaveValue('1234567890');
  });

  it('posts the destination to the Campaign refund approve route for a different Admin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AdminRefundApproveForm
        refundId="refund-1"
        subject={{ type: 'campaign', slug: 'wakaf-sumur' }}
        actorId="admin-2"
        requestedById="admin-1"
        isOwnSubject={false}
      />,
    );

    fillDestination();
    fireEvent.click(screen.getByRole('button', { name: /setujui refund/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/campaigns/wakaf-sumur/refunds/refund-1/approve', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          donorBankCode: 'BCA',
          donorAccountName: 'Budi Santoso',
          donorAccountNumber: '1234567890',
        }),
      }),
    );
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
        isOwnSubject={false}
      />,
    );

    fillDestination();
    fireEvent.click(screen.getByRole('button', { name: /setujui refund/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/volunteer-trips/trip-lombok/refunds/refund-2/approve',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
  });

  it('shows the server refusal in its own words', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Kode bank wajib diisi.' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AdminRefundApproveForm
        refundId="refund-1"
        subject={{ type: 'campaign', slug: 'wakaf-sumur' }}
        actorId="admin-2"
        requestedById="admin-1"
        isOwnSubject={false}
      />,
    );

    fillDestination();
    fireEvent.click(screen.getByRole('button', { name: /setujui refund/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Kode bank wajib diisi.');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it.each([
    ['campaign', 'Campaign'],
    ['trip', 'Volunteer Trip'],
  ] as const)("tells the %s's own Fundraiser they cannot act as Admin on it, instead of the form", (type, name) => {
    render(
      <AdminRefundApproveForm
        refundId="refund-1"
        subject={{ type, slug: 'slug-x' }}
        actorId="admin-2"
        requestedById="admin-1"
        isOwnSubject
      />,
    );

    expect(screen.getByText(new RegExp(`Fundraiser ${name} ini`))).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByLabelText('Kode bank')).toBeNull();
  });
});
