import { test, expect, type Page, type Browser } from '@playwright/test';
import {
  DOCUMENT_CAMPAIGN_ID,
  DOCUMENT_FUNDRAISER_EMAIL,
  DOCUMENT_SLUG,
  STRANGER_EMAIL,
  VERIFIER_EMAIL,
  operatorPassword,
} from './fixtures';

/**
 * Ticket 64: upload, then view. The Fundraiser uploads their KTP from the
 * Campaign's documents screen; the Verifier handling its open request sees it
 * beside the checklist item, which is no longer disabled, and opens it; a
 * signed-in stranger and a signed-out visitor get nothing. Real browser,
 * production bundle, real private volume (PRIVATE_DOCUMENT_DIR in the CI job).
 *
 * The three viewport projects share the Campaign, so each one uploads its own
 * file and the checks below look for "at least one" document.
 */

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

async function signInAs(page: Page, email: string) {
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  const signedIn = await page.request.post('/api/auth/callback/credentials', {
    form: { csrfToken, email, password: operatorPassword(), json: 'true' },
  });
  expect(signedIn.ok()).toBe(true);
  const session = await (await page.request.get('/api/auth/session')).json();
  expect(session.user?.email).toBe(email);
}

async function signedInPage(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, email);
  return { page, close: () => context.close() };
}

test('a Fundraiser uploads a document and only the people allowed can open it', async ({ browser }) => {
  // 1. The Fundraiser uploads through their screen.
  const fundraiser = await signedInPage(browser, DOCUMENT_FUNDRAISER_EMAIL);
  await fundraiser.page.goto(`/akun/kampanye-saya/${DOCUMENT_SLUG}/dokumen`);
  const item = fundraiser.page.getByTestId('document-item-identitas-fundraiser');
  await expect(item).toBeVisible();
  const answered = fundraiser.page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/documents',
  );
  await expect(async () => {
    await item.getByLabel(/^Berkas KTP Fundraiser/).setInputFiles({ name: 'ktp.pdf', mimeType: 'application/pdf', buffer: PDF });
    await item.getByRole('button', { name: 'Unggah' }).click({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  const upload = await answered;
  expect(upload.status()).toBe(201);
  const { document } = await upload.json();
  expect(document.id).toBeTruthy();
  expect(JSON.stringify(document)).not.toMatch(/uploads|storagePath/);

  // The Fundraiser can open their own document.
  const own = await fundraiser.page.request.get(`/api/documents/${document.id}`);
  expect(own.status()).toBe(200);
  expect(own.headers()['content-type']).toBe('application/pdf');
  expect(own.headers()['cache-control']).toContain('no-store');
  await fundraiser.close();

  // 2. The Verifier sees it beside the checklist item and opens it.
  const verifier = await signedInPage(browser, VERIFIER_EMAIL);
  await verifier.page.goto(`/moderasi/campaigns/${DOCUMENT_CAMPAIGN_ID}`);
  await expect(verifier.page.getByRole('checkbox', { name: /KTP Fundraiser/ })).toBeEnabled();
  const link = verifier.page.locator(`a[href="/api/documents/${document.id}"]`).first();
  await expect(link).toBeVisible();
  const seen = await verifier.page.request.get(`/api/documents/${document.id}`);
  expect(seen.status()).toBe(200);
  expect(Buffer.from(await seen.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await verifier.close();

  // 3. A signed-in stranger gets the same 404 as a document that does not exist.
  const stranger = await signedInPage(browser, STRANGER_EMAIL);
  expect((await stranger.page.request.get(`/api/documents/${document.id}`)).status()).toBe(404);
  expect((await stranger.page.request.get('/api/documents/does-not-exist')).status()).toBe(404);
  await stranger.close();

  // 4. Signed out is refused, and the file is nowhere public.
  const anonymous = await browser.newContext();
  expect((await anonymous.request.get(`/api/documents/${document.id}`)).status()).toBe(401);
  await anonymous.close();
});
