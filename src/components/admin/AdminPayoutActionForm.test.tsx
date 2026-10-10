import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { AdminPayoutActionForm } from './AdminPayoutActionForm';

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

describe('AdminPayoutActionForm -- approving a DRAFT Payout (ticket 02: provider balance is the gate)', () => {
  const baseProps = {
    payoutId: 'payout-1',
    status: 'DRAFT' as const,
    subject: { type: 'campaign' as const, slug: 'sumur-desa' },
    actorId: 'admin-2',
    requestedById: 'fundraiser-1',
    approvedById: null,
  };

  it('asks for which provider and what its dashboard showed, and posts both to the Campaign approve route', async () => {
    mockFetch.mockImplementation(() => ok({ id: 'payout-1', status: 'APPROVED' }));

    render(<AdminPayoutActionForm {...baseProps} />);

    fireEvent.change(screen.getByLabelText(/^penyedia pembayaran$/i), { target: { value: 'sumopod' } });
    fireEvent.change(screen.getByLabelText(/saldo/i), { target: { value: '5000000' } });
    fireEvent.click(screen.getByRole('button', { name: /setujui/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/campaigns/sumur-desa/payouts/payout-1/approve');
    expect(JSON.parse(init.body)).toEqual({ provider: 'sumopod', providerBalance: 5_000_000 });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('posts to the Volunteer Trip approve route when the subject is a Trip', async () => {
    mockFetch.mockImplementation(() => ok({ id: 'payout-1', status: 'APPROVED' }));

    render(<AdminPayoutActionForm {...baseProps} subject={{ type: 'trip', slug: 'trip-lombok' }} />);

    fireEvent.change(screen.getByLabelText(/^penyedia pembayaran$/i), { target: { value: 'sumopod' } });
    fireEvent.change(screen.getByLabelText(/saldo/i), { target: { value: '5000000' } });
    fireEvent.click(screen.getByRole('button', { name: /setujui/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch.mock.calls[0][0]).toBe('/api/volunteer-trips/trip-lombok/payouts/payout-1/approve');
  });

  it('keeps the button disabled until a provider is chosen and a balance is typed', () => {
    render(<AdminPayoutActionForm {...baseProps} />);
    expect(screen.getByRole('button', { name: /setujui/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^penyedia pembayaran$/i), { target: { value: 'sumopod' } });
    expect(screen.getByRole('button', { name: /setujui/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/saldo/i), { target: { value: '5000000' } });
    expect(screen.getByRole('button', { name: /setujui/i })).not.toBeDisabled();
  });

  it('shows the server refusal in its own words rather than a generic message', async () => {
    mockFetch.mockImplementation(() =>
      refused(422, { error: 'Saldo provider tercatat kurang dari jumlah Payout.', code: 'PROVIDER_BALANCE_INSUFFICIENT' }),
    );

    render(<AdminPayoutActionForm {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/^penyedia pembayaran$/i), { target: { value: 'sumopod' } });
    fireEvent.change(screen.getByLabelText(/saldo/i), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: /setujui/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Saldo provider tercatat kurang dari jumlah Payout.');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('warns instead of showing the form when the signed-in Admin is the one who requested it (two-person rule)', () => {
    render(<AdminPayoutActionForm {...baseProps} actorId="fundraiser-1" />);

    expect(screen.getByText(/orang yang sama/i)).toBeDefined();
    expect(screen.queryByLabelText(/^penyedia pembayaran$/i)).toBeNull();
  });
});

describe('AdminPayoutActionForm -- recording "saldo penyedia kurang" (ticket 30)', () => {
  const baseProps = {
    payoutId: 'payout-1',
    status: 'DRAFT' as const,
    subject: { type: 'campaign' as const, slug: 'sumur-desa' },
    actorId: 'admin-2',
    requestedById: 'fundraiser-1',
    approvedById: null,
  };

  it('posts the same provider and balance fields to the Payout-id-only balance-check route', async () => {
    mockFetch.mockImplementation(() => ok({ id: 'check-1' }));

    render(<AdminPayoutActionForm {...baseProps} />);

    fireEvent.change(screen.getByLabelText(/^penyedia pembayaran$/i), { target: { value: 'sumopod' } });
    fireEvent.change(screen.getByLabelText(/saldo/i), { target: { value: '300000' } });
    fireEvent.click(screen.getByRole('button', { name: /catat.*kurang/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/admin/payouts/payout-1/balance-check');
    expect(JSON.parse(init.body)).toEqual({ provider: 'sumopod', providerBalance: 300_000 });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('keeps the button disabled until a provider is chosen and a balance is typed, same as Setujui', () => {
    render(<AdminPayoutActionForm {...baseProps} />);
    expect(screen.getByRole('button', { name: /catat.*kurang/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^penyedia pembayaran$/i), { target: { value: 'sumopod' } });
    fireEvent.change(screen.getByLabelText(/saldo/i), { target: { value: '300000' } });
    expect(screen.getByRole('button', { name: /catat.*kurang/i })).not.toBeDisabled();
  });

  it('shows the server refusal when the reading is not actually short', async () => {
    mockFetch.mockImplementation(() =>
      refused(422, {
        error: 'Saldo yang tercatat sudah mencukupi, gunakan Setujui pencairan.',
        code: 'PROVIDER_BALANCE_NOT_SHORT',
      }),
    );

    render(<AdminPayoutActionForm {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/^penyedia pembayaran$/i), { target: { value: 'sumopod' } });
    fireEvent.change(screen.getByLabelText(/saldo/i), { target: { value: '5000000' } });
    fireEvent.click(screen.getByRole('button', { name: /catat.*kurang/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('gunakan Setujui pencairan');
  });

  it('offers neither the approve nor the balance-check action to the requester (two-person rule)', () => {
    render(<AdminPayoutActionForm {...baseProps} actorId="fundraiser-1" />);

    expect(screen.queryByRole('button', { name: /catat.*kurang/i })).toBeNull();
  });
});

describe('AdminPayoutActionForm -- completing an APPROVED Payout (ticket 13: structured proof)', () => {
  const baseProps = {
    payoutId: 'payout-1',
    status: 'APPROVED' as const,
    subject: { type: 'campaign' as const, slug: 'sumur-desa' },
    actorId: 'admin-3',
    requestedById: 'fundraiser-1',
    approvedById: 'admin-2',
  };

  it('collects a transaction reference and a free-text note, and posts both as their own fields -- the server joins them', async () => {
    mockFetch.mockImplementation(() => ok({ id: 'payout-1', status: 'COMPLETED' }));

    render(<AdminPayoutActionForm {...baseProps} />);

    fireEvent.change(screen.getByLabelText(/referensi transaksi/i), { target: { value: 'TRX-001' } });
    fireEvent.change(screen.getByLabelText(/catatan/i), { target: { value: 'Ditransfer via BCA mobile' } });
    fireEvent.click(screen.getByRole('button', { name: /tandai selesai/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/campaigns/sumur-desa/payouts/payout-1/complete');
    expect(JSON.parse(init.body)).toEqual({ proofReference: 'TRX-001', proofNote: 'Ditransfer via BCA mobile' });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('posts to the Volunteer Trip complete route when the subject is a Trip', async () => {
    mockFetch.mockImplementation(() => ok({ id: 'payout-1', status: 'COMPLETED' }));

    render(<AdminPayoutActionForm {...baseProps} subject={{ type: 'trip', slug: 'trip-lombok' }} />);

    fireEvent.change(screen.getByLabelText(/referensi transaksi/i), { target: { value: 'TRX-001' } });
    fireEvent.change(screen.getByLabelText(/catatan/i), { target: { value: 'Ditransfer via BCA mobile' } });
    fireEvent.click(screen.getByRole('button', { name: /tandai selesai/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch.mock.calls[0][0]).toBe('/api/volunteer-trips/trip-lombok/payouts/payout-1/complete');
  });

  it('keeps the button disabled until both the reference and the note are filled in', () => {
    render(<AdminPayoutActionForm {...baseProps} />);
    expect(screen.getByRole('button', { name: /tandai selesai/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/referensi transaksi/i), { target: { value: 'TRX-001' } });
    expect(screen.getByRole('button', { name: /tandai selesai/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/catatan/i), { target: { value: 'Ditransfer via BCA' } });
    expect(screen.getByRole('button', { name: /tandai selesai/i })).not.toBeDisabled();
  });

  it('shows the server refusal in its own words', async () => {
    mockFetch.mockImplementation(() =>
      refused(403, { error: 'Admin yang menyelesaikan harus berbeda dari yang menyetujui.', code: 'TWO_PERSON_RULE' }),
    );

    render(<AdminPayoutActionForm {...baseProps} />);
    fireEvent.change(screen.getByLabelText(/referensi transaksi/i), { target: { value: 'TRX-001' } });
    fireEvent.change(screen.getByLabelText(/catatan/i), { target: { value: 'Ditransfer via BCA' } });
    fireEvent.click(screen.getByRole('button', { name: /tandai selesai/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Admin yang menyelesaikan harus berbeda dari yang menyetujui.');
  });

  it('warns instead of showing the form when the signed-in Admin is the one who approved it (two-person rule)', () => {
    render(<AdminPayoutActionForm {...baseProps} actorId="admin-2" />);

    expect(screen.getByText(/orang yang sama/i)).toBeDefined();
    expect(screen.queryByLabelText(/referensi transaksi/i)).toBeNull();
  });
});

describe('AdminPayoutActionForm -- a Payout that is neither DRAFT nor APPROVED', () => {
  it('renders nothing actionable', () => {
    const { container } = render(
      <AdminPayoutActionForm
        payoutId="payout-1"
        status="COMPLETED"
        subject={{ type: 'campaign', slug: 'sumur-desa' }}
        actorId="admin-1"
        requestedById="fundraiser-1"
        approvedById="admin-2"
      />,
    );
    expect(container.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('AdminPayoutActionForm -- opening the account number (ticket 89)', () => {
  const approved = {
    payoutId: 'payout-1',
    status: 'APPROVED' as const,
    subject: { type: 'campaign' as const, slug: 'sumur-desa' },
    actorId: 'admin-3',
    requestedById: 'fundraiser-1',
    approvedById: 'admin-2',
  };

  it('shows no number until asked, then posts to the reveal route and shows what it returns', async () => {
    mockFetch.mockImplementation(() => ok({ accountNumber: '1234567890' }));
    render(<AdminPayoutActionForm {...approved} />);
    expect(screen.queryByText('1234567890')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /tampilkan nomor rekening/i }));

    expect(await screen.findByText('1234567890')).toBeDefined();
    expect(mockFetch).toHaveBeenCalledWith('/api/admin/payouts/payout-1/reveal-account', { method: 'POST' });
  });

  it('shows the server refusal and no number', async () => {
    mockFetch.mockImplementation(() => refused(403, { error: 'Payout harus diselesaikan Admin lain.' }));
    render(<AdminPayoutActionForm {...approved} />);

    fireEvent.click(screen.getByRole('button', { name: /tampilkan nomor rekening/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Payout harus diselesaikan Admin lain.');
    expect(screen.queryByTestId('revealed-account-number')).toBeNull();
  });

  it('offers no reveal button to the approver, on a DRAFT, or to anyone but the completing Admin', () => {
    render(<AdminPayoutActionForm {...approved} actorId="admin-2" />);
    expect(screen.queryByRole('button', { name: /tampilkan nomor rekening/i })).toBeNull();
    cleanup();
    render(<AdminPayoutActionForm {...approved} status="DRAFT" approvedById={null} actorId="admin-3" />);
    expect(screen.queryByRole('button', { name: /tampilkan nomor rekening/i })).toBeNull();
  });
});
