import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '@/proxy';

// English is served by the same pages as Indonesian (the proxy turns /en/<path>
// into <path> and tags the locale), so nothing in the app tree may match /en
// by itself: the only thing that opens it is I18N_ENGLISH_ENABLED in the proxy.
describe('/en is opened only by the proxy gate', () => {
  const top = readdirSync(join(process.cwd(), 'src/app'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  it('has no route segment that can match /en', () => {
    expect(top).not.toContain('en');
    expect(top.filter((n) => /^\[.*\]$/.test(n))).toEqual([]);
  });

  it('lists /en in the proxy matcher, which is where the gate lives', () => {
    expect(config.matcher).toEqual(expect.arrayContaining(['/en', '/en/:path*']));
  });
});
