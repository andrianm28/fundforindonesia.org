/**
 * The address sign-in returns a person to after `?callbackUrl=`. Only a path
 * on this site is followed; anything that could leave it (another origin, a
 * protocol-relative `//host`, a backslash that browsers read as a slash)
 * falls back to the homepage, so the login page cannot be made an open
 * redirect.
 */
export function safeCallbackUrl(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  return value;
}
