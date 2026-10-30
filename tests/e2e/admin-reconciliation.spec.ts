import { test, expect, type Page } from '@playwright/test';
import { ADMIN_EMAIL, operatorPassword } from './fixtures';

/**
 * Ticket 63: reconciliation from the Admin screen, end to end. An Admin opens
 * /admin/reconciliation, reads the report, and records a sweep from a provider
 * through the form; the page refreshes and shows the sweep against the books.
 * Real browser, production bundle, session, route, recordProviderWithdrawal
 * and the seeded Postgres; nothing is stubbed.
 *
 * Desktop only: logins are rate limited per account (10 per 15 minutes,
 * src/lib/auth.ts) and flag-dismiss.spec.ts already signs this Admin in once
 * per project, so this spec adds one sign-in per attempt, not three. Each
 * attempt uses a reference of its own, since a retry runs against the rows a
 * failed attempt left and a reference can be recorded only once.
 */

async function signInAs(page: Page, email: string) {
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  const signedIn = await page.request.post('/api/auth/callback/credentials', {
    form: { csrfToken, email, password: operatorPassword(), json: 'true' },
  });
  expect(signedIn.ok()).toBe(true);
  const session = await (await page.request.get('/api/auth/session')).json();
  expect(session.user?.email).toBe(email);
}

test.describe('Admin reconciliation page', () => {
  test('an anonymous visitor is sent to login by the middleware, never shown the page', async ({ page }) => {
    // The 404 for a signed-in non-Admin comes from the /admin layout
    // (src/app/admin/layout.test.tsx); an anonymous visitor never reaches it.
    await page.goto('/admin/reconciliation');

    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fadmin%2Freconciliation/);
    await expect(page.getByText('Saldo per penyedia')).toHaveCount(0);
  });

  test('an anonymous caller cannot record a provider withdrawal', async ({ request }) => {
    // Signed out is 401; a signed-in non-Admin gets 404 (withHiddenAssignmentCheck).
    const res = await request.post('/api/admin/provider-withdrawals', { data: { provider: 'sumopod' } });

    expect(res.status()).toBe(401);
  });

  test('an Admin reads the report and records a provider withdrawal from the screen', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Desktop', 'one Admin sign-in per run; see the file comment');
    const reference = `E2E-WD-${Date.now()}`;

    await signInAs(page, ADMIN_EMAIL);
    await page.goto('/admin/reconciliation');

    await expect(page.getByRole('heading', { level: 1, name: 'Rekonsiliasi' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Ringkasan' })).toBeVisible();
    await expect(page.getByRole('region', { name: /antrean webhook/i })).toBeVisible();

    const form = page.getByRole('region', { name: /catat penarikan/i });
    const answered = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/admin/provider-withdrawals',
    );
    // Filled and clicked as one retried step: the server-rendered form is there
    // before React is, so text typed too early never reaches state and the
    // button stays disabled (the same reason as flag-dismiss.spec.ts).
    await expect(async () => {
      await form.getByLabel('Penyedia pembayaran').selectOption('sumopod');
      await form.getByLabel(/^Referensi penarikan/).fill(reference);
      await form.getByLabel(/^Nominal ditarik/).fill('1000');
      await form.getByLabel(/^Nama pemilik rekening/).fill('E2E Yayasan');
      await form.getByLabel(/^Saldo penyedia sebelum/).fill('5000');
      await form.getByLabel(/^Saldo penyedia sesudah/).fill('4000');
      await form.getByLabel(/^Bukti penarikan/).fill('e2e: tangkapan layar dashboard');
      await form.getByRole('button', { name: 'Catat penarikan' }).click({ timeout: 1000 });
    }).toPass();
    expect((await answered).status()).toBe(201);

    const providers = page.getByRole('region', { name: /saldo per penyedia/i });
    const sweep = providers.getByRole('row').filter({ hasText: reference });
    await expect(sweep).toBeVisible();
    await expect(sweep).toContainText('Cocok');
  });
});
