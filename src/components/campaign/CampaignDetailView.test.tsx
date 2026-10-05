import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { CampaignDetailView, type CampaignDetailData } from './CampaignDetailView';

// The Traffic Source hook asks the route only for the Campaign's own
// Fundraiser or an Admin, so it reads the session. Default: the Fundraiser.
const mockSession = vi.hoisted(() => ({
  value: { data: { user: { id: 'user-1', assignments: [] as string[] } } } as { data: unknown },
}));
vi.mock('next-auth/react', () => ({ useSession: () => mockSession.value }));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: vi.fn(),
    push: vi.fn(),
  }),
}));

const mockCampaign: CampaignDetailData = {
  id: 'campaign-1',
  slug: 'bantu-korban-bencana',
  title: 'Bantu Korban Bencana Alam di Cianjur',
  description: 'Bantuan untuk korban bencana',
  story: '<p>Cerita lengkap</p>',
  coverImage: '/images/campaign-1.jpg',
  targetAmount: 50000000,
  collectedAmount: 25841000,
  category: 'bencana-alam',
  lifecycleStatus: 'ACTIVE',
  isUrgent: false,
  isDemo: false,
  deadline: null,
  createdAt: new Date('2026-01-01').toISOString(),
  creator: {
    id: 'user-1',
    name: 'Yayasan Peduli Bencana',
    avatar: null,
  },
  donationCount: 12,
  platformFeePercentBps: 250,
  escrowHoldDays: 7,
};

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

