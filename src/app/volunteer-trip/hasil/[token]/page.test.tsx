import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The Registration payment result page (ticket 99) is where the provider sends
 * a Volunteer back after the Trip Fee. It opens by its signed token alone,
 * shows the Payment status the database holds rather than trusting the
 * redirect, and shows nothing about the Volunteer.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    registration: { findUnique: vi.fn() },
  },
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import { prisma } from '@/lib/prisma';
import { signRegistrationResultToken } from '@/lib/money/registration-result-token';
import { signPaymentResultToken } from '@/lib/money/payment-result-token';
import RegistrationResultPage from './page';

const mockFindUnique = prisma.registration.findUnique as unknown as ReturnType<typeof vi.fn>;

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    amount: 1_500_000,
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    redirectUrl: 'https://pay.sumopod.com/order-1',
    vaNumber: null,
    method: 'qris_redirect',
    providerRef: 'registration-1',
    paidAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeRegistration(payment: Record<string, unknown> | null = makePayment()) {
  return {
    id: 'registration-1',
    batch: {
      startDate: new Date('2027-01-10T00:00:00Z'),
      endDate: new Date('2027-01-14T00:00:00Z'),
      trip: { slug: 'mengajar-di-flores', title: 'Mengajar di Flores', tripFeeAmount: 1_500_000 },
    },
    payment,
  };
}

async function renderPage(token: string, searchParams: Record<string, string> = {}) {
  const element = await RegistrationResultPage({
    params: Promise.resolve({ token }),
    searchParams: Promise.resolve(searchParams),
  });
  return render(element);
}

const validToken = () => signRegistrationResultToken('registration-1', Date.now());

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('registration payment result page', () => {
  it('is a 404 for a token this server did not sign, without reading the database', async () => {
    await expect(renderPage('registration-1')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('is a 404 for a Donation result token, which has another domain', async () => {
    await expect(renderPage(signPaymentResultToken('registration-1', Date.now()))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('is a 404 when the Registration no longer exists', async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(renderPage(validToken())).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('looks the Registration up by the id inside the token', async () => {
    mockFindUnique.mockResolvedValue(makeRegistration());
    await renderPage(validToken());
    expect(mockFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'registration-1' } }));
  });

  it('shows the Trip, the amount and a waiting state while the Payment is PENDING', async () => {
    mockFindUnique.mockResolvedValue(makeRegistration());
    await renderPage(validToken());
    expect(screen.getByText('Mengajar di Flores')).toBeTruthy();
    expect(screen.getByText(/1\.500\.000/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Menunggu konfirmasi pembayaran' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lanjutkan pembayaran' }).getAttribute('href')).toBe('https://pay.sumopod.com/order-1');
  });

  it('says paid only when the Payment is PAID, and offers no way back into the charge', async () => {
    mockFindUnique.mockResolvedValue(makeRegistration(makePayment({ status: 'PAID', paidAt: new Date() })));
    await renderPage(validToken());
    expect(screen.getByRole('heading', { name: 'Pembayaran berhasil' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Lanjutkan pembayaran' })).toBeNull();
  });

  it.each([
    ['FAILED', 'Pembayaran gagal'],
    ['EXPIRED', 'Waktu pembayaran habis'],
    ['REFUNDED', 'Dana dikembalikan'],
  ])('shows a %s Payment as it is', async (status, title) => {
    mockFindUnique.mockResolvedValue(makeRegistration(makePayment({ status })));
    await renderPage(validToken());
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Lanjutkan pembayaran' })).toBeNull();
  });

  it('does not offer the payment link of a PENDING charge past its expiry', async () => {
    mockFindUnique.mockResolvedValue(makeRegistration(makePayment({ expiresAt: new Date(Date.now() - 1000) })));
    await renderPage(validToken());
    expect(screen.queryByRole('link', { name: 'Lanjutkan pembayaran' })).toBeNull();
  });

  it('drops a payment link that is not https', async () => {
    mockFindUnique.mockResolvedValue(makeRegistration(makePayment({ redirectUrl: 'javascript:alert(1)' })));
    await renderPage(validToken());
    expect(screen.queryByRole('link', { name: 'Lanjutkan pembayaran' })).toBeNull();
  });

  it('shows the Virtual Account number of an open bank transfer', async () => {
    mockFindUnique.mockResolvedValue(
      makeRegistration(makePayment({ method: 'bank_transfer_va', redirectUrl: null, vaNumber: '8800123456' })),
    );
    await renderPage(validToken());
    expect(screen.getByText('8800123456')).toBeTruthy();
  });

  it('says no payment is recorded when the Registration has no Payment', async () => {
    mockFindUnique.mockResolvedValue(makeRegistration(null));
    await renderPage(validToken());
    expect(screen.getByRole('heading', { name: 'Pembayaran belum tercatat' })).toBeTruthy();
  });

  it('notes that the Volunteer left the payment page when the cancel marker is present', async () => {
    mockFindUnique.mockResolvedValue(makeRegistration());
    await renderPage(validToken(), { batal: '1' });
    expect(screen.getByText('Anda keluar dari halaman pembayaran sebelum selesai.')).toBeTruthy();
  });

  it('ignores the cancel marker once the Payment is PAID', async () => {
    mockFindUnique.mockResolvedValue(makeRegistration(makePayment({ status: 'PAID', paidAt: new Date() })));
    await renderPage(validToken(), { batal: '1' });
    expect(screen.queryByText('Anda keluar dari halaman pembayaran sebelum selesai.')).toBeNull();
  });

  it('reads nothing about the Volunteer from the database', async () => {
    mockFindUnique.mockResolvedValue(makeRegistration());
    await renderPage(validToken());
    const select = JSON.stringify(mockFindUnique.mock.calls[0][0].select);
    expect(select).not.toMatch(/volunteer|email|name"/i);
  });
});
