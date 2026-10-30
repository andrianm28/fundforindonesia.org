import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Donasi Saya links a confirmed Donation to its Receipt's print page
 * (CONTEXT.md, Receipt) -- reachable from the dashboard, per the ticket --
 * without breaking the existing click-through to the Campaign.
 */

vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated' }),
}));

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

import DonasiSayaPage from './page';

function donation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'donation-1',
    amount: 100_000,
    paymentMethod: 'qris',
    paymentStatus: 'confirmed',
    isAnonymous: false,
    message: null,
    createdAt: '2026-09-26T00:00:00.000Z',
    campaign: { title: 'Test Campaign', slug: 'test-campaign', coverImage: '' },
    receiptToken: 'tok-1',
    akadWakafToken: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  router.push.mockReset();
});

describe('Donasi Saya', () => {
  it('links a confirmed Donation with a Receipt to its print page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ donations: [donation()], total: 1, page: 1, limit: 10, totalPages: 1 }),
      }),
    );

    render(<DonasiSayaPage />);

    const link = await screen.findByRole('link', { name: /bukti donasi/i });
    expect(link.getAttribute('href')).toBe('/receipt/tok-1');
  });

  it('shows no Receipt link for a Donation still pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          donations: [donation({ paymentStatus: 'pending', receiptToken: null })],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      }),
    );

    render(<DonasiSayaPage />);

    await screen.findByText('Test Campaign');
    expect(screen.queryByRole('link', { name: /bukti donasi/i })).toBeNull();
  });

  it('links a confirmed Donation on a `wakaf` Campaign to its Akad Wakaf print page (CONTEXT.md, Akad Wakaf)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          donations: [donation({ akadWakafToken: 'akad-tok-1' })],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      }),
    );

    render(<DonasiSayaPage />);

    const link = await screen.findByRole('link', { name: /akad wakaf/i });
    expect(link.getAttribute('href')).toBe('/akad-wakaf/akad-tok-1');
  });

  it('shows no Akad Wakaf link for a Donation on a non-`wakaf` Campaign', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ donations: [donation()], total: 1, page: 1, limit: 10, totalPages: 1 }),
      }),
    );

    render(<DonasiSayaPage />);

    await screen.findByText('Test Campaign');
    expect(screen.queryByRole('link', { name: /akad wakaf/i })).toBeNull();
  });

  it('offers the confirmation link when the account email is not yet verified (prd-compliance 23)', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url === '/api/user/email-verification'
        ? { ok: true, json: async () => ({ sent: true }) }
        : {
            ok: true,
            json: async () => ({ donations: [], total: 0, emailVerified: false, page: 1, limit: 10, totalPages: 0 }),
          },
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<DonasiSayaPage />);

    fireEvent.click(await screen.findByRole('button', { name: /kirim tautan konfirmasi/i }));

    expect(await screen.findByText(/periksa email anda/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/user/email-verification', { method: 'POST' });
  });

  it('shows no confirmation prompt once the email is verified', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ donations: [donation()], total: 1, emailVerified: true, page: 1, limit: 10, totalPages: 1 }),
      }),
    );

    render(<DonasiSayaPage />);

    await screen.findByText('Test Campaign');
    expect(screen.queryByRole('button', { name: /kirim tautan konfirmasi/i })).toBeNull();
  });

  it('still navigates to the Campaign when the card itself is clicked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ donations: [donation()], total: 1, page: 1, limit: 10, totalPages: 1 }),
      }),
    );

    render(<DonasiSayaPage />);

    const card = await screen.findByText('Test Campaign');
    fireEvent.click(card);

    expect(router.push).toHaveBeenCalledWith('/campaign/test-campaign');
  });

  describe('Refund request', () => {
    function stubFetch(refundResponse: { ok: boolean; status?: number; json: () => Promise<unknown> }) {
      const fetchMock = vi.fn(async (...args: [string, RequestInit?]) =>
        args[0].includes('refund-request')
          ? refundResponse
          : { ok: true, json: async () => ({ donations: [donation()], total: 1, page: 1, limit: 10, totalPages: 1 }) },
      );
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('offers no request for a Donation that is not confirmed', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ donations: [donation({ paymentStatus: 'pending' })], total: 1, page: 1, limit: 10, totalPages: 1 }),
        }),
      );
      render(<DonasiSayaPage />);
      await screen.findByText('Test Campaign');
      expect(screen.queryByRole('button', { name: /ajukan refund/i })).toBeNull();
    });

    it('sends the reason and the Donation amount, then says the request was sent', async () => {
      const fetchMock = stubFetch({ ok: true, json: async () => ({ id: 'refund-1' }) });
      render(<DonasiSayaPage />);

      fireEvent.click(await screen.findByRole('button', { name: /ajukan refund/i }));
      const send = screen.getByRole('button', { name: /kirim permintaan/i });
      expect((send as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Salah nominal' } });
      fireEvent.click(send);

      await screen.findByText(/permintaan refund terkirim/i);
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('refund-request'))!;
      expect(call[0]).toBe('/api/donations/donation-1/refund-request');
      expect(JSON.parse((call[1] as unknown as RequestInit).body as string)).toEqual({ amount: 100_000, reason: 'Salah nominal' });
    });

    it('shows the server refusal and keeps the form open', async () => {
      stubFetch({ ok: false, status: 409, json: async () => ({ error: 'Batas waktu sudah lewat.' }) });
      render(<DonasiSayaPage />);

      fireEvent.click(await screen.findByRole('button', { name: /ajukan refund/i }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Salah nominal' } });
      fireEvent.click(screen.getByRole('button', { name: /kirim permintaan/i }));

      expect((await screen.findByRole('alert')).textContent).toBe('Batas waktu sudah lewat.');
      expect(screen.getByRole('button', { name: /kirim permintaan/i })).toBeTruthy();
    });
  });
});