describe('CampaignDetailView', () => {
  afterEach(() => {
    cleanup();
  });

  it('opens the ShareModal when "Bagikan" is pressed (PRD FFI-06)', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    expect(screen.queryByText('Bagikan Campaign')).toBeNull();
    fireEvent.click(screen.getByLabelText('Bagikan'));
    expect(screen.getByText('Bagikan Campaign')).toBeDefined();
    expect(screen.getByLabelText('Bagikan via WhatsApp')).toBeDefined();
  });

  it('does not render a demo badge for a regular campaign', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    expect(screen.queryByText(/kampanye contoh/i)).toBeNull();
  });

  it('renders a plain-Indonesian demo badge, visible above the title, for a demo campaign', () => {
    const demoCampaign = { ...mockCampaign, isDemo: true };
    render(<CampaignDetailView campaign={demoCampaign} />);
    // Legible at a glance, before the donor ever reaches the "Donasi
    // sekarang" button fixed at the bottom -- not a tooltip.
    expect(screen.getByText(/kampanye contoh/i)).toBeDefined();
  });

  it('still renders the "Donasi sekarang" CTA for a demo campaign -- the badge is additional, not the refusal itself', () => {
    // The API (POST /api/donations) is the actual refusal; this page keeps
    // demo campaigns browsable, per the task's ruling that they stay visible.
    const demoCampaign = { ...mockCampaign, isDemo: true };
    render(<CampaignDetailView campaign={demoCampaign} />);
    expect(screen.getByText('Donasi sekarang')).toBeDefined();
  });

  it('shows one "Donasi uji" line when the beta hands an amount, and none otherwise', () => {
    render(<CampaignDetailView campaign={{ ...mockCampaign, testDonationAmount: 150000 }} />);
    expect(screen.getByText(/Donasi uji: Rp\s?150\.000/)).toBeDefined();
    cleanup();
    render(<CampaignDetailView campaign={{ ...mockCampaign, testDonationAmount: null }} />);
    expect(screen.queryByText(/Donasi uji/)).toBeNull();
  });

  it('shows the Platform Fee rate in force (prd-compliance 17)', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    expect(screen.getByText(/2,5%/)).toBeDefined();
  });

  it('shows 0% when no Platform Fee rate has been set', () => {
    render(<CampaignDetailView campaign={{ ...mockCampaign, platformFeePercentBps: 0 }} />);
    expect(screen.getByText(/0%/)).toBeDefined();
  });

  it('shows the Escrow Hold length every new Payment freezes at creation (prd-compliance 18)', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    expect(screen.getByText(/7 hari/)).toBeDefined();
  });

  it('wraps the hero image and quick info panel in a container that stacks by default and goes side-by-side from the lg breakpoint (1025px)', () => {
    const { container } = render(<CampaignDetailView campaign={mockCampaign} />);
    const wrapper = container.querySelector('[data-testid="campaign-hero-section"]') as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.className).toContain('lg:flex');
    expect(wrapper.className).toContain('lg:flex-row');
  });

  it('caps the hero image to a 21:9 aspect ratio from lg, while keeping the existing mobile aspect ratio and height cap', () => {
    const { container } = render(<CampaignDetailView campaign={mockCampaign} />);
    const imageBox = container.querySelector('[data-testid="campaign-hero-image"]') as HTMLElement;
    expect(imageBox).not.toBeNull();
    expect(imageBox.className).toContain('aspect-video');
    expect(imageBox.className).toContain('max-h-[300px]');
    expect(imageBox.className).toContain('lg:aspect-21/9');
    expect(imageBox.className).toContain('lg:max-h-none');
  });

  it('sizes the quick info panel to 2/5 width from the lg breakpoint', () => {
    const { container } = render(<CampaignDetailView campaign={mockCampaign} />);
    const infoPanel = container.querySelector('[data-testid="campaign-quick-info"]') as HTMLElement;
    expect(infoPanel).not.toBeNull();
    expect(infoPanel.className).toContain('lg:w-2/5');
  });

  it('keeps the quick info panel capped and centered at max-w-3xl below the lg breakpoint, matching the pre-restructure content width', () => {
    const { container } = render(<CampaignDetailView campaign={mockCampaign} />);
    const infoPanel = container.querySelector('[data-testid="campaign-quick-info"]') as HTMLElement;
    expect(infoPanel.className).toContain('max-w-3xl');
    expect(infoPanel.className).toContain('mx-auto');
    expect(infoPanel.className).toContain('lg:max-w-none');
  });

  it('still renders creator info, tab labels, and the campaign story below the hero section', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    expect(screen.getByText(mockCampaign.creator.name)).toBeDefined();
    expect(screen.getByText('Cerita')).toBeDefined();
    expect(screen.getByText('Kabar Terbaru')).toBeDefined();
    expect(screen.getByText('Pencairan Dana')).toBeDefined();
  });

  it('makes no identity claim for a creator stored as verified -- that flag is self-declared (gap C2)', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    expect(screen.queryByText(/terverifikasi/i)).toBeNull();
  });

  it('keeps a single fixed-position donate CTA visible on every viewport, with no separate desktop-only duplicate', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    const ctaLinks = screen.getAllByText('Donasi sekarang');
    expect(ctaLinks).toHaveLength(1);
    const fixedBar = ctaLinks[0].closest('.fixed') as HTMLElement;
    expect(fixedBar).not.toBeNull();
    expect(fixedBar.className).not.toContain('lg:hidden');
  });

  it('renders the confirmed/collected amount in the Record register mono typeface', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    const amount = screen.getByText('Rp25.841.000');
    expect(amount.className).toContain('font-mono');
  });

  it('does not apply the mono typeface to the target amount, title, or donate CTA', () => {
    render(<CampaignDetailView campaign={mockCampaign} />);
    const targetAmount = screen.getByText('Rp50.000.000');
    expect(targetAmount.className).not.toContain('font-mono');
    const titles = screen.getAllByText(mockCampaign.title);
    titles.forEach((title) => {
      expect(title.className).not.toContain('font-mono');
    });
    const donateCta = screen.getByText('Donasi sekarang');
    expect(donateCta.className).not.toContain('font-mono');
  });

  it('does not disable shrink on the hero image or quick info panel, so the row can fit within its container at lg', () => {
    const { container } = render(<CampaignDetailView campaign={mockCampaign} />);
    const heroImage = container.querySelector('[data-testid="campaign-hero-image"]') as HTMLElement;
    const quickInfo = container.querySelector('[data-testid="campaign-quick-info"]') as HTMLElement;
    expect(heroImage.className).not.toContain('lg:shrink-0');
    expect(quickInfo.className).not.toContain('lg:shrink-0');
  });

  it('does not duplicate vertical padding between the quick info panel and the section below it', () => {
    const { container } = render(<CampaignDetailView campaign={mockCampaign} />);
    const quickInfo = container.querySelector('[data-testid="campaign-quick-info"]') as HTMLElement;
    expect(quickInfo.className).not.toContain('py-4');
    expect(quickInfo.className).toContain('pt-4');
  });
});

