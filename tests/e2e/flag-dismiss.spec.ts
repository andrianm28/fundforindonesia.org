import { test, expect, type Locator, type Page } from '@playwright/test';
import { ACTIVE_CAMPAIGN_ID, ACTIVE_SLUG, ADMIN_EMAIL, OPERATOR_PASSWORD, VERIFIER_EMAIL } from './fixtures';

/**
 * rilis-1-benda 66: a Flag, then its dismissal, through the two screens that
 * were missing -- the Verifier's form on a Campaign's moderation screen, and
 * the Admin's list of open Flags on its lifecycle screen. Everything here is
 * real: the browser, the production bundle, the session, the lifecycle
 * module and the seeded Postgres. Nothing is stubbed at the network edge,
 * because the point is the wiring no unit test crosses: form -> route ->
 * flagCampaign / dismissFlag -> the rows the next screen reads back.
 *
 * The seed (seed-e2e.ts) gives a Verifier and an Admin who own nothing, so
 * neither is barred from the Active fixture Campaign. There is no
 * passwordless session fixture; both sign in through NextAuth's own
 * credentials endpoint, the one the login page calls.
 *
 * One Campaign is shared by the three viewport projects, and a retry runs
 * against the rows a failed attempt left, so each attempt writes reasons of
 * its own and finds its own Flag by them.
 */

/**
 * Signs the page's browser context in, the way the login page does, without
 * its form. Logins are rate limited per account (10 per 15 minutes,
 * src/lib/auth.ts), and each project signs each operator in once, so a CI run
 * with its two retries stays under it: do not add sign-ins to this spec
 * without counting them.
 */
async function signInAs(page: Page, email: string) {
  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  const signedIn = await page.request.post('/api/auth/callback/credentials', {
    form: { csrfToken, email, password: OPERATOR_PASSWORD, json: 'true' },
  });
  expect(signedIn.ok()).toBe(true);
  // The session is what proves it worked, not the status alone.
  const session = await (await page.request.get('/api/auth/session')).json();
  expect(session.user?.email).toBe(email);
}

/**
 * Types a reason into its field and submits, and answers with the status the
 * server gave. Fill and click are one retried step because what is on the
 * page can be replaced after it first appears: the server-rendered form is
 * there before React is, so text typed too early never reaches state and the
 * button stays disabled; and the app shell has been seen to mount a page's
 * content a second time some 200 ms after a navigation (PageTransition.tsx
 * keys it by pathname), which empties a form typed into in between. A click
 * that finds the button disabled or gone fails fast and the whole step runs
 * again on the form that is there then. The response is awaited rather than
 * the screen read, since a form replaced after it answered would lose its
 * confirmation too.
 */
async function submitReason(
  page: Page,
  { field, button, text, endpoint }: { field: Locator; button: Locator; text: string; endpoint: RegExp },
): Promise<number> {
  const answered = page.waitForResponse(
    (response) => response.request().method() === 'POST' && endpoint.test(new URL(response.url()).pathname),
  );
  await expect(async () => {
    await field.fill(text);
    await button.click({ timeout: 1000 });
  }).toPass();
  return (await answered).status();
}

test.describe('Flag, then dismiss', () => {
  test('a Verifier flags an Active Campaign and an Admin dismisses the Flag', async ({ page }, testInfo) => {
    const attempt = `${testInfo.project.name} ${Date.now()}`;
    const flagReason = `Foto sampul dipakai ulang dari Campaign lain (${attempt}).`;
    const dismissalReason = `Sudah diperiksa, tidak ada pelanggaran (${attempt}).`;

    // The Verifier raises the Flag from the Campaign's moderation screen.
    await signInAs(page, VERIFIER_EMAIL);
    await page.goto(`/moderasi/campaigns/${ACTIVE_CAMPAIGN_ID}`);
    await expect(page.getByRole('heading', { name: 'E2E Air Bersih Desa' })).toBeVisible();

    const flagged = await submitReason(page, {
      field: page.getByLabel('Alasan Flag'),
      button: page.getByRole('button', { name: 'Pasang Flag' }),
      text: flagReason,
      endpoint: new RegExp(`^/api/campaigns/${ACTIVE_SLUG}/flags$`),
    });
    expect(flagged).toBe(201);

    // The Admin finds the Campaign among those awaiting a Suspension
    // decision, and sees the Flag with who raised it.
    await page.context().clearCookies();
    await signInAs(page, ADMIN_EMAIL);
    await page.goto('/admin/campaigns/lifecycle');
    await page
      .getByRole('row')
      .filter({ hasText: 'E2E Air Bersih Desa' })
      .getByRole('link', { name: 'Tinjau' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/admin/campaigns/lifecycle/${ACTIVE_SLUG}$`));

    const flag = page.getByRole('listitem').filter({ hasText: flagReason });
    await expect(flag).toBeVisible();
    await expect(flag).toContainText('E2E Verifier');

    // Dismissing it with a reason closes it.
    const dismissed = await submitReason(page, {
      field: flag.getByLabel('Alasan penolakan Flag'),
      button: flag.getByRole('button', { name: 'Tolak Flag' }),
      text: dismissalReason,
      endpoint: new RegExp(`^/api/campaigns/${ACTIVE_SLUG}/flags/[^/]+/dismiss$`),
    });
    expect(dismissed).toBe(200);
    await expect(page.getByText(flagReason)).toHaveCount(0);

    // And it stays closed on a fresh read of the page: it was written, not
    // merely hidden.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'E2E Air Bersih Desa' })).toBeVisible();
    await expect(page.getByText(flagReason)).toHaveCount(0);
  });
});
