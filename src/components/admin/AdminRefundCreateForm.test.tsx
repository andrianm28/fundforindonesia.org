import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { AdminRefundCreateForm } from './AdminRefundCreateForm';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/**
 * ticket 23: an Admin creates a Refund for a resolved Donation/Payment,
 * through the existing POST /api/campaigns/[slug]/refunds route unchanged
 * -- this form only asks for amount and reason and shows the server's own
 * refusal (e.g. RefundNotAllowedForKindError, RefundExceedsRemainingError)
 * in its own words.
 */
describe('AdminRefundCreateForm', () => {
  it('posts amount and reason to the Campaign refund create route and navigates to the new Refund', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'refund-9' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminRefundCreateForm campaignSlug="wakaf-sumur" paymentId="payment-1" />);

    fireEvent.change(screen.getByLabelText(/jumlah refund/i), { target: { value: '250000' } });
    fireEvent.change(screen.getByLabelText(/alasan/i), { target: { value: 'salah bayar' } });
    fireEvent.click(screen.getByRole('button', { name: /buat refund/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/campaigns/wakaf-sumur/refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: 'payment-1', amount: 250000, reason: 'salah bayar' }),
      }),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/admin/refunds/refund-9'));
  });

  it('disables submit until amount and reason are filled', () => {
    render(<AdminRefundCreateForm campaignSlug="wakaf-sumur" paymentId="payment-1" />);

    expect(screen.getByRole('button', { name: /buat refund/i })).toBeDisabled();
  });

  it('shows the server refusal in its own words', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Refund melebihi sisa Payment.' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminRefundCreateForm campaignSlug="wakaf-sumur" paymentId="payment-1" />);

    fireEvent.change(screen.getByLabelText(/jumlah refund/i), { target: { value: '999999999' } });
    fireEvent.change(screen.getByLabelText(/alasan/i), { target: { value: 'salah bayar' } });
    fireEvent.click(screen.getByRole('button', { name: /buat refund/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Refund melebihi sisa Payment.');
    expect(mockPush).not.toHaveBeenCalled();
  });
});
