import { test, expect } from '@playwright/test';
import { CATEGORY_SLUG } from './fixtures';

/**
 * rilis-1-benda/96: a Category that does not exist answers HTTP 404 under
 * /explore, not a 200 carrying the "not found" page. The page's own
 * notFound() runs behind the root loading.tsx, after the document has begun
 * streaming as 200, so the proxy decides the status (src/proxy.ts). Unit
 * tests read the status off the proxy's returned object; this proves the
 * production server actually sends it.
 */
test.describe('/explore/<category> answers 404 for a Category that does not exist', () => {
  for (const slug of ['kategori-ngawur-xyz', 'zakat']) {
    test(`/explore/${slug} is HTTP 404 and shows the not-found page`, async ({ request }) => {
      const res = await request.get(`/explore/${slug}`);
      expect(res.status()).toBe(404);
      expect(await res.text()).toContain('This page could not be found');
    });
  }

  test('a Category that exists stays HTTP 200', async ({ request }) => {
    const res = await request.get(`/explore/${CATEGORY_SLUG}`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('E2E Bencana');
  });

  test('/explore/all stays HTTP 200', async ({ request }) => {
    expect((await request.get('/explore/all')).status()).toBe(200);
  });
});
