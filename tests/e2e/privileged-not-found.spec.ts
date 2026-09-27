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
 * The privileged answer is stubbed at the network edge because CI has no
 * login harness (no passwordless session fixture): the stub stands in for
 * the API that route unit tests cover, while the browser side — the fetch,
 * the status banner, the missing donate CTA — is all real code.
 */
test.describe('privileged not-found view', () => {
  test('an anonymous viewer is told the unapproved Campaign was not found', async ({ page }) => {
    const response = await page.goto(`/campaign/${DRAFT_SLUG}`);

    // The server boundary holds: an unapproved Campaign is a 404 for
    // everyone at the cached page, whatever the API says later.
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Campaign tidak ditemukan' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Kembali ke beranda' })).toBeVisible();
    // No privileged content leaks: the real API answers 404 for this
    // viewer, so no status banner ever renders.
    await expect(page.getByRole('status', { name: 'Status Campaign' })).toBeHidden({ timeout: 1000 });
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
