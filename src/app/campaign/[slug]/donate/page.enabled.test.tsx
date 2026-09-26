import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

/**
 * The donate page with the gate open.
 *
 * page.test.tsx covers the closed gate. Everything past it was unreachable
 * and therefore untested, including a contract bug that only surfaces once a
 * donation is really submitted: the page sent the payment method's `id`
 * ("bca") where the API validates a `type` ("qris"), so every submission
 * would have failed validation.
 */

vi.mock('@/lib/donations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/donations')>('@/lib/donations');
  return { ...actual, donationsEnabled: () => true };
});

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'campaign-contoh' }),
  useRouter: () => ({ back: vi.fn(), push: mockPush }),
}));

// Stand-ins that expose the callbacks the page wires to them, so a test can
// walk the four steps without depending on each child's markup.
vi.mock('@/components/donation/DonationAmountSelector', () => ({
  DonationAmountSelector: ({
    onAmountChange,
    onNext,
  }: {
    onAmountChange: (n: number) => void;
    onNext: () => void;
  }) => (
    <button
      onClick={() => {
        onAmountChange(50_000);
        onNext();
      }}
    >
      pick amount
    </button>
  ),
}));

vi.mock('@/components/donation/PaymentMethodSelector', () => ({
  PaymentMethodSelector: ({
    methods,
    onSelect,
    onNext,
  }: {
    methods: Array<{ id: string; name: string; type: string }>;
    onSelect: (m: unknown) => void;
    onNext: () => void;
  }) => (
    <div>
      <ul data-testid="methods">
        {methods.map((m) => (
          <li key={m.id} data-type={m.type}>
            {m.name}
          </li>
        ))}
      </ul>
      <button
        onClick={() => {
          onSelect(methods[0]);
          onNext();
        }}
      >
        pick method
      </button>
    </div>
  ),
}));

vi.mock('@/components/donation/DonationConfirmation', () => ({
  DonationConfirmation: ({ onConfirm }: { onConfirm: () => void }) => (
    <button onClick={onConfirm}>confirm</button>
  ),
}));

const mockUseCampaignDetail = vi.fn();
vi.mock('@/lib/hooks/useCampaignDetail', () => ({
  useCampaignDetail: (...args: unknown[]) => mockUseCampaignDetail(...args),
}));

import DonatePage from './page';
import { COLLECTING_ENTITY_REFUSAL } from '@/lib/campaign-page-status';

const REDIRECT_URL = 'https://pay.sumopod.com/pay/abc';

function okResponse() {
  return {
    ok: true,
    json: async () => ({
      donationId: 'donation-1',
      amount: 50_000,
      paymentMethod: 'qris',
      paymentStatus: 'pending',
      campaignTitle: 'Bantu Korban Bencana',
      paymentInstructions: {
        type: 'qris',
        redirectUrl: REDIRECT_URL,
        expiresAt: '2026-09-20T12:00:00.000Z',
      },
    }),
  } as unknown as Response;
}

let assignedUrl: string | null;

beforeEach(() => {
  assignedUrl = null;
  mockUseCampaignDetail.mockReturnValue({
    campaign: {
      id: 'campaign-1',
      slug: 'campaign-contoh',
      title: 'Bantu Korban Bencana',
      collectedAmount: 1_000_000,
      isDemo: false,
      lifecycleStatus: 'ACTIVE',
    },
    isLoading: false,
    error: null,
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
  // The page sends the donor to the provider. jsdom cannot navigate, so the
  // hand-off is captured rather than performed.
  vi.stubGlobal('location', { ...window.location, assign: vi.fn((u: string) => { assignedUrl = u; }) });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function walkToConfirm() {
  render(<DonatePage />);
  await act(async () => {
    fireEvent.click(screen.getByText('pick amount'));
  });
  await act(async () => {
    fireEvent.click(screen.getByText('pick method'));
  });
  await act(async () => {
    fireEvent.click(screen.getByText('confirm'));
  });
}

async function renderAndPickAmount() {
  render(<DonatePage />);
  await act(async () => {
    fireEvent.click(screen.getByText('pick amount'));
  });
}

describe('DonatePage offers what the provider can actually charge', () => {
  it('offers QRIS', async () => {
    await renderAndPickAmount();

    const types = Array.from(screen.getByTestId('methods').children).map((li) =>
      li.getAttribute('data-type'),
    );
    expect(types).toContain('qris');
  });

  it('offers no method the payment provider cannot serve', async () => {
    // Sumopod is QRIS only. Listing a virtual account or a card sends the
    // donor down a path that ends in a 503 after they have chosen an amount.
    await renderAndPickAmount();

    const types = Array.from(screen.getByTestId('methods').children).map((li) =>
      li.getAttribute('data-type'),
    );
    expect(types).toEqual(['qris']);
  });
});

describe('DonatePage submitting a donation', () => {
  it('sends the method type the API validates, not the method id', async () => {
    // The bug: `selectedPaymentMethod.id` is "qris" only by coincidence of
    // naming. It was "bca" before, which the API rejects as an invalid
    // payment method.
    await walkToConfirm();

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.paymentMethod).toBe('qris');
  });

  it('sends the campaign, amount and anonymity the donor chose', async () => {
    await walkToConfirm();

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ campaignId: 'campaign-1', amount: 50_000, isAnonymous: false });
  });
});

describe('DonatePage after the donation is created', () => {
  it('sends the donor to the provider payment page', async () => {
    await walkToConfirm();

    await waitFor(() => expect(assignedUrl).toBe(REDIRECT_URL));
  });

  it('never tells the donor the donation succeeded before they have paid', async () => {
    // Creating a Donation is not being paid. With QRIS the donor still has
    // to scan and confirm at the provider, and a success screen shown here
    // would be a lie that also stops them completing the payment.
    await walkToConfirm();

    await waitFor(() => expect(assignedUrl).toBe(REDIRECT_URL));
    expect(screen.queryByText(/Donasi Berhasil/i)).toBeNull();
  });

  it('shows the server reason and stays put when the donation is refused', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Ini adalah campaign contoh dan tidak dapat menerima donasi.' }),
    } as unknown as Response);

    await walkToConfirm();

    expect(
      await screen.findByText('Ini adalah campaign contoh dan tidak dapat menerima donasi.'),
    ).toBeInTheDocument();
    expect(assignedUrl).toBeNull();
  });
});

