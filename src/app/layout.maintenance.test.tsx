// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Mode pemeliharaan on the public pages (PKS ticket 01): while it is on, the
 * root layout shows a banner with the Admin's message on every page.
 */

vi.mock('next/font/local', () => ({ default: () => ({ variable: 'font-stub' }) }));
vi.mock('next/server', () => ({ connection: vi.fn(async () => undefined) }));
vi.mock('@/components/layout/Providers', () => ({
  Providers: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/layout/ConditionalFooter', () => ({ ConditionalFooter: () => null }));

const holder = vi.hoisted(() => ({ row: null as { key: string; value: unknown } | null, fail: false }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    siteSetting: {
      findMany: async () => [],
      findUnique: async () => {
        if (holder.fail) throw new Error('db down');
        return holder.row;
      },
    },
  },
}));

import RootLayout from './layout';

async function render(): Promise<string> {
  return renderToStaticMarkup(await RootLayout({ children: <p>isi halaman</p> }));
}

function stored(on: boolean, message: string) {
  holder.row = { key: 'operations', value: { donationsOpen: true, maintenance: { on, message }, history: [] } };
}

beforeEach(() => {
  holder.row = null;
  holder.fail = false;
});

describe('RootLayout maintenance banner', () => {
  it('shows the Admin\'s message on every page while maintenance is on, and still the page', async () => {
    stored(true, 'Kembali pukul 10.00 WIB.');

    const html = await render();

    expect(html).toContain('Kembali pukul 10.00 WIB.');
    expect(html).toContain('role="status"');
    expect(html).toContain('isi halaman');
  });

  it('falls back to the default wording when the Admin wrote no message', async () => {
    stored(true, '');
    expect(await render()).toContain('sedang dalam pemeliharaan');
  });

  it('shows nothing while maintenance is off, never set, or unreadable', async () => {
    stored(false, 'Pesan lama.');
    expect(await render()).not.toContain('Pesan lama.');
    holder.row = null;
    expect(await render()).not.toContain('pemeliharaan');
    holder.fail = true;
    expect(await render()).not.toContain('pemeliharaan');
  });
});
