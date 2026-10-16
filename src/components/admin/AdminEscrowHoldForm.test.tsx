import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { AdminEscrowHoldForm } from './AdminEscrowHoldForm';

const originalFetch = global.fetch;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  global.fetch = originalFetch;
});

function mockFetch(response: { ok: boolean; body?: unknown }) {
  const fn = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.ok ? 201 : 400,
    json: async () => response.body ?? {},
  });
  global.fetch = fn as never;
  return fn;
}

function postedBody(fn: ReturnType<typeof vi.fn>) {
  const [url, init] = fn.mock.calls[0];
  expect(url).toBe('/api/admin/escrow-hold');
  expect(init.method).toBe('POST');
  return JSON.parse(init.body);
}

describe('AdminEscrowHoldForm', () => {
  it('posts the default length', async () => {
    const fetchMock = mockFetch({ ok: true });
    render(<AdminEscrowHoldForm />);

    fireEvent.change(screen.getByLabelText(/^Lama tahan/i), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(postedBody(fetchMock)).toEqual({ scope: 'DEFAULT', days: 10 });
    expect(await screen.findByRole('status')).toHaveTextContent(/tersimpan/i);
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('posts a Category override', async () => {
    const fetchMock = mockFetch({ ok: true });
    render(<AdminEscrowHoldForm />);

    fireEvent.change(screen.getByLabelText(/^Yang diubah/i), { target: { value: 'CATEGORY' } });
    fireEvent.change(screen.getByLabelText(/^Category/i), { target: { value: ' bencana ' } });
    fireEvent.change(screen.getByLabelText(/^Lama tahan/i), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(postedBody(fetchMock)).toEqual({ scope: 'CATEGORY', category: 'bencana', days: 2 });
  });

  it('cannot save without days, or a Category override without a category', () => {
    render(<AdminEscrowHoldForm />);
    const save = screen.getByRole('button', { name: /simpan/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^Yang diubah/i), { target: { value: 'CATEGORY' } });
    fireEvent.change(screen.getByLabelText(/^Lama tahan/i), { target: { value: '3' } });
    expect(save).toBeDisabled();
  });

  it("shows the server's own refusal and does not refresh", async () => {
    mockFetch({ ok: false, body: { error: 'Lama Escrow Hold harus bilangan bulat hari antara 1 dan 30.' } });
    render(<AdminEscrowHoldForm />);

    fireEvent.change(screen.getByLabelText(/^Lama tahan/i), { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/antara 1 dan 30/);
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
