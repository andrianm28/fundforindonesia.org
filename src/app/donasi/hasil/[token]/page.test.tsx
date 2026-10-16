import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The payment result page (ticket 98) is where the provider sends a Donor back.
 * It opens by its signed token alone -- a Guest Donor has no session -- shows
 * the status the database holds rather than trusting the redirect, and shows
 * nothing about the Donor.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    donation: { findUnique: vi.fn() },
  },
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { prisma } from '@/lib/prisma';
import { signPaymentResultToken } from '@/lib/money/payment-result-token';
import PaymentResultPage from './page';

const mockFindUnique = prisma.donation.findUnique as unknown as ReturnType<typeof vi.fn>;

function makeDonation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'donation-1',
    amount: 50_000,
    paymentStatus: 'pending',
    donorId: null,
    campaign: { title: 'Bantu Sekolah Yatim', slug: 'bantu-sekolah-yatim' },
    payments: [
      {
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        redirectUrl: 'https://pay.example/order-1',
        vaNumber: null,
        createdAt: new Date(),
      },
    ],
    ...overrides,
  };
}

async function renderPage(token: string, searchParams: Record<string, string> = {}) {
  const element = await PaymentResultPage({
    params: Promise.resolve({ token }),
    searchParams: Promise.resolve(searchParams),
  });
  return render(element);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('payment result page', () => {
  it('is a 404 for a token this server did not sign, without reading the database', async () => {
    await expect(renderPage('donation-1')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('is a 404 when the signed Donation no longer exists', async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(renderPage(signPaymentResultToken('donation-1', Date.now()))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('looks up exactly the Donation the token was signed for', async () => {
    mockFindUnique.mockResolvedValue(makeDonation());
    await renderPage(signPaymentResultToken('donation-1', Date.now()));
    expect(mockFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'donation-1' } }));
  });

  it('says the payment is still awaited while the Payment is open, even after a success redirect', async () => {
    mockFindUnique.mockResolvedValue(makeDonation());
    await renderPage(signPaymentResultToken('donation-1', Date.now()));
    expect(screen.getByRole('heading', { name: 'Menunggu konfirmasi pembayaran' })).toBeTruthy();
    expect(screen.getByText('Bantu Sekolah Yatim')).toBeTruthy();
    expect(screen.getByText('Rp50.000', { exact: false })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Pembayaran berhasil' })).toBeNull();
  });

  it('confirms a settled Donation without linking the Receipt, which names the Donor and never expires', async () => {
    mockFindUnique.mockResolvedValue(
      makeDonation({
        paymentStatus: 'confirmed',
        payments: [{ status: 'PAID', expiresAt: null, redirectUrl: null, vaNumber: null, createdAt: new Date() }],
      }),
    );
    const { container } = await renderPage(signPaymentResultToken('donation-1', Date.now()));
    expect(screen.getByRole('heading', { name: 'Pembayaran berhasil' })).toBeTruthy();
    expect(container.querySelector('a[href^="/receipt/"]')).toBeNull();
    expect(mockFindUnique.mock.calls[0][0].select).not.toHaveProperty('receipt');
  });

  it('shows the Virtual Account number of an open bank transfer', async () => {
    mockFindUnique.mockResolvedValue(
      makeDonation({
        payments: [
          {
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 60_000),
            redirectUrl: null,
            vaNumber: '8808123456789',
            createdAt: new Date(),
          },
        ],
      }),
    );
    await renderPage(signPaymentResultToken('donation-1', Date.now()));
    expect(screen.getByText('8808123456789')).toBeTruthy();
  });

  it('sends a Donor who backed out of an open charge back to that same charge', async () => {
    mockFindUnique.mockResolvedValue(makeDonation());
    await renderPage(signPaymentResultToken('donation-1', Date.now()), { batal: '1' });
    expect(screen.getByText('Anda keluar dari halaman pembayaran sebelum selesai.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lanjutkan pembayaran' }).getAttribute('href')).toBe('https://pay.example/order-1');
    expect(screen.queryByRole('button', { name: 'Coba bayar lagi' })).toBeNull();
  });

  it('offers to pay again on the same Donation once the charge has expired', async () => {
    mockFindUnique.mockResolvedValue(
      makeDonation({
        payments: [{ status: 'EXPIRED', expiresAt: new Date(Date.now() - 1000), redirectUrl: null, vaNumber: null, createdAt: new Date() }],
      }),
    );
    await renderPage(signPaymentResultToken('donation-1', Date.now()), { batal: '1' });
    expect(screen.getByRole('heading', { name: 'Waktu pembayaran habis' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Coba bayar lagi' })).toBeTruthy();
  });

  it('shows no personal data, not even what the Donor typed in', async () => {
    mockFindUnique.mockResolvedValue(makeDonation());
    await renderPage(signPaymentResultToken('donation-1', Date.now()));
    const select = mockFindUnique.mock.calls[0][0].select;
    for (const field of ['guestName', 'guestEmailCiphertext', 'guestPhoneCiphertext', 'donor', 'message']) {
      expect(select).not.toHaveProperty(field);
    }
  });
});
