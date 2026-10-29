import { test, expect } from '@playwright/test';
import { DRAFT_SLUG } from './fixtures';

/**
 * VR-06: the privileged not-found view (ticket scope 2026-09-27).
 *
 * The cached Campaign page cannot know who is looking, so it renders the
 * 404 for every unapproved Campaign, and src/app/campaign/[slug]/not-found.tsx
 * asks the session-aware GET /api/campaigns/[slug] in the viewer's browser:
 * the Fundraiser, Verifiers and Admins get the Campaign back, anyone else
 * gets the same 404 as a missing slug. Unit tests prove the view against a
 * mocked fetch; these specs prove the real wiring in a real browser: the
 * server boundary, the request the view sends, and what each answer renders.
 *
 * The privileged answer is stubbed at the network edge: these specs were
 * written before the e2e seed had operators who can sign in (flag-dismiss.spec.ts
 * now signs in through the credentials endpoint). The stub stands in for the
 * API that route unit tests cover, while the browser side — the fetch, the
 * status banner, the missing donate CTA — is all real code.
 *
 * On the status code: the cached Campaign page cannot answer with HTTP 404.
 * `notFound()` throws behind the segment's loading.tsx, so the document has
 * already begun streaming as 200 by the time it is thrown and the status
 * cannot change (Next.js documents this trade-off; the response carries the
 * noindex that keeps the soft 404 out of search results). This is a property
 * of every streamed dynamic route here, not of Campaign visibility — a slug
 * that does not exist at all behaves identically. So these specs assert what
 * visibility actually rests on: the unapproved Campaign is absent from the
 * document, and the session-aware API, which is not streamed, refuses it
 * with a hard 404 identical to a missing slug's.
 */
test.describe('privileged not-found view', () => {
  test('an anonymous viewer is told the unapproved Campaign was not found', async ({ page }) => {
    const response = await page.goto(`/campaign/${DRAFT_SLUG}`);

    // The server boundary holds: an unapproved Campaign never reaches the
    // cached page, whatever the API says later.
    await expect(page.getByRole('heading', { name: 'Campaign tidak ditemukan' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Kembali ke beranda' })).toBeVisible();
    await expect(page.getByText('E2E Sumur Draf')).toHaveCount(0);
    // No privileged content leaks: the real API answers 404 for this
    // viewer, so no status banner ever renders.
    await expect(page.getByRole('status', { name: 'Status Campaign' })).toBeHidden({ timeout: 1000 });
    // The soft 404 is a 200 (see this file's comment) and says so: Next marks
    // the response noindex, which is what keeps an unapproved Campaign out of
    // a search index.
    expect(response?.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute('content', /noindex/);
  });

  test('the session-aware API refuses an unapproved Campaign with a hard 404', async ({ request }) => {
    // The API route is not streamed, so this is the boundary that does
    // answer with a real status — and the one the privileged view asks.
    const unapproved = await request.get(`/api/campaigns/${DRAFT_SLUG}`);
    const missing = await request.get('/api/campaigns/tidak-ada');

    expect(unapproved.status()).toBe(404);
    // Identical to a slug that never existed, so the 404 reveals nothing
    // about the Campaign, and never shared-cached.
    expect(await unapproved.text()).toBe(await missing.text());
    expect(unapproved.headers()['cache-control']).toContain('no-store');
  });

  test('a privileged viewer sees the unapproved Campaign with its status banner', async ({ page }) => {
    // What the session-aware API answers the Campaign's own Fundraiser
    // (shape mirrors GET /api/campaigns/[slug]'s { campaign } envelope).
    await page.route(`**/api/campaigns/${DRAFT_SLUG}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          campaign: {
            id: 'e2e-campaign-draft',
            slug: DRAFT_SLUG,
            title: 'E2E Sumur Draf',
            description: 'Deskripsi',
            story: '<p>Cerita</p>',
            coverImage: 'https://example.org/e2e-draft.jpg',
            targetAmount: 5_000_000,
            collectedAmount: 0,
            category: 'lingkungan',
            kind: 'DONATION',
            lifecycleStatus: 'DRAFT',
            isUrgent: false,
            isDemo: false,
            deadline: null,
            createdAt: '2026-09-01T00:00:00.000Z',
            updatedAt: '2026-09-01T00:00:00.000Z',
            creator: { id: 'e2e-fundraiser', name: 'E2E Fundraiser', avatar: null },
            collectingEntity: null,
            donationBlock: null,
            donationCount: 0,
          },
        }),
      })
    );

    await page.goto(`/campaign/${DRAFT_SLUG}`);

    await expect(page.getByText('E2E Sumur Draf').first()).toBeVisible();
    await expect(page.getByRole('status', { name: 'Status Campaign' })).toContainText('Draf');
    // A Draft takes no donations, so no donate call-to-action may appear.
    await expect(page.getByRole('link', { name: 'Donasi sekarang' })).toBeHidden({ timeout: 1000 });
    await expect(page.getByRole('heading', { name: 'Campaign tidak ditemukan' })).toBeHidden();
  });
});
