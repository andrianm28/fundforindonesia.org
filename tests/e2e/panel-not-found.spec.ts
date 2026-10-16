import { test, expect, type APIRequestContext } from '@playwright/test';
import { encode } from 'next-auth/jwt';

/**
 * Ticket 90 (owner decision 2026-10-14, "yang lain 404"): a signed-in user
 * without the assignment gets the same literal HTTP 404 from the Admin and
 * Moderasi panels as from a page that does not exist, never a redirect home.
 *
 * Unit tests can only read the status off the proxy's returned object; this
 * proves the production server actually sends it. The layouts' own
 * notFound() cannot set the status (it runs behind the root loading.tsx), so
 * the proxy is what answers here.
 *
 * A client-side navigation is different: its RSC request (`?_rsc=`) comes
 * back 200 carrying the not-found payload, because Next does not keep a
 * rewrite's status for it and strips the RSC header before the proxy sees it.
 * The router then loads the page as a document, which is the 404 above. The
 * last test pins that the user still lands on the 404 page.
 *
 * CI has no login harness, so the session is a JWT minted with the e2e job's
 * NEXTAUTH_SECRET: the proxy reads only the token, which is exactly the part
 * under test.
 */
const SECRET = process.env.NEXTAUTH_SECRET ?? 'ci-placeholder-not-a-secret';

type Assignment = 'ADMIN' | 'VERIFIER';

async function sessionCookie(assignments: Assignment[]) {
  const token = await encode({
    token: { sub: 'e2e-panel-probe', email: 'e2e-panel-probe@example.org', assignments },
    secret: SECRET,
  });
  return `next-auth.session-token=${token}`;
}

async function get(request: APIRequestContext, path: string, cookie: string) {
  return request.get(path, { headers: { cookie }, maxRedirects: 0 });
}

test.describe('the Admin and Moderasi panels answer 404 to anyone without the assignment', () => {
  const cases: { who: string; assignments: Assignment[]; paths: string[] }[] = [
    { who: 'a signed-in user with no assignment', assignments: [], paths: ['/admin', '/admin/users', '/moderasi', '/moderasi/campaigns'] },
    { who: 'a Verifier', assignments: ['VERIFIER'], paths: ['/admin', '/admin/payouts'] },
    { who: 'an Admin who is not a Verifier', assignments: ['ADMIN'], paths: ['/moderasi', '/moderasi/partner-organisations'] },
  ];

  for (const { who, assignments, paths } of cases) {
    for (const path of paths) {
      test(`${who} gets HTTP 404 from ${path}, not a redirect`, async ({ request }) => {
        const res = await get(request, path, await sessionCookie(assignments));
        expect(res.status()).toBe(404);
        expect(res.headers()['location']).toBeUndefined();
      });
    }
  }

  test('the 404 looks the same as a page that does not exist', async ({ request }) => {
    const cookie = await sessionCookie([]);
    const hidden = await get(request, '/admin', cookie);
    const missing = await get(request, '/halaman-yang-tidak-ada', cookie);
    expect(missing.status()).toBe(404);
    const title = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];
    expect(title(await hidden.text())).toBe(title(await missing.text()));
  });

  test('a client-side navigation to /admin still lands on the 404 page', async ({ page, context }) => {
    const value = (await sessionCookie([])).split('=').slice(1).join('=');
    await context.addCookies([{ name: 'next-auth.session-token', value, url: 'http://localhost:3000' }]);
    await page.goto('/faq');

    const documentLoad = page.waitForResponse(
      (res) => new URL(res.url()).pathname === '/admin' && res.request().resourceType() === 'document',
    );
    await page.evaluate(() => (window as unknown as { next: { router: { push(href: string): void } } }).next.router.push('/admin'));

    expect((await documentLoad).status()).toBe(404);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText('This page could not be found.')).toBeVisible();
  });

  test('a signed-out visitor is still sent to log in', async ({ request }) => {
    const res = await request.get('/admin', { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toContain('/login');
  });
});
