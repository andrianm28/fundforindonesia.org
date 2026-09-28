import { renderToString } from 'react-dom/server';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  // The panel refreshes the route after a request. That is a browser API, and
  // the page itself is a server component, so the panel is the only thing here
  // that reaches for it.
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

// The panel reads for itself, in the browser, so the screen exists there once
// its read resolves.
vi.stubGlobal(
  'fetch',
  vi.fn(async () =>
    Response.json({
      isDemo: false,
      lifecycleStatus: 'ACTIVE',
      escrowHold: 0,
      campaignBalance: 0,
      payouts: [],
      bankAccounts: [],
    }),
  ),
);

import { getServerSession } from '@/lib/auth';
import CampaignPayoutPage from './page';

const mockGetServerSession = getServerSession as unknown as Mock;
const fetchMock = vi.mocked(global.fetch);

/**
 * The page is asked for its markup the way the router asks a Server Component
 * for it: called, awaited, and the element rendered. That is the seam
 * moderasi/page.test.tsx and admin/page.test.tsx use. A page turned back into a
 * client component could not be asked this way at all -- its hooks throw
 * outside a render, which is the same fact as the one that matters here: its
 * HTML would be decided in the browser.
 */
const page = (slug = 'sumur-desa') => CampaignPayoutPage({ params: Promise.resolve({ slug }) });

describe('Campaign payout page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'fundraiser-1' } });
  });

  it('gives the Fundraiser the payout screen for their own Campaign', async () => {
    render(await page());

    expect(await screen.findByRole('region', { name: 'Pencairan dana' })).toBeDefined();
    // The slug is the route's, not a browser lookup's: the read is for the
    // Campaign whose screen was asked for.
    expect(fetchMock).toHaveBeenCalledWith('/api/user/campaigns/sumur-desa/payouts');
  });

  it('sends a signed-out visitor to the login page, before any of the screen exists', async () => {
    // A person who reaches this URL by typing it, or by an old link, has to be
    // told where to sign in rather than shown the read's refusal: without a
    // guard that arrives as "Gagal memuat data pencairan.", a complaint about a
    // screen they were never signed in to see, on a URL that looks broken. The
    // guard is settled before a byte of markup is produced, so there is nothing
    // of the screen to show them on the way out.
    mockGetServerSession.mockResolvedValue(null);

    await expect(page()).rejects.toThrow('NEXT_REDIRECT:/login');
    // And nobody's money is read on the way out: the read is refused
    // server-side, and the server never makes it.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('puts the screen in the initial HTML, before the browser has an answer about the session', async () => {
    // What the regression took away. A guard that waits for the browser's
    // session lookup reports 'loading' during the server render and on the
    // first paint, so it cannot be in the initial HTML: without JavaScript a
    // Fundraiser was looking at a white page where their own screen should be.
    // The server knows the session already, so it sends the screen.
    const html = renderToString(await page());

    expect(html).toMatch(/<h1[^>]*>Pencairan Dana<\/h1>/);
    // The panel is in that HTML too, in the state it starts in: it reads for
    // itself, so the screen says it is loading rather than ending at the title.
    expect(html).toContain('Memuat data pencairan...');
  });

  it('renders the shell on the server and leaves every figure to the browser', async () => {
    // Putting the shell back on the server does not move the read there. The
    // figures were always fetched in the browser, at the moment the Fundraiser
    // is looking at them, and that is where they stay: the server sends the
    // screen and the panel's own "Memuat data pencairan..." until its read
    // resolves.
    renderToString(await page());

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
