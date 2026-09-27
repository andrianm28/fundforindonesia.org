import { test, expect } from '@playwright/test';
import { ACTIVE_SLUG } from './fixtures';

/**
 * The QRIS donation path (ticket scope 2026-09-27): amount → QRIS →
 * confirm → the provider hand-off or the created-donation screen, and the
 * Receipt a settled donation leaves behind (receipt.spec.ts).
 *
 * The campaign read is real (SWR against GET /api/campaigns/[slug], served
 * from the seeded Postgres). The submit is stubbed at the network edge:
 * in production `next start` the mock payment adapter is refused by
 * sandboxInProductionReason, so no inspectable QRIS charge can be raised
 * in CI — the stub stands in for the provider response the API route's
 * unit tests cover, while the request the page sends and the screen it
 * shows are all real code. Guests check out with an email (no session in
 * CI), which also proves the Guest Donor contact requirement end to end.
 */
test.describe('QRIS donation flow', () => {
  test('a guest donor picks an amount, pays by QRIS, and sees the created donation', async ({ page }) => {
    let submitted: Record<string, unknown> | null = null;
    await page.route('**/api/donations', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      submitted = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          donationId: 'e2e-donation-baru',
          amount: 50_000,
          paymentMethod: 'qris',
          paymentStatus: 'pending',
          campaignTitle: 'E2E Air Bersih Desa',
          // No redirectUrl: the mock provider answers inline, so the page
          // shows its created-donation screen instead of handing off.
          paymentInstructions: { type: 'qris' },
        }),
      });
    });

    await page.goto(`/campaign/${ACTIVE_SLUG}/donate`);

    // Step 1: a preset amount, straight from the seeded campaign's page.
    await expect(page.getByText('E2E Air Bersih Desa').first()).toBeVisible();
    await page.getByRole('button', { name: 'Donasi Rp50.000' }).click();
    await page.getByRole('button', { name: 'Lanjutkan' }).click();

    // Step 2: QRIS is the only method the provider can charge.
    await expect(page.getByRole('heading', { name: 'Pilih Metode Pembayaran' })).toBeVisible();
    await page.getByRole('button', { name: /QRIS/ }).click();
    await page.getByRole('button', { name: 'Lanjutkan' }).click();

    // Step 3: the guest contact requirement, then confirm.
    await page.locator('#guest-email').fill('e2e-donor@example.org');
    await page.getByRole('button', { name: 'Donasi Sekarang' }).click();

    // Step 4: the created-donation screen names the amount and campaign.
    await expect(page.getByRole('heading', { name: 'Donasi Dibuat' })).toBeVisible();
    await expect(page.getByText('Rp50.000')).toBeVisible();
    await expect(page.getByText('E2E Air Bersih Desa').first()).toBeVisible();

    // And the page sent what the API validates: the method TYPE, the
    // campaign, and the amount the donor chose.
    expect(submitted).toMatchObject({
      campaignId: 'e2e-campaign-aktif',
      amount: 50_000,
      paymentMethod: 'qris',
      guestEmail: 'e2e-donor@example.org',
    });
  });

  test('confirming without a guest email is refused before anything is sent', async ({ page }) => {
    let posts = 0;
    await page.route('**/api/donations', (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posts += 1;
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ paymentInstructions: { type: 'qris' } }),
      });
    });

    await page.goto(`/campaign/${ACTIVE_SLUG}/donate`);
    await page.getByRole('button', { name: 'Donasi Rp50.000' }).click();
    await page.getByRole('button', { name: 'Lanjutkan' }).click();
    await page.getByRole('button', { name: /QRIS/ }).click();
    await page.getByRole('button', { name: 'Lanjutkan' }).click();

    await page.getByRole('button', { name: 'Donasi Sekarang' }).click();

    // Scoped to the message the #guest-email input points at with
    // aria-describedby. A bare getByRole('alert') matches two elements --
    // this one and Next's own #__next-route-announcer__, which is a route
    // announcement, not a field error -- so it cannot be asserted on alone.
    await expect(page.locator('#guest-email-error')).toHaveText(
      'Email harus diisi untuk donasi tanpa akun'
    );
    await expect(page.locator('#guest-email')).toHaveAttribute('aria-invalid', 'true');
    expect(posts).toBe(0);
  });
});