describe('DonatePage for a Campaign that is not Active', () => {
  function campaignIn(lifecycleStatus: string | undefined) {
    mockUseCampaignDetail.mockReturnValue({
      campaign: {
        id: 'campaign-1',
        slug: 'campaign-contoh',
        title: 'Bantu Korban Bencana',
        collectedAmount: 1_000_000,
        isDemo: false,
        lifecycleStatus,
      },
      isLoading: false,
      error: null,
    });
  }

  it.each([
    ['SUSPENDED', 'Campaign ini sedang ditinjau dan tidak menerima donasi.'],
    ['CANCELLED', 'Fundraiser telah menarik Campaign ini.'],
    ['EXPIRED', 'Campaign ini telah berakhir.'],
    ['COMPLETED', 'Campaign ini telah berakhir.'],
    // Only its Fundraiser, Verifiers and Admins get this far (the API 404s
    // everyone else); they are told it is not public and takes no donation.
    ['DRAFT', 'Campaign ini masih Draf: belum tampil untuk publik dan belum menerima donasi.'],
    ['SUBMITTED', 'Campaign ini sudah Diajukan dan menunggu keputusan Verifier: belum tampil untuk publik dan belum menerima donasi.'],
    ['REJECTED', 'Campaign ini Ditolak Verifier: belum tampil untuk publik dan tidak menerima donasi.'],
  ])('says why a %s Campaign takes no donation, and offers no donation step', (status, copy) => {
    campaignIn(status);
    render(<DonatePage />);
    expect(screen.getByText(copy)).toBeDefined();
    expect(screen.queryByText('pick amount')).toBeNull();
  });

  it('offers no donation step when the status is missing', () => {
    campaignIn(undefined);
    render(<DonatePage />);
    expect(screen.getByText('Campaign ini tidak menerima donasi.')).toBeDefined();
    expect(screen.queryByText('pick amount')).toBeNull();
  });

  it('leads back to the Campaign page', () => {
    campaignIn('CANCELLED');
    render(<DonatePage />);
    fireEvent.click(screen.getByText('Kembali ke Campaign'));
    expect(mockPush).toHaveBeenCalledWith('/campaign/campaign-contoh');
  });
});

describe('DonatePage and the Collecting Entity (prd-compliance 10)', () => {
  function activeCampaign(extra: Record<string, unknown>) {
    mockUseCampaignDetail.mockReturnValue({
      campaign: {
        id: 'campaign-1',
        slug: 'campaign-contoh',
        title: 'Bantu Korban Bencana',
        collectedAmount: 1_000_000,
        isDemo: false,
        lifecycleStatus: 'ACTIVE',
        ...extra,
      },
      isLoading: false,
      error: null,
    });
  }

  it.each(['NO_COLLECTING_ENTITY', 'NO_VALID_PERMIT'])(
    'says why an Active Campaign blocked by %s takes no donation, and offers no donation step',
    (donationBlock) => {
      activeCampaign({ donationBlock, collectingEntity: null });
      render(<DonatePage />);
      expect(screen.getByText(COLLECTING_ENTITY_REFUSAL)).toBeDefined();
      expect(screen.queryByText('pick amount')).toBeNull();
    },
  );

  it('names who collects the money above the amount', () => {
    activeCampaign({ donationBlock: null, collectingEntity: { id: 'yiem', name: 'Yayasan Indonesia Emas Merdeka' } });
    render(<DonatePage />);
    expect(screen.getByText('Dihimpun oleh Yayasan Indonesia Emas Merdeka')).toBeDefined();
    expect(screen.getByText('pick amount')).toBeDefined();
  });
});

// GET /api/campaigns/[slug] answers 404 for a missing slug and, to anyone
// but its Fundraiser, Verifiers and Admins, for an unapproved Campaign.
describe('DonatePage when the Campaign is not found', () => {
  it('says the Campaign was not found and offers no donation step', () => {
    mockUseCampaignDetail.mockReturnValue({
      campaign: null,
      isLoading: false,
      error: new Error('Gagal memuat data'),
      notFound: true,
    });

    render(<DonatePage />);

    expect(screen.getByText('Campaign tidak ditemukan.')).toBeDefined();
    expect(screen.queryByText('pick amount')).toBeNull();
  });

  it('still says something went wrong on any other failure', () => {
    mockUseCampaignDetail.mockReturnValue({
      campaign: null,
      isLoading: false,
      error: new Error('Gagal memuat data'),
      notFound: false,
    });

    render(<DonatePage />);

    expect(screen.getByText('Campaign tidak ditemukan atau terjadi kesalahan.')).toBeDefined();
  });
});
