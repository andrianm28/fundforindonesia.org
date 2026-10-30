import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { TripPayoutPanel } from './TripPayoutPanel';

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const res = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

const READ = {
  escrowHold: 120_000,
  tripBalance: 500_000,
  withdrawable: 300_000,
  sandbox: false,
  payouts: [],
  bankAccounts: [{ id: 'bank-1', bankCode: 'BCA', accountName: 'Fundraiser One' }],
  hasUnverifiedBankAccount: false,
};

function serve(read: unknown, post?: Promise<Response>) {
  fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
    init?.method === 'POST' ? (post ?? res(201, {})) : res(200, read),
  );
}

async function fillForm() {
  await screen.findByLabelText('Rekening tujuan');
  fireEvent.change(screen.getByLabelText('Rekening tujuan'), { target: { value: 'bank-1' } });
  fireEvent.change(screen.getByLabelText('Jumlah pencairan'), { target: { value: '100000' } });
  fireEvent.change(screen.getByLabelText('Keterangan'), { target: { value: ' Tahap 1 ' } });
}

beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
});
afterEach(() => cleanup());

describe('TripPayoutPanel', () => {
  it('reads the Trip payout route and shows the held and the withdrawable figures separately', async () => {
    serve(READ);
    render(<TripPayoutPanel slug="trip-a" />);

    expect(await screen.findByText('Rp120.000')).toBeInTheDocument();
    expect(screen.getByText('Rp300.000')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/volunteer-trips/trip-a/payouts');
  });

  it('with no verified account and none ever added, links to /akun/rekening and says none was added', async () => {
    serve({ ...READ, bankAccounts: [], hasUnverifiedBankAccount: false });
    render(<TripPayoutPanel slug="trip-a" />);

    const link = await screen.findByRole('link', { name: /Tambah rekening bank/ });
    expect(link).toHaveAttribute('href', '/akun/rekening');
    expect(screen.getByText(/belum ada rekening terverifikasi/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Rekening tujuan')).toBeNull();
  });

  it('with an account on file that is not verified (pending or rejected), says so and links to its status', async () => {
    serve({ ...READ, bankAccounts: [], hasUnverifiedBankAccount: true });
    render(<TripPayoutPanel slug="trip-a" />);

    const link = await screen.findByRole('link', { name: /Lihat status rekening/ });
    expect(link).toHaveAttribute('href', '/akun/rekening');
    expect(screen.getByText(/sudah pernah mengajukan rekening bank/)).toBeInTheDocument();
    expect(screen.queryByText(/Tambah rekening bank/)).toBeNull();
  });

  it('offers bank code and account name only, and has no field for an account number', async () => {
    serve(READ);
    render(<TripPayoutPanel slug="trip-a" />);

    expect(await screen.findByRole('option', { name: 'BCA - Fundraiser One' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/nomor rekening/i)).toBeNull();
  });

  it('posts only the account id, the amount and the description, then reloads', async () => {
    serve(READ);
    render(<TripPayoutPanel slug="trip-a" />);
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Ajukan pencairan' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(post[0]).toBe('/api/volunteer-trips/trip-a/payouts');
    expect(JSON.parse(post[1].body)).toEqual({ bankAccountId: 'bank-1', amount: 100_000, description: 'Tahap 1' });
  });

  it('shows the server domain error as given when funds are not yet from a completed Batch', async () => {
    const msg = 'Pencairan Trip Fee hanya bisa dari dana Batch yang sudah Selesai.';
    serve(READ, res(409, { error: msg, code: 'TRIP_PAYOUT_FUNDS_NOT_COMPLETED' }));
    render(<TripPayoutPanel slug="trip-a" />);
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Ajukan pencairan' }));

    expect(await screen.findByText(msg)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('warns and disables submit when the amount is above what is withdrawable', async () => {
    serve(READ);
    render(<TripPayoutPanel slug="trip-a" />);
    await fillForm();
    fireEvent.change(screen.getByLabelText('Jumlah pencairan'), { target: { value: '300001' } });

    expect(screen.getByText(/melebihi saldo yang bisa dicairkan/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajukan pencairan' })).toBeDisabled();
  });

  it('says nothing is withdrawable yet, and offers no form, when withdrawable is 0', async () => {
    serve({ ...READ, tripBalance: 80_000, withdrawable: 0 });
    render(<TripPayoutPanel slug="trip-a" />);

    expect(await screen.findByText(/belum ada dana dari Batch yang sudah Selesai/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajukan pencairan' })).toBeNull();
  });

  it('lists payouts with their status, and labels test money UJI', async () => {
    serve({
      ...READ,
      sandbox: true,
      payouts: [
        { id: 'p1', amount: 50_000, description: 'Tahap 1', status: 'DRAFT', createdAt: '2026-10-01T00:00:00.000Z' },
      ],
    });
    render(<TripPayoutPanel slug="trip-a" />);

    expect(await screen.findByText('Menunggu persetujuan Admin')).toBeInTheDocument();
    expect(screen.getByText(/Tahap 1/)).toBeInTheDocument();
    expect(screen.getByText(/Simulasi \(UJI\)/)).toBeInTheDocument();
  });

  it('shows a load error when the read fails', async () => {
    fetchMock.mockImplementation(() => res(500, {}));
    render(<TripPayoutPanel slug="trip-a" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat data pencairan.');
  });
});
