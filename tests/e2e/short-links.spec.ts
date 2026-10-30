import { test, expect } from '@playwright/test';
import { ACTIVE_SLUG, DRAFT_SLUG } from './fixtures';

/**
 * Short links (ticket E1/02, PRD FFI-06): the share modal's links become
 * `/s/<code>` on the apex domain, and following one lands on the Campaign
 * with the channel's Traffic Source as `?src=`, the same parameter a long
 * shared link carries into the Donation.
 */
test.describe('short links', () => {
  test('a public Campaign gets a short link per channel that redirects back with its source', async ({ request }) => {
    const made = await request.post(`/api/campaigns/${ACTIVE_SLUG}/short-links`);
    expect(made.status()).toBe(200);
    const { links } = (await made.json()) as { links: Record<string, string> };
    expect(Object.keys(links).sort()).toEqual(['copy', 'facebook', 'twitter', 'whatsapp']);

    // Stable: asking again hands out the same codes.
    const again = (await (await request.post(`/api/campaigns/${ACTIVE_SLUG}/short-links`)).json()) as {
      links: Record<string, string>;
    };
    expect(again.links).toEqual(links);

    const path = new URL(links.whatsapp).pathname;
    expect(path).toMatch(/^\/s\/[A-Za-z2-9]{8}$/);
    const followed = await request.get(path, { maxRedirects: 0 });
    expect(followed.status()).toBe(302);
    expect(followed.headers()['location']).toMatch(new RegExp(`/campaign/${ACTIVE_SLUG}\\?src=whatsapp$`));
  });

  test('a Draft gets no short link', async ({ request }) => {
    expect((await request.post(`/api/campaigns/${DRAFT_SLUG}/short-links`)).status()).toBe(404);
  });

  test('an unknown code is a real 404', async ({ request }) => {
    const response = await request.get('/s/abcdefgh', { maxRedirects: 0 });
    expect(response.status()).toBe(404);
    expect(await response.text()).toContain('Tautan tidak ditemukan');
  });
});
