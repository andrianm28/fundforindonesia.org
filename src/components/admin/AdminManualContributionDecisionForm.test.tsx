import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { AdminManualContributionDecisionForm } from './AdminManualContributionDecisionForm';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/**
 * The second Admin decides a PENDING Manual Contribution (ticket 26;
 * CONTEXT.md, Manual Contribution's two-person rule): approve credits it,
 * reject declines it with a reason. A third Admin reverses an APPROVED one,
 * also with a reason. The server is the only holder of the two-person rule
 * (SelfApprovalError) -- this form only asks for confirmation (and, for
 * reject/reverse, a reason) and shows the server's own refusal in its own
 * words.
 */
describe('AdminManualContributionDecisionForm', () => {
  it('shows the two-person rule notice, not the approve/reject buttons, for the recorder viewing a PENDING record', () => {
    render(
      <AdminManualContributionDecisionForm
        manualContributionId="mc-1"
        status="PENDING"
        actorId="admin-1"
        recordedById="admin-1"
        decidedById={null}
      />,
    );

    expect(screen.getByText(/tidak bisa menyetujuinya sendiri/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /setujui/i })).toBeNull();
  });

  it('posts decision=approve for a different Admin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AdminManualContributionDecisionForm
        manualContributionId="mc-1"
        status="PENDING"
        actorId="admin-2"
        recordedById="admin-1"
        decidedById={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /setujui/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/manual-contributions/mc-1/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('requires a reason before rejecting, and posts decision=reject with it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AdminManualContributionDecisionForm
        manualContributionId="mc-1"
        status="PENDING"
        actorId="admin-2"
        recordedById="admin-1"
        decidedById={null}
      />,
    );

    expect(screen.getByRole('button', { name: /tolak/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/alasan/i), { target: { value: 'bukti tidak jelas' } });
    expect(screen.getByRole('button', { name: /tolak/i })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /tolak/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/manual-contributions/mc-1/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'reject', reason: 'bukti tidak jelas' }),
      }),
    );
  });

  it('shows the two-person rule notice for the recorder or the approver viewing an APPROVED record', () => {
    render(
      <AdminManualContributionDecisionForm
        manualContributionId="mc-1"
        status="APPROVED"
        actorId="admin-2"
        recordedById="admin-1"
        decidedById="admin-2"
      />,
    );

    expect(screen.getByText(/tidak bisa membalikkannya sendiri/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /balikkan/i })).toBeNull();
  });

  it('posts decision=reverse with a reason for a third Admin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AdminManualContributionDecisionForm
        manualContributionId="mc-1"
        status="APPROVED"
        actorId="admin-3"
        recordedById="admin-1"
        decidedById="admin-2"
      />,
    );

    fireEvent.change(screen.getByLabelText(/alasan/i), { target: { value: 'salah catat' } });
    fireEvent.click(screen.getByRole('button', { name: /balikkan/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/manual-contributions/mc-1/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'reverse', reason: 'salah catat' }),
      }),
    );
  });

  it('shows the server refusal in its own words', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Alasan wajib diisi.' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AdminManualContributionDecisionForm
        manualContributionId="mc-1"
        status="PENDING"
        actorId="admin-2"
        recordedById="admin-1"
        decidedById={null}
      />,
    );

    fireEvent.change(screen.getByLabelText(/alasan/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /tolak/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Alasan wajib diisi.');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('renders nothing for a REJECTED or REVERSED record', () => {
    const { container } = render(
      <AdminManualContributionDecisionForm
        manualContributionId="mc-1"
        status="REJECTED"
        actorId="admin-2"
        recordedById="admin-1"
        decidedById="admin-2"
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
