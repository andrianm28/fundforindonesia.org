import { test, expect } from '@playwright/test';
import { RECEIPT_TOKEN } from './fixtures';

/**
 * The Receipt end of the QRIS path (ticket scope 2026-09-27): once a
 * donation's payment settles, its Receipt is the donor's proof — reachable
 * from the email with no account, gated by the token alone. The fixture
 * writes the settled donation and its receipt the way settlement would
 * leave them, so this page is fully real: server query, print view, and
 * the 404 for an unknown token.
 */
test.describe('receipt', () => {
  test('a settled donation renders its printable receipt', async ({ page }) => {
    const response = await page.goto(`/receipt/${RECEIPT_TOKEN}`);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Bukti Donasi' })).toBeVisible();
    await expect(page.getByText('E2E Air Bersih Desa')).toBeVisible();
    // The seeded settled donation is Rp75.000 (RECEIPT_AMOUNT in seed-e2e.ts).
    await expect(page.getByText('Rp75.000')).toBeVisible();
    // A guest donation with no name falls back to a generic donor label.
    // Scoped to the value cell: the row's <dt> carries the same word.
    await expect(page.locator('dd', { hasText: /^Donor$/ })).toHaveText('Donor');
    await expect(page.getByRole('button', { name: 'Cetak' })).toBeVisible();
  });

  test('an unknown token is a 404', async ({ page }) => {
    const response = await page.goto('/receipt/token-yang-tidak-ada');
    expect(response?.status()).toBe(404);
  });
});
