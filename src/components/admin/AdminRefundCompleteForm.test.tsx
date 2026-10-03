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
  accountNumber: '1234567890',
};

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Nomor rekening (ketik ulang)'), { target: { value: validBody.accountNumber } });
  fireEvent.change(screen.getByLabelText('Referensi transaksi'), { target: { value: validBody.reference } });
  fireEvent.change(screen.getByLabelText('Catatan'), { target: { value: validBody.note } });
}

/**
 * A third Admin -- neither the requester nor the approver -- completes an
 * APPROVED Refund with proof of transfer and the re-typed account number
 * (ticket 31; Q7(c), ADR 0018 Amendment 2026-09-28). The server already
 * enforces the refusal (TwoPersonRuleError) for both other Admins and the
 * REFUND_DESTINATION_MISMATCH when the re-typed number does not match what
 * was recorded at approval; this form names the rule before a submit that
 * would only be refused, the same choice every other money-action form in
 * this repo makes.
 *
 * NO BANK CODE OR ACCOUNT NAME FIELD HERE (Q7(c)): those were moved to
 * AdminRefundApproveForm. This form asks only for the re-typed account
 * number and the transfer proof.
 */
describe('AdminRefundCompleteForm', () => {
  it('shows the two-person rule notice, not a form, when the viewer requested this Refund', () => {
    render(
      <AdminRefundCompleteForm
        refundId="refund-1"
        subject={{ type: 'campaign', slug: 'wakaf-sumur' }}
        actorId="admin-1"
        requestedById="admin-1"
        isOwnSubject={false}
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
        isOwnSubject={false}
        approvedById="admin-2"
      />,
    );

    expect(screen.getByText(/tidak bisa menandainya selesai sendiri/i)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not render a bank code or account name field -- those are recorded at approval, not here', () => {
    render(
      <AdminRefundCompleteForm
        refundId="refund-1"
        subject={{ type: 'campaign', slug: 'wakaf-sumur' }}
        actorId="admin-3"
        requestedById="admin-1"
        isOwnSubject={false}
        approvedById="admin-2"
      />,
    );

    expect(screen.queryByLabelText('Kode bank')).toBeNull();
    expect(screen.queryByLabelText('Nama pemilik rekening')).toBeNull();
  });

  it('keeps the submit button disabled until every field is filled', () => {
    render(
      <AdminRefundCompleteForm
        refundId="refund-1"
        subject={{ type: 'campaign', slug: 'wakaf-sumur' }}
        actorId="admin-3"
        requestedById="admin-1"
        isOwnSubject={false}
        approvedById="admin-2"
      />,
    );

    expect(screen.getByRole('button', { name: /tandai refund selesai/i })).toBeDisabled();
    fillValidForm();
    expect(screen.getByRole('button', { name: /tandai refund selesai/i })).not.toBeDisabled();
  });

  it('posts to the Campaign refund complete route with proof and the re-typed number only, for a third Admin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AdminRefundCompleteForm
        refundId="refund-1"
        subject={{ type: 'campaign', slug: 'wakaf-sumur' }}
        actorId="admin-3"
        requestedById="admin-1"
        isOwnSubject={false}
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
        isOwnSubject={false}
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

  it('shows the server refusal in its own words, including a destination mismatch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: 'Nomor rekening yang diketik tidak sama dengan yang dicatat saat persetujuan.' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AdminRefundCompleteForm
        refundId="refund-1"
        subject={{ type: 'campaign', slug: 'wakaf-sumur' }}
        actorId="admin-3"
        requestedById="admin-1"
        isOwnSubject={false}
        approvedById="admin-2"
      />,
    );

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /tandai refund selesai/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nomor rekening yang diketik tidak sama dengan yang dicatat saat persetujuan.');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it.each([
    ['campaign', 'Campaign'],
    ['trip', 'Volunteer Trip'],
  ] as const)("tells the %s's own Fundraiser they cannot act as Admin on it, instead of the form", (type, name) => {
    render(
      <AdminRefundCompleteForm
        refundId="refund-1"
        subject={{ type, slug: 'slug-x' }}
        actorId="admin-3"
        requestedById="admin-1"
        isOwnSubject
        approvedById="admin-2"
      />,
    );

    expect(screen.getByText(new RegExp(`Fundraiser ${name} ini`))).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByLabelText('Nomor rekening (ketik ulang)')).toBeNull();
  });
});
