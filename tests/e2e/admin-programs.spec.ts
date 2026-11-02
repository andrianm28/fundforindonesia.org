import { test, expect } from '@playwright/test';

/**
 * Ticket 78: the Admin Program screens and API at the real server boundary.
 * CI has no login harness (see privileged-not-found.spec.ts), so these specs
 * prove the refusal side: a caller who is not a signed-in Admin never sees the
 * Program screens or can write a Program. Create and edit behaviour is covered
 * by the route and page tests in src/app/api/admin/programs and
 * src/app/admin/programs.
 */
test.describe('Admin Program screens', () => {
  test('an anonymous caller is refused by the Program API on every method', async ({ request }) => {
    expect([401, 404]).toContain((await request.get("/api/admin/programs")).status());
    const post = await request.post('/api/admin/programs', { data: { title: 'x' } });
    expect([401, 404]).toContain(post.status());
    const patch = await request.patch('/api/admin/programs/anything', { data: { title: 'x' } });
    expect([401, 404]).toContain(patch.status());
  });

  for (const path of ['/admin/programs', '/admin/programs/baru']) {
    test(`an anonymous visitor to ${path} is sent to login, never shown the screen`, async ({ page }) => {
      await page.goto(path);

      await expect(page).toHaveURL(new RegExp(`/login\\?callbackUrl=${encodeURIComponent(path)}`));
      await expect(page.getByRole('heading', { name: 'Program baru' })).toHaveCount(0);
    });
  }
});