describe('CampaignDetailView -- where the Campaign stands', () => {
  const SUSPENDED_COPY = 'Campaign ini sedang ditinjau dan tidak menerima donasi.';
  const CANCELLED_COPY = 'Fundraiser telah menarik Campaign ini.';
  const ENDED_COPY = 'Campaign ini telah berakhir.';

  // The payload GET /api/campaigns/[slug] returns to whoever asks; the
  // owner's carries suspensionReason, anyone else's leaves it out.
  let apiCampaign: Record<string, unknown>;

  beforeEach(() => {
    apiCampaign = { ...mockCampaign, lifecycleStatus: 'SUSPENDED' };
    global.fetch = vi.fn(async () =>
      ({ ok: true, json: async () => ({ campaign: apiCampaign }) }) as Response
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderAs(lifecycleStatus: CampaignDetailData['lifecycleStatus']) {
    return render(<CampaignDetailView campaign={{ ...mockCampaign, lifecycleStatus }} />);
  }

  it('shows no banner and offers donating while Active', () => {
    renderAs('ACTIVE');
    expect(screen.queryByRole('status', { name: 'Status Campaign' })).toBeNull();
    expect(screen.getByText('Donasi sekarang')).toBeDefined();
  });

  it('says a Suspended Campaign is under review, and offers no donating', async () => {
    renderAs('SUSPENDED');
    expect(screen.getByRole('status', { name: 'Status Campaign' }).textContent).toContain(SUSPENDED_COPY);
    expect(screen.queryByText('Donasi sekarang')).toBeNull();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });

  it('says the Fundraiser withdrew a Cancelled Campaign, which does not read as Suspended (PRD §8)', () => {
    renderAs('CANCELLED');
    const banner = screen.getByRole('status', { name: 'Status Campaign' });
    expect(banner.textContent).toContain(CANCELLED_COPY);
    expect(banner.textContent).not.toContain(SUSPENDED_COPY);
    expect(screen.queryByText('Donasi sekarang')).toBeNull();
  });

  it.each(['EXPIRED', 'COMPLETED'] as const)('says a %s Campaign has ended, and offers no donating', (status) => {
    renderAs(status);
    expect(screen.getByRole('status', { name: 'Status Campaign' }).textContent).toContain(ENDED_COPY);
    expect(screen.queryByText('Donasi sekarang')).toBeNull();
  });

  it.each(['DRAFT', 'SUBMITTED', 'REJECTED'] as const)('offers no donating for a %s Campaign', (status) => {
    renderAs(status);
    expect(screen.queryByText('Donasi sekarang')).toBeNull();
  });

  // Only its Fundraiser, Verifiers and Admins ever see an unapproved
  // Campaign; the banner tells them where it stands and that it is not public.
  it.each([
    ['DRAFT', 'Draf'],
    ['SUBMITTED', 'Diajukan'],
    ['REJECTED', 'Ditolak'],
  ] as const)('says where a %s Campaign stands, and that it is not public', (status, phrase) => {
    renderAs(status);
    const banner = screen.getByRole('status', { name: 'Status Campaign' });
    expect(banner.textContent).toContain(phrase);
    expect(banner.textContent).toContain('belum tampil untuk publik');
  });

  it('shows the owning Fundraiser the Suspension reason under the banner', async () => {
    apiCampaign = { ...apiCampaign, suspensionReason: 'Dokumen penerima manfaat belum lengkap' };
    renderAs('SUSPENDED');
    expect(await screen.findByText(/Dokumen penerima manfaat belum lengkap/)).toBeDefined();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/campaigns/bantu-korban-bencana',
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('shows no reason to anyone the API withholds it from', async () => {
    renderAs('SUSPENDED');
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByText(/Alasan/)).toBeNull();
  });

  it('does not ask for a reason when the Campaign is not Suspended', () => {
    renderAs('CANCELLED');
    // Traffic Source counts (ticket 24) are asked for regardless of
    // lifecycle status, so this checks the Suspension-reason call
    // specifically, not "no fetch happened at all".
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/campaigns/bantu-korban-bencana',
      expect.objectContaining({ cache: 'no-store' })
    );
  });
});

describe('CampaignDetailView -- the Fundraiser withdraws a pending submission (verification-request 10)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function submittedCampaign(overrides: Record<string, unknown> = {}) {
    return { ...mockCampaign, lifecycleStatus: 'SUBMITTED' as const, ...overrides };
  }

  it('offers "Tarik pengajuan" while a request is pending -- GET /api/campaigns/[slug] answers it only to the owning Fundraiser', async () => {
    global.fetch = vi.fn(async () =>
      ({
        ok: true,
        json: async () => ({ campaign: { ...submittedCampaign(), pendingVerificationRequestId: 'request-9' } }),
      }) as Response
    ) as unknown as typeof fetch;

    render(<CampaignDetailView campaign={submittedCampaign()} />);

    expect(await screen.findByRole('button', { name: 'Tarik pengajuan' })).toBeDefined();
  });

  it.each(['DRAFT', 'REJECTED', 'ACTIVE'] as const)(
    'never asks and never offers the button for a %s Campaign',
    (status) => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch;
      render(<CampaignDetailView campaign={{ ...mockCampaign, lifecycleStatus: status }} />);
      expect(screen.queryByRole('button', { name: 'Tarik pengajuan' })).toBeNull();
      // Traffic Source counts (ticket 24) are asked for regardless of
      // lifecycle status; this checks the withdrawal-eligibility call
      // specifically, not "no fetch happened at all".
      expect(global.fetch).not.toHaveBeenCalledWith(
        '/api/campaigns/bantu-korban-bencana',
        expect.objectContaining({ cache: 'no-store' })
      );
    }
  );

  it('offers no button to a Verifier or Admin -- the API withholds pendingVerificationRequestId from them', async () => {
    global.fetch = vi.fn(async () =>
      ({ ok: true, json: async () => ({ campaign: submittedCampaign() }) }) as Response
    ) as unknown as typeof fetch;

    render(<CampaignDetailView campaign={submittedCampaign()} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Tarik pengajuan' })).toBeNull();
  });

  it('withdraws the request and shows the Campaign back at Draft', async () => {
    const posts: string[] = [];
    let gets = 0;
    global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      // Traffic Source counts (ticket 24) fetch the same Campaign
      // independently of the withdrawal flow this test drives -- answered
      // separately so it does not consume a slot `gets` is counting.
      if (String(_url).endsWith('/traffic-sources')) {
        return { ok: false, status: 403 } as Response;
      }
      if (init?.method === 'POST') {
        posts.push(String(_url));
        return { ok: true, json: async () => ({}) } as Response;
      }
      gets += 1;
      return {
        ok: true,
        json: async () =>
          gets === 1
            ? { campaign: { ...submittedCampaign(), pendingVerificationRequestId: 'request-9' } }
            : { campaign: { ...mockCampaign, lifecycleStatus: 'DRAFT' } },
      } as Response;
    }) as unknown as typeof fetch;

    render(<CampaignDetailView campaign={submittedCampaign()} />);

    const button = await screen.findByRole('button', { name: 'Tarik pengajuan' });
    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Status Campaign' }).textContent).toContain('Draf')
    );
    expect(screen.queryByRole('button', { name: 'Tarik pengajuan' })).toBeNull();
    expect(posts).toEqual(['/api/campaigns/bantu-korban-bencana/verification-requests/request-9/withdraw']);
  });

  it('withdraws a resubmission and shows the Campaign back at Rejected', async () => {
    let gets = 0;
    global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (String(_url).endsWith('/traffic-sources')) {
        return { ok: false, status: 403 } as Response;
      }
      if (init?.method === 'POST') {
        return { ok: true, json: async () => ({}) } as Response;
      }
      gets += 1;
      return {
        ok: true,
        json: async () =>
          gets === 1
            ? { campaign: { ...submittedCampaign(), pendingVerificationRequestId: 'request-9' } }
            : { campaign: { ...mockCampaign, lifecycleStatus: 'REJECTED' } },
      } as Response;
    }) as unknown as typeof fetch;

    render(<CampaignDetailView campaign={submittedCampaign()} />);

    const button = await screen.findByRole('button', { name: 'Tarik pengajuan' });
    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Status Campaign' }).textContent).toContain('Ditolak')
    );
    expect(screen.queryByRole('button', { name: 'Tarik pengajuan' })).toBeNull();
  });

  it('shows the refusal and keeps the button when the withdraw is refused', async () => {
    global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return {
          ok: false,
          json: async () => ({ error: 'Verification Request ini sudah diputuskan.' }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ campaign: { ...submittedCampaign(), pendingVerificationRequestId: 'request-9' } }),
      } as Response;
    }) as unknown as typeof fetch;

    render(<CampaignDetailView campaign={submittedCampaign()} />);

    const button = await screen.findByRole('button', { name: 'Tarik pengajuan' });
    fireEvent.click(button);

    expect(await screen.findByText('Verification Request ini sudah diputuskan.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Tarik pengajuan' })).toBeDefined();
  });
});

