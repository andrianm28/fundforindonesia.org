import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '@/proxy';

// Until the page PRs land, /en/* must answer 404 (no half-translated pages).
// Nothing routes it: the app tree has no `en` folder, no [locale] segment and
// no root catch-all, and the proxy does not rewrite /en to anything.
describe('/en stays unserved until the page PRs land', () => {
  const top = readdirSync(join(process.cwd(), 'src/app'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  it('has no route segment that can match /en', () => {
    expect(top).not.toContain('en');
    expect(top.filter((n) => /^\[.*\]$/.test(n))).toEqual([]);
  });

  it('does not put /en in the proxy matcher', () => {
    expect(config.matcher.some((m) => m === '/en' || m.startsWith('/en/'))).toBe(false);
  });
});
