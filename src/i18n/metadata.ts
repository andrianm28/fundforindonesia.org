import { publicUrl } from '@/lib/public-url';
import { getPathname } from './navigation';
import { routing, type Locale } from './routing';

type Href = string | { pathname: string; params?: Record<string, string> };

/** Absolute URL of `href` in `locale`; the home page has no trailing slash in English. */
function absolute(href: Href, locale: Locale): string {
  // The map is keyed by folder path, so any href here is a known internal path.
  const path = getPathname({ href: href as never, locale });
  return publicUrl(path);
}

/**
 * Canonical plus hreflang for `generateMetadata` (ADR 0024 section 4): the
 * page names itself in its own language and pairs id, en and x-default (the
 * Indonesian URL). Query strings are never part of it.
 */
export function alternatesFor(href: Href, locale: Locale) {
  const languages: Record<string, string> = {};
  for (const l of routing.locales) languages[l] = absolute(href, l);
  languages['x-default'] = languages[routing.defaultLocale];
  return { canonical: absolute(href, locale), languages };
}
