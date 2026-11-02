// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * The root layout announces the public beta on every page (ticket
 * rilis-1-benda/92). The environment is read on the server, per request, and
 * handed to the tree; the site stays indexable, so no robots entry exists.
 *
 * Fonts, the session provider, the shell and the footer are stand-ins: what is
 * under test is the banner and what is handed to client components.
 */

vi.mock('next/font/local', () => ({ default: () => ({ variable: 'font-stub' }) }));
vi.mock('next/server', () => ({ connection: vi.fn(async () => undefined) }));
vi.mock('@/components/layout/Providers', () => ({
  Providers: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children, showLanguageSwitcher }: { children: React.ReactNode; showLanguageSwitcher?: boolean }) => (
    <main data-switcher={String(showLanguageSwitcher)}>{children}</main>
  ),
}));
vi.mock('@/components/layout/ConditionalFooter', () => ({
  ConditionalFooter: ({ showLanguageSwitcher }: { showLanguageSwitcher?: boolean }) => (
    <footer data-switcher={String(showLanguageSwitcher)} />
  ),
}));
// The language of the request, as src/i18n/request.ts resolves it.
const language = vi.hoisted(() => ({ locale: 'id' }));
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => language.locale),
  getMessages: vi.fn(async () => ({ Nav: { marker: 'nav' }, Common: {}, Home: { big: 'tidak dikirim ke klien' } })),
}));

import { connection } from 'next/server';
import RootLayout, { metadata } from './layout';
import { useBetaSandbox } from '@/components/layout/BetaSandboxContext';

afterEach(() => {
  language.locale = 'id';
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

async function render(child: React.ReactNode = <p>isi halaman</p>): Promise<string> {
  return renderToStaticMarkup(await RootLayout({ children: child }));
}

describe('RootLayout beta banner', () => {
  it('shows the banner on every page while BETA_SANDBOX is exactly true', async () => {
    vi.stubEnv('BETA_SANDBOX', 'true');

    const html = await render();

    expect(html).toContain('Beta, tidak ada uang nyata.');
    expect(html).toContain('isi halaman');
  });

  it('shows no banner without the marker, or with a near miss', async () => {
    for (const value of [undefined, '', 'TRUE', '1', 'true ']) {
      if (value === undefined) vi.stubEnv('BETA_SANDBOX', '');
      else vi.stubEnv('BETA_SANDBOX', value);
      expect(await render(), JSON.stringify(value)).not.toContain('tidak ada uang nyata');
    }
  });

  it('is rendered per request, so the answer is not baked in at build time', async () => {
    await render();

    expect(connection).toHaveBeenCalled();
  });

  it('hands the flag to client components through context rather than the environment', async () => {
    function Probe() {
      return <span data-beta={String(useBetaSandbox())} />;
    }

    vi.stubEnv('BETA_SANDBOX', 'true');
    expect(await render(<Probe />)).toContain('data-beta="true"');

    vi.stubEnv('BETA_SANDBOX', '');
    expect(await render(<Probe />)).toContain('data-beta="false"');
  });

  it('keeps the site indexable: the beta adds no robots directive', () => {
    expect(metadata.robots).toBeUndefined();
  });
});

describe('RootLayout language', () => {
  it('declares Indonesian, as it always has, for every page that is not English', async () => {
    expect(await render()).toMatch(/^<html lang="id"/);
  });

  it('declares English on the English pages', async () => {
    language.locale = 'en';
    expect(await render()).toMatch(/^<html lang="en"/);
  });
});

describe('RootLayout language switcher (English gate)', () => {
  it('is off while I18N_ENGLISH_ENABLED is anything but exactly true', async () => {
    for (const value of [undefined, '', 'TRUE', '1', 'true ']) {
      vi.stubEnv('I18N_ENGLISH_ENABLED', value ?? '');
      const html = await render();
      expect(html, JSON.stringify(value)).not.toContain('data-switcher="true"');
      expect(html).toContain('data-switcher="false"');
    }
  });

  it('is handed to the shell and the footer when English is on', async () => {
    vi.stubEnv('I18N_ENGLISH_ENABLED', 'true');
    const html = await render();
    expect(html.match(/data-switcher="true"/g)).toHaveLength(2);
  });
});

describe('RootLayout catalogue for client components', () => {
  it('provides the Nav and Common namespaces to the client tree', async () => {
    const tree = (await RootLayout({ children: null })) as React.ReactElement<{ children: React.ReactElement }>;
    const provider = JSON.stringify(tree, (_k, v) => (typeof v === 'function' ? undefined : v));
    expect(provider).toContain('"marker":"nav"');
    expect(provider).not.toContain('tidak dikirim ke klien');
  });
});