describe('CampaignDetailView Traffic Source (ticket 24)', () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('captures a well-formed src from the URL for this campaign on mount', () => {
    window.history.pushState({}, '', `/campaign/${mockCampaign.slug}?src=whatsapp`);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch;

    render(<CampaignDetailView campaign={mockCampaign} />);

    expect(sessionStorage.getItem(`ffi:traffic-source:${mockCampaign.slug}`)).toBe('whatsapp');
  });

  it('renders nothing extra, and never calls the owner-only route, for an anonymous visitor', async () => {
    mockSession.value = { data: null };
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch;

    render(<CampaignDetailView campaign={mockCampaign} />);

    expect(global.fetch).not.toHaveBeenCalledWith(
      `/api/campaigns/${mockCampaign.slug}/traffic-sources`,
      expect.anything(),
    );
    expect(screen.queryByText(/Sumber Kunjungan/i)).toBeNull();
    mockSession.value = { data: { user: { id: 'user-1', assignments: [] } } };
  });

  it("shows counts per source to the campaign's own Fundraiser", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sources: [
          { source: 'whatsapp', count: 3 },
          { source: null, count: 5 },
        ],
      }),
    }) as unknown as typeof fetch;

    render(<CampaignDetailView campaign={mockCampaign} />);

    expect(await screen.findByText(/Sumber Kunjungan/i)).toBeDefined();
    expect(screen.getByText('whatsapp')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();
  });
});

