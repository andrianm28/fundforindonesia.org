import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { CampaignCloseActions } from './CampaignCloseActions';

/** Ticket 65: a Fundraiser marks an Active Campaign Completed or asks to cancel it. */
let respond: (url: string) => Response;
const sent: { url: string; body: unknown }[] = [];

beforeEach(() => {
  sent.length = 0;
  respond = () => Response.json({}, { status: 200 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init?.body)) });
      return respond(url);
    }),
  );
});

afterEach(() => {
  cleanup();
  mockRefresh.mockReset();
  vi.unstubAllGlobals();
});

function renderActions(props: Partial<Parameters<typeof CampaignCloseActions>[0]> = {}) {
  return render(<CampaignCloseActions slug="sumur" hasUpdate cancellationPending={false} {...props} />);
}

describe('Tandai Selesai', () => {
  it('asks for confirmation, then posts to the complete route without a reason and refreshes', async () => {
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Tandai Selesai' }));
    expect(sent).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Ya, tandai selesai' }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(sent).toEqual([{ url: '/api/campaigns/sumur/complete', body: {} }]);
  });

  it('lets the Fundraiser back out of the confirmation', () => {
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Tandai Selesai' }));

    fireEvent.click(screen.getByRole('button', { name: 'Batal' }));

    expect(screen.queryByRole('button', { name: 'Ya, tandai selesai' })).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('shows the domain refusal, such as a missing Campaign Update', async () => {
    respond = () =>
      Response.json({ error: 'Campaign belum punya Campaign Update.', code: 'MISSING_CAMPAIGN_UPDATE' }, { status: 409 });
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Tandai Selesai' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ya, tandai selesai' }));

    expect(await screen.findByText('Campaign belum punya Campaign Update.')).toBeDefined();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('tells the Fundraiser up front that a Campaign Update is needed when there is none', () => {
    renderActions({ hasUpdate: false });
    expect(screen.getByTestId('complete-needs-update')).toBeDefined();
  });
});

describe('Ajukan pembatalan', () => {
  it('posts the reason to the cancellation-requests route and refreshes', async () => {
    renderActions();
    fireEvent.change(screen.getByLabelText(/Alasan pembatalan/), { target: { value: '  Dana tidak lagi dibutuhkan.  ' } });

    fireEvent.click(screen.getByRole('button', { name: 'Ajukan Pembatalan' }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(sent).toEqual([
      { url: '/api/campaigns/sumur/cancellation-requests', body: { reason: 'Dana tidak lagi dibutuhkan.' } },
    ]);
  });

  it('asks for a reason before calling the server', async () => {
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Ajukan Pembatalan' }));

    expect(await screen.findByText('Alasan pembatalan harus diisi.')).toBeDefined();
    expect(sent).toHaveLength(0);
  });

  it('shows the refusal of a second request while one waits', async () => {
    respond = () =>
      Response.json(
        { error: 'Masih ada pengajuan Cancellation yang menunggu keputusan Admin.', code: 'CANCELLATION_ALREADY_PENDING' },
        { status: 409 },
      );
    renderActions();
    fireEvent.change(screen.getByLabelText(/Alasan pembatalan/), { target: { value: 'Alasan lain.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Ajukan Pembatalan' }));

    expect(await screen.findByText(/Masih ada pengajuan Cancellation yang menunggu/)).toBeDefined();
  });

  it('shows that a request is waiting instead of the form', () => {
    renderActions({ cancellationPending: true });

    expect(screen.getByTestId('cancellation-waiting')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Ajukan Pembatalan' })).toBeNull();
  });
});
