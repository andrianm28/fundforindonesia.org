import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { AdminRefundCompleteForm } from './AdminRefundCompleteForm';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const validBody = {
  reference: 'TRX-1',
  note: 'Ditransfer via mobile banking BCA, dicocokkan dengan nama dan rekening Donor.',
  bankCode: 'BCA',
  accountName: 'Budi Santoso',
  accountNumber: '1234567890',
};

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Kode bank'), { target: { value: validBody.bankCode } });
  fireEvent.change(screen.getByLabelText('Nama pemilik rekening'), { target: { value: validBody.accountName } });
  fireEvent.change(screen.getByLabelText('Nomor rekening'), { target: { value: validBody.accountNumber } });
  fireEvent.change(screen.getByLabelText('Referensi transaksi'), { target: { value: validBody.reference } });
  fireEvent.change(screen.getByLabelText('Catatan'), { target: { value: validBody.note } });
}

/**
 * A third Admin -- neither the requester nor the approver -- completes an
 * APPROVED Refund with proof of transfer and the Donor's destination
 * (ticket 31; CONTEXT.md, Refund's two-person rule). The server already
 * enforces the refusal (TwoPersonRuleError) for both other Admins; this
 * form names the rule before a submit that would only be refused, the same
 * choice every other money-action form in this repo makes.
 */
describe('AdminRefundCompleteForm', () => {
  it('shows the two-person rule notice, not a form, when the viewer requested this Refund', () => {
    render(
      <AdminRefundCompleteForm
        refundId="refund-1"
        subject={{ type: 'campaign', slug: 'wakaf-sumur' }}
        actorId="admin-1"
        requestedById="admin-1"
        approvedById="admin-2"
      />,
    );

    expect(screen.getByText(/tidak bisa menandainya selesai sendiri/i)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the two-person rule notice, not a form, when the viewer approved this Refund', () => {
    render(
      <AdminRefundCompleteForm
        refundId="refund-1"
        subject={{ type: 'campaign', slug: 'wakaf-sumur' }}
        actorId="admin-2"
        requestedById="admin-1"
        approvedById="admin-2"
      />,
    );

    expect(screen.getByText(/tidak bisa menandainya selesai sendiri/i)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the submit button disabled until every field is filled', () => {
    render(
      <AdminRefundCompleteForm
        refundId="refund-1"
        subject={{ type: 'campaign', slug: 'wakaf-sumur' }}
        actorId="admin-3"
        requestedById="admin-1"
        approvedById="admin-2"
      />,
    );

    expect(screen.getByRole('button', { name: /tandai refund selesai/i })).toBeDisabled();
    fillValidForm();
    expect(screen.getByRole('button', { name: /tandai refund selesai/i })).not.toBeDisabled();
  });

  it('posts to the Campaign refund complete route with proof and destination for a third Admin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AdminRefundCompleteForm
        refundId="refund-1"
        subject={{ type: 'campaign', slug: 'wakaf-sumur' }}
        actorId="admin-3"
        requestedById="admin-1"
        approvedById="admin-2"
      />,
    );

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /tandai refund selesai/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/campaigns/wakaf-sumur/refunds/refund-1/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proofReference: validBody.reference,
          proofNote: validBody.note,
          donorBankCode: validBody.bankCode,
          donorAccountName: validBody.accountName,
          donorAccountNumber: validBody.accountNumber,
        }),
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('posts to the Volunteer Trip refund complete route for a Trip subject', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AdminRefundCompleteForm
        refundId="refund-2"
        subject={{ type: 'trip', slug: 'trip-lombok' }}
        actorId="admin-3"
        requestedById="admin-1"
        approvedById="admin-2"
      />,
    );

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /tandai refund selesai/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/volunteer-trips/trip-lombok/refunds/refund-2/complete',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('shows the server refusal in its own words', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Referensi transaksi wajib diisi.' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AdminRefundCompleteForm
        refundId="refund-1"
        subject={{ type: 'campaign', slug: 'wakaf-sumur' }}
        actorId="admin-3"
        requestedById="admin-1"
        approvedById="admin-2"
      />,
    );

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /tandai refund selesai/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Referensi transaksi wajib diisi.');
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
