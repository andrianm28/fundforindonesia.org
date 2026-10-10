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
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/layout/ConditionalFooter', () => ({ ConditionalFooter: () => null }));

import { connection } from 'next/server';
import RootLayout, { metadata } from './layout';
import { useBetaSandbox } from '@/components/layout/BetaSandboxContext';

afterEach(() => {
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
