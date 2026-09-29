import { describe, it, expect } from 'vitest';
import { safeCallbackUrl } from './safe-callback-url';

/** Where sign-in may send a person back to: this site's own paths, never another origin. */
describe('safeCallbackUrl', () => {
  it.each([
    '/volunteer-trip/mengajar?x=1',
    '/volunteer-trip/x?a=1#b',
    '/volunteer-trip/x%20y?a=1#b',
    '/campaign/create',
    '/',
  ])('keeps the path on this site unchanged: %s', (value) => {
    expect(safeCallbackUrl(value)).toBe(value);
  });

  it.each([
    ['a tab in the second slot', '/\t/evil.com'],
    ['a newline in the second slot', '/\n/evil.com'],
    ['a carriage return in the second slot', '/\r/evil.com'],
    ['leading whitespace', ' /volunteer-trip'],
    ['trailing whitespace', '/volunteer-trip '],
    ['an interior space', '/volunteer trip'],
    ['a NEL (U+0085)', '/\u0085/evil.com'],
    ['a zero-width space (U+200B)', '/​/evil.com'],
    ['a right-to-left override (U+202E)', '/‮/evil.com'],
    ['a soft hyphen (U+00AD)', '/­/evil.com'],
    ['a byte order mark (U+FEFF)', '/﻿/evil.com'],
    ['a word joiner (U+2060)', '/⁠/evil.com'],
    ['a bidi isolate (U+2066)', '/⁦/evil.com'],
    ['three slashes', '///evil.com'],
    ['a dot segment into a double slash', '/.//evil.com'],
    ['a NUL', '/a\u0000b'],
    ['a DEL', '/a\u007fb'],
    ['a protocol-relative URL', '//evil.com'],
    ['a backslash', '/\\evil.com'],
    ['another origin', 'https://evil.com'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a dot-dot path into a double slash', '/..//evil.com'],
    ['a bare word', 'volunteer-trip'],
    ['an empty string', ''],
  ])('falls back to the homepage for %s', (_label, value) => {
    expect(safeCallbackUrl(value)).toBe('/');
  });

  it('keeps a still-encoded %2F%2F as an inert same-site path: the browser never decodes it into a host', () => {
    expect(safeCallbackUrl('/%2F%2Fevil.com')).toBe('/%2F%2Fevil.com');
    expect(new URL('/%2F%2Fevil.com', 'http://localhost').origin).toBe('http://localhost');
  });

  it('falls back to the homepage for an encoded protocol-relative URL once URLSearchParams decodes it', () => {
    const decoded = new URLSearchParams('callbackUrl=%2F%2Fevil.com').get('callbackUrl');
    expect(decoded).toBe('//evil.com');
    expect(safeCallbackUrl(decoded)).toBe('/');
  });

  it.each(['%09', '%0a', '%0d'])('falls back for the control character %s once decoded', (encoded) => {
    const decoded = new URLSearchParams(`callbackUrl=/${encoded}/evil.com`).get('callbackUrl');
    expect(safeCallbackUrl(decoded)).toBe('/');
  });

  it('falls back for a very long value', () => {
    expect(safeCallbackUrl('/' + 'a'.repeat(5000))).toBe('/');
  });

  it.each([null, undefined, 42, {}] as unknown[])('falls back for non-string input %s', (value) => {
    expect(safeCallbackUrl(value as never)).toBe('/');
  });
});
