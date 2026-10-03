import type { ComponentProps } from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { AdminRefundResolveForm } from './AdminRefundResolveForm';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

type Props = ComponentProps<typeof AdminRefundResolveForm>;

const CAMPAIGN = { type: 'campaign', slug: 'wakaf-sumur' } as const;
const TRIP = { type: 'trip', slug: 'trip-lombok' } as const;

/** A REQUESTED Refund (nobody has approved it), viewed by an Admin who did not request it (admin-1 did). */
function renderReject(overrides: Partial<Props> = {}) {
  return render(
    <AdminRefundResolveForm
      action="reject"
      refundId="refund-1"
      subject={CAMPAIGN}
      actorId="admin-2"
      requestedById="admin-1"
      approvedById={null}
      isOwnSubject={false}
      {...overrides}
    />,
  );
}

/** An APPROVED Refund (admin-1 requested it, admin-2 approved it), viewed by a third Admin. */
function renderFail(overrides: Partial<Props> = {}) {
  return render(
    <AdminRefundResolveForm
      action="fail"
      refundId="refund-1"
      subject={CAMPAIGN}
      actorId="admin-3"
      requestedById="admin-1"
      approvedById="admin-2"
      isOwnSubject={false}
      {...overrides}
    />,
  );
}

/**
 * The way back for a Refund (ticket 50 on top of ticket 49; CONTEXT.md,
 * Refund): an Admin REJECTS a Refund before it is approved, or marks an
 * APPROVED one FAILED because the Donor could not be paid. The server holds
 * every rule -- which statuses, who is barred, the reason's length -- so
 * these tests only pin what this form adds: it asks for a reason, it posts
 * to the right door, it names the actor rule instead of offering a button
 * that is certain to be refused, and it shows the server's own refusal.
 */
