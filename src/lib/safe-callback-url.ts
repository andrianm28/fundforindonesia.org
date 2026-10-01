const DUMMY_ORIGIN = 'http://localhost';

/**
 * Control characters, whitespace, backslash, NEL, soft hyphen, and the
 * zero-width and bidi format characters: nothing a person can see, so nothing
 * a real path holds. (`\s` covers U+00A0, U+2028/9, U+FEFF and most spaces.)
 */
const INVISIBLE_OR_UNSAFE =
  /[\u0000-\u001f\u007f\u0085\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\s\\]/;

/** Long enough for any real path here; anything longer is not a return address. */
const MAX_LENGTH = 2000;

/**
 * The address sign-in returns a person to after `?callbackUrl=`. Only a path
 * on this site is followed; anything else falls back to the homepage, so the
 * login page cannot be made an open redirect.
 *
 * A prefix check is not enough: the WHATWG URL parser strips tab, CR and LF
 * anywhere in the input, so `/\t/evil.com` starts with `/` yet resolves to
 * `http://evil.com/`. So the value is refused if it holds any control
 * character or whitespace, or does not start with a single `/`, and then
 * parsed against a fixed dummy origin: if the result is not on that origin,
 * the parser saw another host. What is returned is the parsed path, so the
 * caller gets what the browser would navigate to, not the raw string.
 */
export function safeCallbackUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LENGTH) return '/';
  if (INVISIBLE_OR_UNSAFE.test(value)) return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';

  let parsed: URL;
  try {
    parsed = new URL(value, DUMMY_ORIGIN);
  } catch {
    return '/';
  }
  if (parsed.origin !== DUMMY_ORIGIN) return '/';
  // A dot-dot segment can collapse onto a double slash ("/..//evil.com").
  if (parsed.pathname.startsWith('//')) return '/';
  return parsed.pathname + parsed.search + parsed.hash;
}
