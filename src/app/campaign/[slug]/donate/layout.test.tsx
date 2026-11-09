// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * The donate page while an Admin has switched donations off (PKS ticket 01):
 * the donor sees the closed message at once, not after filling in an amount.
 * The page itself is a client component, so the server layout decides.
 */

const holder = vi.hoisted(() => ({ row: null as { key: string; value: unknown } | null }));
vi.mock('@/lib/prisma', () => ({
  prisma: { siteSetting: { findUnique: async () => holder.row } },
}));

import DonateLayout from './layout';
import { DONATIONS_DISABLED_MESSAGE } from '@/lib/donations';

async function render(): Promise<string> {
  return renderToStaticMarkup(
    await DonateLayout({ children: <p>formulir donasi</p>, params: Promise.resolve({ slug: 'banjir-demak' }) }),
  );
}

beforeEach(() => {
  holder.row = null;
});

describe('donate layout', () => {
  it('shows the closed message, with a way back to the Campaign, and no form, while donations are switched off', async () => {
    holder.row = {
      key: 'operations',
      value: { donationsOpen: false, maintenance: { on: false, message: '' }, history: [] },
    };

    const html = await render();

    expect(html).toContain(DONATIONS_DISABLED_MESSAGE);
    expect(html).toContain('href="/campaign/banjir-demak"');
    expect(html).not.toContain('formulir donasi');
  });

  it('shows the form while donations are open or the switch was never set', async () => {
    expect(await render()).toContain('formulir donasi');
    holder.row = {
      key: 'operations',
      value: { donationsOpen: true, maintenance: { on: false, message: '' }, history: [] },
    };
    expect(await render()).toContain('formulir donasi');
  });
});
