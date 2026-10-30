import { test, expect } from '@playwright/test';

/**
 * Ticket 77: the Admin Campaign Transfer screen and its APIs at the real
 * server boundary. CI has no login harness (see privileged-not-found.spec.ts),
 * so these prove the refusal side: nothing is revealed to a caller who is not
 * a signed-in Admin. The two-person and Kind rules are proved against the
 * service layer (src/lib/money/campaign-transfers tests).
 */
test.describe('Campaign Transfer screen', () => {
  test('an anonymous caller gets a literal 404 from the request API', async ({ request }) => {
    const res = await request.post('/api/admin/campaign-transfers', {
      data: { sourceId: 'x', targetId: 'y', reason: 'z' },
    });

    expect(res.status()).toBe(404);
  });

  test('an anonymous caller gets a literal 404 from the decision API', async ({ request }) => {
    const res = await request.post('/api/admin/campaign-transfers/ct-1/decision', {
      data: { decision: 'approve' },
    });

    expect(res.status()).toBe(404);
  });

  test('an anonymous visitor is sent to login, never shown the screen', async ({ page }) => {
    await page.goto('/admin/campaign-transfers');

    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fadmin%2Fcampaign-transfers/);
    await expect(page.getByText('Menunggu keputusan')).toHaveCount(0);
  });
});
