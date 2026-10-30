import { test, expect, type Page } from '@playwright/test';
import { KABAR_FUNDRAISER_EMAIL, KABAR_SLUG, STRANGER_EMAIL, operatorPassword } from './fixtures';

/**
 * Ticket 70: the Fundraiser writes a Kabar Terbaru from their screen, then it
 * reads on the public Campaign page under the "Kabar Terbaru" tab. The three
 * viewport projects share the Campaign, so each run uses its own title.
 */

async function signInAs(page: Page, email: string) {
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  const signedIn = await page.request.post('/api/auth/callback/credentials', {
    form: { csrfToken, email, password: operatorPassword(), json: 'true' },
  });
  expect(signedIn.ok()).toBe(true);
}

test('a Fundraiser writes an update and the public reads it as text', async ({ browser }, testInfo) => {
  const title = `Kabar e2e ${testInfo.project.name} ${Date.now()}`;
  const marker = `<b>bukan markup ${testInfo.project.name} ${Date.now()}</b>`;
  const body = `${marker}\nbaris kedua`;

  const owner = await browser.newContext();
  const page = await owner.newPage();
  await signInAs(page, KABAR_FUNDRAISER_EMAIL);
  await page.goto(`/akun/kampanye-saya/${KABAR_SLUG}/kabar`);
  await page.getByLabel('Judul').fill(title);
  await page.getByLabel('Isi kabar').fill(body);
  await page.getByRole('button', { name: 'Terbitkan kabar' }).click();
  await expect(page.getByText('Kabar terbit.')).toBeVisible();
  await owner.close();

  // Signed out: the public tab shows it, and the markup stays text.
  const visitor = await browser.newContext();
  const publicPage = await visitor.newPage();
  await publicPage.goto(`/campaign/${KABAR_SLUG}`);
  await publicPage.getByRole('button', { name: 'Kabar Terbaru' }).click();
  await expect(publicPage.getByText(title)).toBeVisible();
  await expect(publicPage.getByText(marker)).toBeVisible();
  await visitor.close();
});

test("a signed-in stranger cannot post an update to someone else's Campaign", async ({ browser }) => {
  const stranger = await browser.newContext();
  const page = await stranger.newPage();
  await signInAs(page, STRANGER_EMAIL);
  const res = await page.request.post(`/api/campaigns/${KABAR_SLUG}/updates`, {
    data: { title: 'x', content: 'y' },
  });
  expect(res.status()).toBe(403);
  await stranger.close();
});
