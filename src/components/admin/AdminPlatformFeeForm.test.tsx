import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { AdminPlatformFeeForm } from './AdminPlatformFeeForm';

const originalFetch = global.fetch;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  global.fetch = originalFetch;
});

function mockFetch(response: { ok: boolean; status?: number; body?: unknown }) {
  const fn = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 201 : 400),
    json: async () => response.body ?? {},
  });
  global.fetch = fn as never;
  return fn;
}

function postedBody(fn: ReturnType<typeof vi.fn>) {
  const [url, init] = fn.mock.calls[0];
  expect(url).toBe('/api/admin/platform-fee');
  expect(init.method).toBe('POST');
  return JSON.parse(init.body);
}

/**
 * Ticket 88: the form posts to the existing POST /api/admin/platform-fee
 * unchanged. It holds no rate and no threshold of its own: the percent an
 * Admin types is only converted to basis points (the unit the route takes),
 * and every refusal shown is the server's own.
 */
describe('AdminPlatformFeeForm', () => {
  it('posts a KIND rule with the typed percent converted to basis points', async () => {
    const fetchMock = mockFetch({ ok: true });
    render(<AdminPlatformFeeForm />);

    fireEvent.change(screen.getByLabelText(/^Yang diubah/i), { target: { value: 'KIND' } });
    fireEvent.change(screen.getByLabelText(/^Kind/i), { target: { value: 'ZAKAT' } });
    fireEvent.change(screen.getByLabelText(/^Persen/i), { target: { value: '2,5' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(postedBody(fetchMock)).toEqual({ target: 'rule', scope: 'KIND', kind: 'ZAKAT', percentBps: 250 });
    expect(await screen.findByRole('status')).toBeDefined();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('posts a CATEGORY rule, 0 percent included', async () => {
    const fetchMock = mockFetch({ ok: true });
    render(<AdminPlatformFeeForm />);

    fireEvent.change(screen.getByLabelText(/^Yang diubah/i), { target: { value: 'CATEGORY' } });
    fireEvent.change(screen.getByLabelText(/^Category/i), { target: { value: 'Bencana' } });
    fireEvent.change(screen.getByLabelText(/^Persen/i), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(postedBody(fetchMock)).toEqual({ target: 'rule', scope: 'CATEGORY', category: 'Bencana', percentBps: 0 });
  });

  it('posts a CAMPAIGN rule by Campaign id', async () => {
    const fetchMock = mockFetch({ ok: true });
    render(<AdminPlatformFeeForm />);

    fireEvent.change(screen.getByLabelText(/^Yang diubah/i), { target: { value: 'CAMPAIGN' } });
    fireEvent.change(screen.getByLabelText(/^ID Campaign/i), { target: { value: 'camp-1' } });
    fireEvent.change(screen.getByLabelText(/^Persen/i), { target: { value: '10.25' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(postedBody(fetchMock)).toEqual({ target: 'rule', scope: 'CAMPAIGN', campaignId: 'camp-1', percentBps: 1025 });
  });

  it('posts a threshold as whole rupiah', async () => {
    const fetchMock = mockFetch({ ok: true });
    render(<AdminPlatformFeeForm />);

    fireEvent.change(screen.getByLabelText(/^Yang diubah/i), { target: { value: 'THRESHOLD' } });
    expect(screen.queryByLabelText(/^Persen/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Ambang/i), { target: { value: '12abc000' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(postedBody(fetchMock)).toEqual({ target: 'threshold', amount: 12000 });
  });

  it('keeps Simpan disabled until the form is complete and well formed', () => {
    render(<AdminPlatformFeeForm />);
    const save = screen.getByRole('button', { name: /simpan/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^Persen/i), { target: { value: '2,555' } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Persen/i), { target: { value: '5' } });
    expect(save).not.toBeDisabled();
  });

  it("shows the server's own refusal and does not refresh", async () => {
    mockFetch({ ok: false, status: 400, body: { error: 'percentBps harus bilangan bulat antara 0 dan 10000 (0% - 100%).' } });
    render(<AdminPlatformFeeForm />);

    fireEvent.change(screen.getByLabelText(/^Persen/i), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/percentBps harus bilangan bulat/);
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
