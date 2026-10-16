import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('should display the hero banner', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[aria-label="Hero banner carousel"]')).toBeVisible();
  });

  test('should display quick action tiles', async ({ page }) => {
    await page.goto('/');
    // The PRD's actual menu (src/lib/home/quickActionTiles.ts): Donasi and
    // Galang Dana are working destinations, and Kolaborasi CSR, Wakaf and
    // Hibah each open their own landing (ticket 75). The old "Donasi Otomatis" tile is
    // gone on purpose: AutoDonation was parked (plan
    // docs/superpowers/plans/2026-09-20-remove-wallet-park-autodonation.md).
    const tiles = page.getByRole('region', { name: 'Quick action tiles' });
    await expect(tiles).toBeVisible();
    await expect(tiles.getByRole('link', { name: /Donasi/ })).toHaveAttribute(
      'href',
      '/explore/all'
    );
    await expect(tiles.getByRole('link', { name: /Galang Dana/ })).toHaveAttribute(
      'href',
      '/campaign/create'
    );
    const landings: [string, string][] = [
      ['Kolaborasi CSR', '/kolaborasi-csr'],
      ['Wakaf', '/wakaf'],
      ['Hibah', '/hibah'],
    ];
    for (const [label, href] of landings) {
      await expect(tiles.getByRole('link', { name: new RegExp(label) })).toHaveAttribute('href', href);
    }
  });

  test('should have bottom navigation on mobile', async ({ page, viewport }) => {
    await page.goto('/');
    const nav = page.locator('[aria-label="Bottom navigation"]');
    // Bottom nav is hidden on desktop (lg:hidden = 1025px+)
    if (viewport && viewport.width >= 1025) {
      await expect(nav).toBeHidden();
    } else {
      await expect(nav).toBeVisible();
    }
  });
});

test.describe('Navigation', () => {
  test('should navigate to login page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Masuk ke Fund for Indonesia')).toBeVisible();
  });

  test('should navigate to register page', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByText('Daftar Akun')).toBeVisible();
  });

  test('should navigate from login to register', async ({ page }) => {
    await page.goto('/login');
    await page.click('text=Daftar di sini');
    await expect(page).toHaveURL(/\/register/);
    await expect(page.getByText('Daftar Akun')).toBeVisible();
  });

  test('should navigate from register to login', async ({ page }) => {
    await page.goto('/register');
    await page.click('text=Masuk di sini');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('Masuk ke Fund for Indonesia')).toBeVisible();
  });
});

test.describe('Search', () => {
  test('should navigate to search results page', async ({ page }) => {
    await page.goto('/search?q=bencana');
    await expect(page).toHaveURL(/\/search\?q=bencana/);
  });
});
