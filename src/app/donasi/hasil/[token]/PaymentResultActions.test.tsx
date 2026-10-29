import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

/**
 * The result page's moving parts (ticket 98): a bounded re-read while waiting
 * for the webhook, and "Coba bayar lagi" addressed by the page's token.
 */

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import { PaymentResultActions } from './PaymentResultActions';

const assign = vi.fn();
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('location', { ...window.location, assign });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body });
}

describe('PaymentResultActions', () => {
  it('re-reads the page every 5 seconds while waiting, and stops after 2 minutes', () => {
    vi.useFakeTimers();
    render(<PaymentResultActions token="tok" waiting continueUrl={null} canRetry={false} />);

    act(() => vi.advanceTimersByTime(5_000));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(10 * 60 * 1000));
    expect(router.refresh).toHaveBeenCalledTimes(24);
  });

  it('does not re-read a page that is not waiting', () => {
    vi.useFakeTimers();
    render(<PaymentResultActions token="tok" waiting={false} continueUrl={null} canRetry />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('retries by the page token and hands the Donor to the new charge', async () => {
    respond(201, { paymentInstructions: { redirectUrl: 'https://pay.example/new' } });
    render(<PaymentResultActions token="tok.sig" waiting={false} continueUrl={null} canRetry />);

    fireEvent.click(screen.getByRole('button', { name: 'Coba bayar lagi' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://pay.example/new'));
    expect(fetchMock).toHaveBeenCalledWith('/api/donations/result/tok.sig/retry', { method: 'POST' });
  });

  it('never navigates to a link that is not https', async () => {
    respond(201, { paymentInstructions: { redirectUrl: 'javascript:alert(1)' } });
    render(<PaymentResultActions token="tok" waiting={false} continueUrl={null} canRetry />);

    fireEvent.click(screen.getByRole('button', { name: 'Coba bayar lagi' }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(assign).not.toHaveBeenCalled();
  });

  it('re-reads the page after a bank transfer retry, which has no link, to show the new VA number', async () => {
    respond(201, { paymentInstructions: { type: 'bank_transfer', vaNumber: '8808' } });
    render(<PaymentResultActions token="tok" waiting={false} continueUrl={null} canRetry />);

    fireEvent.click(screen.getByRole('button', { name: 'Coba bayar lagi' }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("shows the route's own reason when the retry is refused", async () => {
    respond(409, { error: 'Pembayaran ulang untuk donasi ini sedang diproses. Tunggu sebentar.' });
    render(<PaymentResultActions token="tok" waiting={false} continueUrl={null} canRetry />);

    fireEvent.click(screen.getByRole('button', { name: 'Coba bayar lagi' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Pembayaran ulang untuk donasi ini sedang diproses. Tunggu sebentar.',
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it('offers the open charge back without a retry', () => {
    render(<PaymentResultActions token="tok" waiting continueUrl="https://pay.example/open" canRetry={false} />);
    expect(screen.getByRole('link', { name: 'Lanjutkan pembayaran' }).getAttribute('href')).toBe('https://pay.example/open');
    expect(screen.queryByRole('button', { name: 'Coba bayar lagi' })).toBeNull();
  });
});
