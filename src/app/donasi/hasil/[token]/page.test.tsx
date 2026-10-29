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

vi.mock('@/lib/donations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/donations')>('@/lib/donations');
  return { ...actual, donationsEnabled: () => true, sandboxInProductionReason: () => null };
});

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

const ACTIVE_CAMPAIGN = {
  id: 'campaign-1',
  slug: 'bantu-sekolah-yatim',
  title: 'Bantu Sekolah Yatim',
  lifecycleStatus: 'ACTIVE',
  deadline: null,
  isDemo: false,
  kind: 'DONATION',
  category: 'pendidikan',
  collectingEntity: {
    permits: [{ kinds: ['DONATION'], validFrom: new Date('2020-01-01T00:00:00Z'), validTo: new Date('2099-12-31T00:00:00Z') }],
  },
};

const LONG_EXPIRED = new Date(Date.now() - 24 * 60 * 60 * 1000);

function makeDonation(overrides: Record<string, unknown> = {}) {
  return {
    amount: 50_000,
    paymentStatus: 'pending',
    campaign: ACTIVE_CAMPAIGN,
    payments: [
      {
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        redirectUrl: 'https://pay.example/order-1',
        vaNumber: null,
        createdAt: new Date(),
        method: 'qris_redirect',
        providerRef: 'donation-1',
        paidAt: null,
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
        payments: [{ status: 'PAID', expiresAt: null, redirectUrl: null, vaNumber: null, createdAt: new Date(), method: 'qris_redirect', providerRef: 'donation-1', paidAt: null }],
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
            method: 'bank_transfer_va',
            providerRef: 'donation-1',
            paidAt: null,
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
        payments: [{ status: 'EXPIRED', expiresAt: LONG_EXPIRED, redirectUrl: null, vaNumber: null, createdAt: new Date(), method: 'qris_redirect', providerRef: 'donation-1', paidAt: null }],
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

  it('does not offer to pay again once the Campaign has closed, and points back to it instead (PR #273 review S3)', async () => {
    mockFindUnique.mockResolvedValue(
      makeDonation({
        campaign: { ...ACTIVE_CAMPAIGN, lifecycleStatus: 'COMPLETED' },
        payments: [{ status: 'EXPIRED', expiresAt: LONG_EXPIRED, redirectUrl: null, vaNumber: null, createdAt: new Date(), method: 'qris_redirect', providerRef: 'donation-1', paidAt: null }],
      }),
    );
    await renderPage(signPaymentResultToken('donation-1', Date.now()));
    expect(screen.queryByRole('button', { name: 'Coba bayar lagi' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Kembali ke halaman campaign' }).getAttribute('href')).toBe('/campaign/bantu-sekolah-yatim');
  });

  it('never mentions a cancel once the Donation is paid or refunded', async () => {
    for (const status of ['PAID', 'REFUNDED']) {
      mockFindUnique.mockResolvedValue(
        makeDonation({ payments: [{ status, expiresAt: null, redirectUrl: null, vaNumber: null, createdAt: new Date(), method: 'qris_redirect', providerRef: 'donation-1', paidAt: null }] }),
      );
      await renderPage(signPaymentResultToken('donation-1', Date.now()), { batal: '1' });
      expect(screen.queryByText('Anda keluar dari halaman pembayaran sebelum selesai.')).toBeNull();
      cleanup();
    }
  });

  it('says the money went back for a refunded Payment', async () => {
    mockFindUnique.mockResolvedValue(
      makeDonation({ payments: [{ status: 'REFUNDED', expiresAt: null, redirectUrl: null, vaNumber: null, createdAt: new Date(), method: 'qris_redirect', providerRef: 'donation-1', paidAt: null }] }),
    );
    await renderPage(signPaymentResultToken('donation-1', Date.now()));
    expect(screen.getByRole('heading', { name: 'Dana dikembalikan' })).toBeTruthy();
  });

  it('shows the paid attempt\'s reference, method and payment time, so the Donor can match it against their own records', async () => {
    mockFindUnique.mockResolvedValue(
      makeDonation({
        paymentStatus: 'confirmed',
        payments: [
          {
            status: 'PAID',
            expiresAt: null,
            redirectUrl: null,
            vaNumber: null,
            createdAt: new Date('2026-10-29T03:00:00Z'),
            method: 'qris_redirect',
            providerRef: 'donation-1-rabc12345',
            paidAt: new Date('2026-10-29T03:05:00Z'),
          },
        ],
      }),
    );
    await renderPage(signPaymentResultToken('donation-1', Date.now()));
    expect(screen.getByText('donation-1-rabc12345')).toBeTruthy();
    expect(screen.getByText('QRIS')).toBeTruthy();
    expect(screen.getByText('Waktu pembayaran')).toBeTruthy();
    // 03:05 UTC is 10:05 in Jakarta.
    expect(screen.getByText(/10[.:]05 WIB/)).toBeTruthy();
  });
});
