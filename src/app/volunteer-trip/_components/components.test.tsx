import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { RefundTierTable } from './RefundTierTable';
import { RegisterButton } from './RegisterButton';
import { HoldCountdown } from './HoldCountdown';
import { CancelRegistrationButton } from './CancelRegistrationButton';

const fetchMock = vi.fn();
const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body });

describe('Volunteer Registration client components (ticket 36)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock as never;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe('RefundTierTable', () => {
    it('lists the three tiers of this Batch with a Rupiah amount each', () => {
      // 20 Oct 2026 07:00 WIB.
      render(<RefundTierTable startDate="2026-10-20T00:00:00.000Z" tripFee={2_500_000} />);
      const rows = screen.getAllByRole('row').slice(1);
      expect(rows).toHaveLength(3);
      expect(rows[0].textContent).toContain('Sampai 6 Okt 2026 07.00 WIB');
      expect(rows[0].textContent).toMatch(/2\.500\.000/);
      expect(rows[1].textContent).toMatch(/1\.250\.000/);
      expect(rows[2].textContent).toContain('Setelah 17 Okt 2026 07.00 WIB');
      expect(rows[2].textContent).toMatch(/Rp\s?0/);
    });
  });

  describe('RegisterButton', () => {
    it('posts the QRIS Registration, then shows the countdown and the pay link, not an auto-redirect', async () => {
      answer(201, {
        registrationId: 'reg-1',
        amount: 2_500_000,
        holdExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        paymentInstructions: { type: 'qris', redirectUrl: 'https://pay.example/x' },
      });
      render(<RegisterButton slug="sumba" batchId="b1" />);
      fireEvent.click(screen.getByRole('button', { name: /Daftar dan bayar/ }));
      await waitFor(() => expect(screen.getByRole('link', { name: /Bayar sekarang/ })).toBeTruthy());
      expect(fetchMock.mock.calls[0][0]).toBe('/api/volunteer-trips/sumba/batches/b1/registrations');
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ paymentMethod: 'qris' });
      expect(screen.getByRole('link', { name: /Bayar sekarang/ }).getAttribute('href')).toBe('https://pay.example/x');
      expect(screen.getByRole('link', { name: /Lihat status/ }).getAttribute('href')).toBe('/volunteer-trip/registrasi/reg-1');
      expect(screen.getByText(/Kursi ditahan/)).toBeTruthy();
    });

    it('shows the server refusal as it comes, and offers no pay link', async () => {
      answer(503, { error: 'Pendaftaran Volunteer Trip belum dibuka. Silakan kembali lagi nanti.' });
      render(<RegisterButton slug="sumba" batchId="b1" />);
      fireEvent.click(screen.getByRole('button', { name: /Daftar dan bayar/ }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/belum dibuka/));
      expect(screen.queryByRole('link', { name: /Bayar sekarang/ })).toBeNull();
    });

    it('does not post twice on a double click', async () => {
      answer(400, { error: 'x' });
      render(<RegisterButton slug="sumba" batchId="b1" />);
      const button = screen.getByRole('button', { name: /Daftar dan bayar/ });
      fireEvent.click(button);
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('HoldCountdown', () => {
    it('draws the same text on the server and on the first client render, whatever the clock says', async () => {
      const { renderToString } = await import('react-dom/server');
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-01T10:00:00Z'));
      const server = renderToString(<HoldCountdown expiresAt="2026-10-01T10:30:00Z" />);
      vi.setSystemTime(new Date('2026-10-01T10:00:01Z'));
      const client = renderToString(<HoldCountdown expiresAt="2026-10-01T10:30:00Z" />);
      expect(client).toBe(server);
      expect(server).toContain('--:--');
    });

    it('counts down, and refreshes the page once when the hold runs out', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-01T10:00:00Z'));
      render(<HoldCountdown expiresAt="2026-10-01T10:00:03Z" />);
      expect(screen.getByText('00:03')).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByText('00:00')).toBeTruthy();
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe('CancelRegistrationButton', () => {
    it('shows the tiered Refund amount before confirming, and cancels only on confirm', async () => {
      answer(200, { id: 'reg-1', status: 'CANCELLED', refund: { id: 'rf', amount: 1_250_000, status: 'REQUESTED' } });
      render(<CancelRegistrationButton registrationId="reg-1" paid refundAmount={1_250_000} />);
      fireEvent.click(screen.getByRole('button', { name: 'Batalkan Registrasi' }));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByText(/1\.250\.000/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Ya, batalkan' }));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
      expect(fetchMock.mock.calls[0][0]).toBe('/api/registrations/reg-1');
      expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    });

    it('says plainly that nothing is refunded inside the no-refund window', () => {
      render(<CancelRegistrationButton registrationId="reg-1" paid refundAmount={0} />);
      fireEvent.click(screen.getByRole('button', { name: 'Batalkan Registrasi' }));
      expect(screen.getByText(/tidak ada Refund/i)).toBeTruthy();
    });

    it('for an unpaid hold says nothing has been paid', () => {
      render(<CancelRegistrationButton registrationId="reg-1" paid={false} refundAmount={0} />);
      fireEvent.click(screen.getByRole('button', { name: 'Batalkan Registrasi' }));
      expect(screen.getByText(/belum ada pembayaran/i)).toBeTruthy();
    });
  });
});
