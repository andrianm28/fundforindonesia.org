import { test, expect, type Page, type Browser } from '@playwright/test';
import { EDIT_FUNDRAISER_EMAIL, EDIT_SLUG, STRANGER_EMAIL, operatorPassword } from './fixtures';

/**
 * Tickets 72, 65: a Fundraiser opens their Draft on the manage screen, edits
 * it and saves; the edit is there on reload. Someone else, and a Campaign
 * that does not exist, get the same 404 page. Real browser, production
 * bundle, the real PATCH route.
 *
 * The viewport projects share the Draft, so each one saves a title of its own.
 */

async function signedInPage(browser: Browser, email: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  const signedIn = await page.request.post('/api/auth/callback/credentials', {
    form: { csrfToken, email, password: operatorPassword(), json: 'true' },
  });
  expect(signedIn.ok()).toBe(true);
  return { page, close: () => context.close() };
}

test('a Fundraiser edits their Draft and the edit is kept', async ({ browser }, testInfo) => {
  const title = `E2E Draft Diedit ${testInfo.project.name}`;
  const fundraiser = await signedInPage(browser, EDIT_FUNDRAISER_EMAIL);
  const { page } = fundraiser;

  // Scoped to <main>: the router can keep a hidden copy of an earlier
  // render in the DOM, which makes a page-wide test id match twice.
  const main = page.getByRole('main');
  await page.goto(`/akun/kampanye-saya/${EDIT_SLUG}`);
  await expect(main.getByRole('heading', { name: 'Kelola Campaign' })).toBeVisible();
  await expect(main.getByTestId('edit-target')).toContainText('2.000.000');
  // Not an Active Campaign: no way to end it from here.
  await expect(main.getByRole('button', { name: 'Tandai Selesai' })).toHaveCount(0);

  await main.getByLabel(/Judul Campaign/).fill(title);
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname === `/api/campaigns/${EDIT_SLUG}`,
  );
  await main.getByRole('button', { name: 'Simpan Perubahan' }).click();
  expect((await saved).status()).toBe(200);
  await expect(page).toHaveURL(/\/akun\/kampanye-saya$/);

  await page.goto(`/akun/kampanye-saya/${EDIT_SLUG}`);
  await expect(main.getByLabel(/Judul Campaign/)).toHaveValue(title);
  await fundraiser.close();
});

test('another signed-in user gets the 404 page, the same as for a Campaign that does not exist', async ({ browser }) => {
  const stranger = await signedInPage(browser, STRANGER_EMAIL);
  for (const slug of [EDIT_SLUG, 'e2e-slug-yang-tidak-ada']) {
    await stranger.page.goto(`/akun/kampanye-saya/${slug}`);
    await expect(stranger.page.getByText('This page could not be found.')).toBeVisible();
    await expect(stranger.page.getByLabel(/Judul Campaign/)).toHaveCount(0);
  }
  await stranger.close();
});