describe('AdminRefundResolveForm -- reject', () => {
  it('keeps the button disabled until a reason is typed', () => {
    renderReject();

    expect(screen.getByRole('button', { name: /tolak refund/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Alasan penolakan'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /tolak refund/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Alasan penolakan'), { target: { value: 'Donor membatalkan permintaan' } });
    expect(screen.getByRole('button', { name: /tolak refund/i })).not.toBeDisabled();
  });

  it('patches the reason to the Campaign refund reject route, then refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    renderReject();

    fireEvent.change(screen.getByLabelText('Alasan penolakan'), { target: { value: 'Donor membatalkan permintaan' } });
    fireEvent.click(screen.getByRole('button', { name: /tolak refund/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/campaigns/wakaf-sumur/refunds/refund-1/reject', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Donor membatalkan permintaan' }),
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
});

describe('AdminRefundResolveForm -- fail', () => {
  it('keeps the button disabled until a reason is typed', () => {
    renderFail();

    expect(screen.getByRole('button', { name: /tandai refund gagal/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Alasan kegagalan'), { target: { value: 'Rekening Donor sudah ditutup' } });
    expect(screen.getByRole('button', { name: /tandai refund gagal/i })).not.toBeDisabled();
  });

  it('patches the reason to the Campaign refund fail route, then refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    renderFail();

    fireEvent.change(screen.getByLabelText('Alasan kegagalan'), { target: { value: 'Rekening Donor sudah ditutup' } });
    fireEvent.click(screen.getByRole('button', { name: /tandai refund gagal/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/campaigns/wakaf-sumur/refunds/refund-1/fail', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Rekening Donor sudah ditutup' }),
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
});

describe('AdminRefundResolveForm -- Volunteer Trip subject', () => {
  it.each([
    ['reject', renderReject, 'Alasan penolakan', /tolak refund/i],
    ['fail', renderFail, 'Alasan kegagalan', /tandai refund gagal/i],
  ] as const)('posts %s to the Volunteer Trip route, not the Campaign one', async (action, renderForm, label, button) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    renderForm({ refundId: 'refund-2', subject: TRIP });

    fireEvent.change(screen.getByLabelText(label), { target: { value: 'Batch dibatalkan' } });
    fireEvent.click(screen.getByRole('button', { name: button }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/volunteer-trips/trip-lombok/refunds/refund-2/${action}`,
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ reason: 'Batch dibatalkan' }) }),
      ),
    );
  });
});

/**
 * What the Admin reads when the server says no. The sentences are the ones
 * the routes really answer with (src/lib/money/errors.ts,
 * src/lib/capacity.ts), because "in its own words" is the whole behaviour:
 * the form must not paraphrase a refusal or swallow it.
 */
describe('AdminRefundResolveForm -- refusals from the route', () => {
  const STATUS_409 = 'Refund tidak berada pada status yang memungkinkan tindakan ini.';

  it.each([
    ['reject', 403, renderReject, 'Refund tidak dapat ditolak oleh Admin yang mengajukannya.', 'Alasan penolakan', /tolak refund/i],
    ['reject', 409, renderReject, STATUS_409, 'Alasan penolakan', /tolak refund/i],
    ['fail', 403, renderFail, 'Refund tidak dapat ditandai gagal oleh Admin yang menyetujuinya.', 'Alasan kegagalan', /tandai refund gagal/i],
    ['fail', 409, renderFail, STATUS_409, 'Alasan kegagalan', /tandai refund gagal/i],
  ] as const)(
    "shows the %s route's %i answer in its own words, keeps the reason and does not refresh",
    async (_action, status, renderForm, message, label, button) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: message }) }));

      renderForm();

      fireEvent.change(screen.getByLabelText(label), { target: { value: 'Alasan yang sudah diketik' } });
      fireEvent.click(screen.getByRole('button', { name: button }));

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(mockRefresh).not.toHaveBeenCalled();
      // The Admin can correct and resend: nothing was cleared or left locked.
      expect(screen.getByLabelText(label)).toHaveValue('Alasan yang sudah diketik');
      expect(screen.getByRole('button', { name: button })).not.toBeDisabled();
    },
  );

  it.each([
    ['reject', renderReject, 'Alasan penolakan', /tolak refund/i, 'Gagal menolak refund.'],
    ['fail', renderFail, 'Alasan kegagalan', /tandai refund gagal/i, 'Gagal menandai refund gagal.'],
  ] as const)(
    'says %s failed in a generic sentence when the answer is unreadable or the request never arrives',
    async (_action, renderForm, label, button, generic) => {
      renderForm();
      fireEvent.change(screen.getByLabelText(label), { target: { value: 'Alasan' } });

      // An error page that is not JSON.
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          json: async () => {
            throw new Error('not json');
          },
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: button }));
      expect(await screen.findByRole('alert')).toHaveTextContent(generic);

      // The request itself rejects (offline).
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
      fireEvent.click(screen.getByRole('button', { name: button }));
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(generic));
      expect(mockRefresh).not.toHaveBeenCalled();
    },
  );
});

/**
 * The actor rules, said before the server has to (CONTEXT.md, Refund).
 * REJECTED: not the Admin who created the Refund, not the Fundraiser of its
 * Campaign or Volunteer Trip. FAILED: not the Admin who approved it, not
 * the Fundraiser. The two are NOT the same list -- the requester of an
 * APPROVED Refund may mark it failed, and only the approver may not.
 */
describe('AdminRefundResolveForm -- who is barred', () => {
  it('reject: shows a notice instead of a button to the Admin who requested the Refund', () => {
    renderReject({ actorId: 'admin-1' });

    expect(screen.getByText(/tidak bisa menolaknya sendiri/i)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByLabelText('Alasan penolakan')).toBeNull();
  });

  it('fail: shows a notice instead of a button to the Admin who approved the Refund', () => {
    renderFail({ actorId: 'admin-2' });

    expect(screen.getByText(/tidak bisa menandainya gagal sendiri/i)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByLabelText('Alasan kegagalan')).toBeNull();
  });

  it('fail: the Admin who requested an APPROVED Refund is not barred -- only its approver is', () => {
    renderFail({ actorId: 'admin-1' });

    fireEvent.change(screen.getByLabelText('Alasan kegagalan'), { target: { value: 'Rekening Donor sudah ditutup' } });
    expect(screen.getByRole('button', { name: /tandai refund gagal/i })).not.toBeDisabled();
  });

  it.each([
    ['reject', 'Campaign', renderReject, CAMPAIGN, /Fundraiser Campaign ini/],
    ['reject', 'Volunteer Trip', renderReject, TRIP, /Fundraiser Volunteer Trip ini/],
    ['fail', 'Campaign', renderFail, CAMPAIGN, /Fundraiser Campaign ini/],
    ['fail', 'Volunteer Trip', renderFail, TRIP, /Fundraiser Volunteer Trip ini/],
  ] as const)('%s: shows a notice instead of a button to the Fundraiser of a %s', (_action, _subjectName, renderForm, subject, notice) => {
    renderForm({ subject, isOwnSubject: true });

    expect(screen.getByText(notice)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
