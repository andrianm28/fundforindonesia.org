import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  CSR_ALPHA_DOMAIN,
  CSR_ALPHA_EMAIL,
  CSR_ALPHA_NEEDS,
  CSR_BETA_EMAIL,
  CSR_BETA_NEEDS,
  operatorPassword,
} from './fixtures';

/**
 * Tim CSR accounts (ticket E9/01, tahap 2): a person registers and joins the
 * company of their email domain, a verified member sees their own company's
 * Partnership Inquiries and nobody else's, and everyone else gets a real 404.
 * Real browser, production bundle, the real routes.
 */

async function signedIn(browser: Browser, email: string, password: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  const response = await page.request.post('/api/auth/callback/credentials', {
    form: { csrfToken, email, password, json: 'true' },
  });
  expect(response.ok()).toBe(true);
  return { page, close: () => context.close() };
}

test('a person registers on a company domain but cannot join or see anything until the email is verified', async ({ browser, request }, testInfo) => {
  const email = `orang-${testInfo.project.name.toLowerCase()}-${Date.now()}@${CSR_ALPHA_DOMAIN}`;
  const password = operatorPassword();
  const registered = await request.post('/api/auth/register', { data: { name: 'Orang Baru', email, password, acceptTerms: true, acceptPrivacy: true } });
  expect(registered.status()).toBe(201);

  const { page, close } = await signedIn(browser, email, password);
  await page.goto('/akun/tim-csr/gabung');
  const joined = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/csr/membership',
  );
  await page.getByRole('button', { name: 'Gabung sebagai Tim CSR' }).click();
  expect((await joined).status()).toBe(403);
  await expect(page.getByRole('status')).toContainText('Verifikasi email');
  await expect(page.getByText('E2E Alpha')).toHaveCount(0);

  // Not a member, and told nothing about Alpha: the company's page does not exist for this person.
  await page.goto('/akun/tim-csr');
  await expect(page.getByText('This page could not be found.')).toBeVisible();
  expect((await page.request.get('/api/csr/inquiries')).status()).toBe(404);
  await close();
});

test('a verified member sees only their own company\'s Inquiries', async ({ browser }) => {
  const password = operatorPassword();

  const alpha = await signedIn(browser, CSR_ALPHA_EMAIL, password);
  await alpha.page.goto('/akun/tim-csr');
  const alphaMain = alpha.page.getByRole('main');
  await expect(alphaMain.getByTestId('csr-inquiry')).toHaveCount(1);
  await expect(alphaMain).toContainText(CSR_ALPHA_NEEDS);
  await expect(alphaMain).not.toContainText(CSR_BETA_NEEDS);
  const alphaApi = await (await alpha.page.request.get('/api/csr/inquiries')).text();
  expect(alphaApi).toContain(CSR_ALPHA_NEEDS);
  expect(alphaApi).not.toContain(CSR_BETA_NEEDS);
  expect((await alpha.page.request.get('/api/csr/impact-report')).status()).toBe(200);
  await alpha.close();

  const beta = await signedIn(browser, CSR_BETA_EMAIL, password);
  const betaApi = await (await beta.page.request.get('/api/csr/inquiries')).text();
  expect(betaApi).toContain(CSR_BETA_NEEDS);
  expect(betaApi).not.toContain(CSR_ALPHA_NEEDS);
  await beta.close();
});

test('an anonymous visitor gets 404 from the member routes', async ({ request }) => {
  expect((await request.get('/api/csr/inquiries')).status()).toBe(404);
  expect((await request.get('/api/csr/impact-report')).status()).toBe(404);
  expect((await request.post('/api/csr/inquiries', { data: { programId: 'x', needs: 'y' } })).status()).toBe(404);
});