describe('CampaignDetailView -- Pencairan Dana tab (ticket 22)', () => {
  afterEach(() => {
    cleanup();
  });

  // This is the actual public Campaign page (src/app/campaign/[slug]/page.tsx
  // renders this component, not CampaignDetail.tsx): the "tampil publik di
  // halaman Campaign" requirement (CONTEXT.md, Usage Report; PRD FFI-07a) has
  // to be reachable from here, or it is not reachable at all.
  it('switches to the Pencairan Dana tab, fetches disbursements, and shows a Usage Report on its Payout', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/disbursements')) {
        return {
          ok: true,
          json: async () => ({
            disbursements: [
              {
                id: 'payout-1',
                amount: 300_000,
                description: 'Pencairan pertama',
                proofImage: null,
                createdAt: '2026-09-01T00:00:00.000Z',
                usageReport: {
                  id: 'ur-1',
                  narrative: 'Dana dipakai untuk sembako.',
                  lineItems: [{ label: 'Sembako', amount: 300_000 }],
                  beneficiaryCount: 15,
                  photos: ['https://example.com/bukti.jpg'],
                  createdAt: '2026-09-02T00:00:00.000Z',
                  disputedAt: null,
                  disputedReason: null,
                },
              },
            ],
          }),
        } as Response;
      }
      return { ok: false, status: 403 } as Response;
    }) as unknown as typeof fetch;

    render(<CampaignDetailView campaign={mockCampaign} />);

    fireEvent.click(screen.getByText('Pencairan Dana'));

    expect(await screen.findByText('Dana dipakai untuk sembako.')).toBeDefined();
    expect(screen.getByText(/15 penerima manfaat/)).toBeDefined();
    expect(
      (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some((call) =>
        String(call[0]).includes(`/api/campaigns/${mockCampaign.slug}/disbursements`),
      ),
    ).toBe(true);
  });

  it('renders each http(s) photo as a link with rel="noopener noreferrer"', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/disbursements')) {
        return {
          ok: true,
          json: async () => ({
            disbursements: [
              {
                id: 'payout-1',
                amount: 300_000,
                description: 'Pencairan pertama',
                proofImage: null,
                createdAt: '2026-09-01T00:00:00.000Z',
                usageReport: {
                  id: 'ur-1',
                  narrative: 'Dana dipakai untuk sembako.',
                  lineItems: [{ label: 'Sembako', amount: 300_000 }],
                  beneficiaryCount: 15,
                  photos: ['https://example.com/bukti-1.jpg', 'http://example.com/bukti-2.jpg'],
                  disputedAt: null,
                  disputedReason: null,
                },
              },
            ],
          }),
        } as Response;
      }
      return { ok: false, status: 403 } as Response;
    }) as unknown as typeof fetch;

    render(<CampaignDetailView campaign={mockCampaign} />);
    fireEvent.click(screen.getByText('Pencairan Dana'));

    const links = await screen.findAllByRole('link', { name: /foto bukti/i });
    expect(links).toHaveLength(2);
    links.forEach((link) => {
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    });
    expect(links[0].getAttribute('href')).toBe('https://example.com/bukti-1.jpg');
  });

  it('does not render a javascript: photo URL as a link', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/disbursements')) {
        return {
          ok: true,
          json: async () => ({
            disbursements: [
              {
                id: 'payout-1',
                amount: 300_000,
                description: 'Pencairan pertama',
                proofImage: null,
                createdAt: '2026-09-01T00:00:00.000Z',
                usageReport: {
                  id: 'ur-1',
                  narrative: 'Dana dipakai untuk sembako.',
                  lineItems: [{ label: 'Sembako', amount: 300_000 }],
                  beneficiaryCount: 15,
                  photos: ['javascript:alert(1)'],
                  disputedAt: null,
                  disputedReason: null,
                },
              },
            ],
          }),
        } as Response;
      }
      return { ok: false, status: 403 } as Response;
    }) as unknown as typeof fetch;

    render(<CampaignDetailView campaign={mockCampaign} />);
    fireEvent.click(screen.getByText('Pencairan Dana'));

    await screen.findByText('Dana dipakai untuk sembako.');
    expect(screen.queryByRole('link', { name: /foto bukti/i })).toBeNull();
  });

  it('says a Usage Report has not been sent yet for a Payout that has none, and hides the story while on this tab', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/disbursements')) {
        return {
          ok: true,
          json: async () => ({
            disbursements: [
              {
                id: 'payout-1',
                amount: 300_000,
                description: 'Pencairan pertama',
                proofImage: null,
                createdAt: '2026-09-01T00:00:00.000Z',
                usageReport: null,
              },
            ],
          }),
        } as Response;
      }
      return { ok: false, status: 403 } as Response;
    }) as unknown as typeof fetch;

    render(<CampaignDetailView campaign={mockCampaign} />);

    fireEvent.click(screen.getByText('Pencairan Dana'));

    expect(await screen.findByText('Usage Report belum dikirim untuk pencairan ini.')).toBeDefined();
    expect(screen.queryByText('Cerita lengkap')).toBeNull();
  });
});
