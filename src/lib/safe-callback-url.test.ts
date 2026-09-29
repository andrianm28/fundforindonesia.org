import { describe, it, expect } from 'vitest';
import { safeCallbackUrl } from './safe-callback-url';

/** Where sign-in may send a person back to: this site's own paths, never another origin. */
describe('safeCallbackUrl', () => {
  it('keeps a path on this site, query and all', () => {
    expect(safeCallbackUrl('/volunteer-trip/mengajar?x=1')).toBe('/volunteer-trip/mengajar?x=1');
  });

  it.each([
    ['nothing', null],
    ['empty', ''],
    ['another origin', 'https://evil.example/phish'],
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash trick', '/\\evil.example'],
    ['a bare word', 'volunteer-trip'],
  ])('falls back to the homepage for %s', (_label, value) => {
    expect(safeCallbackUrl(value)).toBe('/');
  });
});
