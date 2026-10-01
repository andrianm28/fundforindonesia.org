import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

import { AdminAbuseThresholdForm } from './AdminAbuseThresholdForm';

const originalFetch = global.fetch;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  global.fetch = originalFetch;
});

/**
 * One row of the four abuse-thresholds limits (ticket 27; src/lib/abuse-thresholds.ts):
 * an Admin edits ONE `kind` at a time and posts it to the existing
 * POST /api/admin/abuse-thresholds route unchanged -- the server
 * (setAbuseThreshold) is the only holder of the validation rule (a positive
 * integer), so this form only shows the server's own refusal, in its own
 * words, rather than re-deriving it.
 */
describe('AdminAbuseThresholdForm', () => {
  it('shows the current value in the input', () => {
    render(
      <AdminAbuseThresholdForm kind="DONATION_REVIEW_AMOUNT" label="Penanda Donasi" unit="rupiah" currentValue={50_000_000} />,
    );
    const input = screen.getByLabelText('Penanda Donasi') as HTMLInputElement;
    expect(input.value).toBe('50000000');
  });

  it('posts the new value for its own kind, and refreshes on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ threshold: { id: 't1' } }),
    }) as unknown as typeof fetch;

    render(
      <AdminAbuseThresholdForm kind="DONATION_REVIEW_AMOUNT" label="Penanda Donasi" unit="rupiah" currentValue={50_000_000} />,
    );

    const input = screen.getByLabelText('Penanda Donasi');
    fireEvent.change(input, { target: { value: '75000000' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/abuse-thresholds',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ kind: 'DONATION_REVIEW_AMOUNT', value: 75_000_000 }),
      }),
    );
  });

  it('shows the server refusal in its own words, without refreshing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Ambang harus berupa bilangan bulat lebih besar dari 0.' }),
    }) as unknown as typeof fetch;

    render(
      <AdminAbuseThresholdForm kind="DONATION_REVIEW_AMOUNT" label="Penanda Donasi" unit="rupiah" currentValue={50_000_000} />,
    );

    fireEvent.change(screen.getByLabelText('Penanda Donasi'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/bilangan bulat lebih besar dari 0/i);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('disables the save button until the value changes', () => {
    render(
      <AdminAbuseThresholdForm kind="ACTIVE_CAMPAIGNS_PER_FUNDRAISER" label="Batas Campaign Active" unit="count" currentValue={3} />,
    );
    expect(screen.getByRole('button', { name: /simpan/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Batas Campaign Active'), { target: { value: '4' } });
    expect(screen.getByRole('button', { name: /simpan/i })).not.toBeDisabled();
  });

  it('confirms the save once it succeeds', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;

    render(
      <AdminAbuseThresholdForm kind="DONATION_REVIEW_AMOUNT" label="Penanda Donasi" unit="rupiah" currentValue={50_000_000} />,
    );
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.change(screen.getByLabelText('Penanda Donasi'), { target: { value: '75000000' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/tersimpan/i);
  });

  it('shows no confirmation when the server refuses', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Harus positif.' }) }) as unknown as typeof fetch;

    render(
      <AdminAbuseThresholdForm kind="DONATION_REVIEW_AMOUNT" label="Penanda Donasi" unit="rupiah" currentValue={50_000_000} />,
    );
    fireEvent.change(screen.getByLabelText('Penanda Donasi'), { target: { value: '75000000' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await screen.findByRole('alert');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows who last changed the limit and when', () => {
    render(
      <AdminAbuseThresholdForm
        kind="DONATION_REVIEW_AMOUNT"
        label="Penanda Donasi"
        unit="rupiah"
        currentValue={50_000_000}
        lastChange={{ by: 'Admin Satu', at: '20 September 2026 10.00 WIB' }}
      />,
    );
    expect(screen.getByText(/Terakhir diubah oleh Admin Satu pada 20 September 2026/)).toBeDefined();
  });
});
