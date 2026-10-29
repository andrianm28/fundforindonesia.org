import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { AdminProviderWithdrawalForm } from './AdminProviderWithdrawalForm';

const originalFetch = global.fetch;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  global.fetch = originalFetch;
});

function mockFetch(response: { ok: boolean; body?: unknown }) {
  const fn = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.ok ? 201 : 409,
    json: async () => response.body ?? {},
  });
  global.fetch = fn as never;
  return fn;
}

function postedBody(fn: ReturnType<typeof vi.fn>) {
  const [url, init] = fn.mock.calls[0];
  expect(url).toBe('/api/admin/provider-withdrawals');
  expect(init.method).toBe('POST');
  return JSON.parse(init.body);
}

const ENTITIES = [{ id: 'po-yiem', name: 'Yayasan Indonesia Emas' }];

function fillRequired() {
  fireEvent.change(screen.getByLabelText(/^Referensi penarikan/i), { target: { value: ' WD-001 ' } });
  fireEvent.change(screen.getByLabelText(/^Nominal ditarik/i), { target: { value: '1.000.000' } });
  fireEvent.change(screen.getByLabelText(/^Nama pemilik rekening/i), { target: { value: 'YAY GENERASI JAYA INDO' } });
  fireEvent.change(screen.getByLabelText(/^Saldo penyedia sebelum/i), { target: { value: '1500000' } });
  fireEvent.change(screen.getByLabelText(/^Saldo penyedia sesudah/i), { target: { value: '500000' } });
  fireEvent.change(screen.getByLabelText(/^Bukti penarikan/i), { target: { value: 'Tangkapan layar dashboard 29/10' } });
}

describe('AdminProviderWithdrawalForm', () => {
  it('posts a sweep with rupiah amounts as whole numbers and the chosen Collecting Entity', async () => {
    const fetchMock = mockFetch({ ok: true, body: { withdrawal: { id: 'w1' } } });
    render(<AdminProviderWithdrawalForm providers={['sumopod']} collectingEntities={ENTITIES} />);

    fillRequired();
    fireEvent.change(screen.getByLabelText(/^Collecting Entity/i), { target: { value: 'po-yiem' } });
    fireEvent.click(screen.getByRole('button', { name: /catat penarikan/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(postedBody(fetchMock)).toEqual({
      provider: 'sumopod',
      reference: 'WD-001',
      amount: 1_000_000,
      destinationName: 'YAY GENERASI JAYA INDO',
      collectingEntityId: 'po-yiem',
      providerBalanceBefore: 1_500_000,
      providerBalanceAfter: 500_000,
      proofReference: 'Tangkapan layar dashboard 29/10',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/tercatat/i);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('leaves the Collecting Entity out when none is chosen', async () => {
    const fetchMock = mockFetch({ ok: true });
    render(<AdminProviderWithdrawalForm providers={['sumopod']} collectingEntities={ENTITIES} />);

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: /catat penarikan/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(postedBody(fetchMock)).not.toHaveProperty('collectingEntityId');
  });

  it('keeps the button disabled until every required field is filled', () => {
    mockFetch({ ok: true });
    render(<AdminProviderWithdrawalForm providers={['sumopod']} collectingEntities={ENTITIES} />);

    expect(screen.getByRole('button', { name: /catat penarikan/i })).toBeDisabled();
    fillRequired();
    expect(screen.getByRole('button', { name: /catat penarikan/i })).toBeEnabled();
  });

  it('refuses a comma or a minus instead of reading it as a different number', () => {
    mockFetch({ ok: true });
    render(<AdminProviderWithdrawalForm providers={['sumopod']} collectingEntities={ENTITIES} />);

    fillRequired();
    fireEvent.change(screen.getByLabelText(/^Nominal ditarik/i), { target: { value: '1.000,50' } });
    expect(screen.getByRole('button', { name: /catat penarikan/i })).toBeDisabled();
    expect(screen.getByText(/hanya berisi angka rupiah bulat/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Nominal ditarik/i), { target: { value: '-1000' } });
    expect(screen.getByRole('button', { name: /catat penarikan/i })).toBeDisabled();
  });

  it("shows the server's refusal in its own words and does not refresh", async () => {
    mockFetch({ ok: false, body: { error: 'Penarikan dengan referensi WD-001 dari penyedia sudah tercatat.' } });
    render(<AdminProviderWithdrawalForm providers={['sumopod']} collectingEntities={ENTITIES} />);

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: /catat penarikan/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Penarikan dengan referensi WD-001 dari penyedia sudah tercatat.');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('shows a readable message when the request itself fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network')) as never;
    render(<AdminProviderWithdrawalForm providers={['sumopod']} collectingEntities={ENTITIES} />);

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: /catat penarikan/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/gagal mencatat penarikan/i);
  });
});
