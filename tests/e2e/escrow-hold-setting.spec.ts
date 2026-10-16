import { test, expect } from '@playwright/test';
import { ACTIVE_SLUG } from './fixtures';

/**
 * Ticket 90: the Admin Escrow Hold setting at the real server boundary.
 * The seed sets no Escrow Hold, so the length a Donor is shown is the 7-day
 * fallback; the setting itself is Admin-only, and CI has no login harness
 * (see privileged-not-found.spec.ts), so these specs prove the refusal side
 * and the Donor-facing value. Writes and resolution are proved against
 * Postgres in src/__tests__/integration/escrow-hold-setting-real-db.test.ts.
 */
test.describe('Escrow Hold setting', () => {
  test('the Campaign API shows a Donor the 7-day fallback when no Admin has set a length', async ({ request }) => {
    const res = await request.get(`/api/campaigns/${ACTIVE_SLUG}`);

    expect(res.status()).toBe(200);
    expect((await res.json()).campaign.escrowHoldDays).toBe(7);
  });

  test('an anonymous caller cannot set the Escrow Hold', async ({ request }) => {
    const res = await request.post('/api/admin/escrow-hold', { data: { scope: 'DEFAULT', days: 1 } });

    expect(res.status()).toBe(404);
  });

  test('an anonymous visitor to the Admin panel is not shown the panel, and is not redirected', async ({ page }) => {
    // The page streams, so the document status is already 200 when notFound()
    // throws (see privileged-not-found.spec.ts); what is provable is that the
    // panel never renders and the URL is kept rather than redirected home.
    await page.goto('/admin/escrow-hold');

    await expect(page).toHaveURL(/\/admin\/escrow-hold$/);
    await expect(page.getByRole('heading', { name: 'Escrow Hold' })).toHaveCount(0);
    await expect(page.getByText('Lama yang berlaku')).toHaveCount(0);
  });
});
