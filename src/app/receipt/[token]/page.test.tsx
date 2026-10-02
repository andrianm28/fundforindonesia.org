import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The print page (CONTEXT.md, Receipt) looks a Receipt up by its token alone
 * -- a Guest Donor has no account, so nothing else may gate it -- and hands
 * ReceiptView exactly what it needs to render, never the Donation's or
 * Donor's other fields.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    receipt: { findUnique: vi.fn() },
  },
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

const view = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock('@/components/receipt/ReceiptView', () => ({
  ReceiptView: (props: Record<string, unknown>) => {
    view.props = props;
    return null;
  },
}));

import { prisma } from '@/lib/prisma';
import ReceiptPage from './page';

const mockFindUnique = prisma.receipt.findUnique as unknown as ReturnType<typeof vi.fn>;

function makeReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'receipt-1',
    token: 'tok-1',
    createdAt: new Date('2026-09-26T10:00:00.000Z'),
    donation: {
      id: 'donation-1',
      amount: 250_000,
      donorId: 'donor-1',
      guestName: null,
      donor: { id: 'donor-1', name: 'Sari' },
      campaign: {
        title: 'Bantu Sekolah Yatim',
        collectingEntity: { name: 'Yayasan Insan Ekonomi Mandiri' },
      },
    },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  view.props = null;
});

describe('ReceiptPage', () => {
  it('renders the Receipt for a valid token, naming the Collecting Entity', async () => {
    mockFindUnique.mockResolvedValue(makeReceipt());

    render(await ReceiptPage({ params: Promise.resolve({ token: 'tok-1' }) }));

    expect(view.props).toMatchObject({
      token: 'tok-1',
      campaignTitle: 'Bantu Sekolah Yatim',
      collectingEntityName: 'Yayasan Insan Ekonomi Mandiri',
      amount: 250_000,
      donorName: 'Sari',
    });
  });

  it('falls back to the Guest Donor name when there is no account', async () => {
    mockFindUnique.mockResolvedValue(
      makeReceipt({ donation: { ...makeReceipt().donation, donorId: null, donor: null, guestName: 'Budi' } }),
    );

    render(await ReceiptPage({ params: Promise.resolve({ token: 'tok-1' }) }));

    expect(view.props).toMatchObject({ donorName: 'Budi' });
  });

  it('tells the view whether the Donation is anonymised, owned by an account, and never carries a name for an anonymised one', async () => {
    mockFindUnique.mockResolvedValue(makeReceipt());
    render(await ReceiptPage({ params: Promise.resolve({ token: 'tok-1' }) }));
    expect(view.props).toMatchObject({ anonymised: false, accountOwned: true });

    mockFindUnique.mockResolvedValue(
      makeReceipt({
        donation: {
          ...makeReceipt().donation,
          donorId: null,
          donor: null,
          guestName: null,
          anonymisedAt: new Date('2026-10-01T00:00:00.000Z'),
        },
      }),
    );
    render(await ReceiptPage({ params: Promise.resolve({ token: 'tok-1' }) }));
    expect(view.props).toMatchObject({ anonymised: true, accountOwned: false, donorName: null });
  });

  it('dates the print page from when the Donor paid, not from when the Receipt row was written', async () => {
    // A Sumopod QRIS Donation settles at T+2 (prd-compliance 19), so the
    // Receipt row is written days after the Donor paid -- the date on the
    // printed proof is the day they paid, the same one the email names
    // (src/app/api/webhooks/[provider]/route.ts stamps sentAt with the
    // provider's paidAt). Two distinct moments, deliberately.
    mockFindUnique.mockResolvedValue(
      makeReceipt({
        sentAt: new Date('2026-09-26T10:00:00.000Z'),
        createdAt: new Date('2026-09-28T03:14:00.000Z'),
      }),
    );

    render(await ReceiptPage({ params: Promise.resolve({ token: 'tok-1' }) }));

    expect(view.props).toMatchObject({ paidAt: '2026-09-26T10:00:00.000Z' });
  });

  it('answers not found for a token that names no Receipt', async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(ReceiptPage({ params: Promise.resolve({ token: 'missing' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
});
