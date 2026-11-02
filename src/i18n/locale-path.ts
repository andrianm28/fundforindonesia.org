import { PATHNAME_MAP } from './pathnames';
import { routing, type Locale } from './routing';
import { isLocalizedPath } from './scope';

const NON_DEFAULT = routing.locales.filter((l) => l !== routing.defaultLocale);
const PREFIX = new RegExp(`^/(${NON_DEFAULT.join('|')})(?=/|$)`);

/** The locale a browser pathname is in: the prefix says so, otherwise the default. */
export function localeOfPath(pathname: string): Locale {
  const m = PREFIX.exec(pathname);
  return (m ? m[1] : routing.defaultLocale) as Locale;
}

/** `/en/login` -> `/login`, `/en` -> `/`; anything else is returned as is. */
export function stripLocalePrefix(pathname: string): string {
  return pathname.replace(PREFIX, '') || '/';
}

const PARAM = /\[([^\]]+)\]/g;

// Static rows first, so /campaign/create wins over /campaign/[slug].
const ROWS = [...PATHNAME_MAP]
  .map((row) => ({ row, params: (row.internal.match(PARAM) ?? []).length }))
  .sort((a, b) => a.params - b.params)
  .map((r) => r.row);

function matcher(template: string): RegExp {
  const source = template
    .split(PARAM)
    .map((part, i) => (i % 2 === 1 ? '([^/]+)' : part.replace(/[.*+?^${}()|\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${source}$`);
}

/**
 * The URL of the page the visitor is on, in `target` (ADR 0024 section 2, the
 * pathnames map): `/wakaf` -> `/en/waqf`. `pathname` is the browser pathname,
 * prefix included. No query string. Null when the page has no counterpart:
 * the back-office, or a path outside the map.
 */
export function pairedLocalePath(pathname: string, target: Locale): string | null {
  const from = localeOfPath(pathname);
  const bare = stripLocalePrefix(pathname);
  if (!isLocalizedPath(pathname)) return null;
  for (const row of ROWS) {
    const m = matcher(row[from]).exec(bare);
    if (!m) continue;
    const names = [...row.internal.matchAll(PARAM)].map((p) => p[1]);
    const values = Object.fromEntries(names.map((n, i) => [n, m[i + 1]]));
    const path = row[target].replace(PARAM, (_, n: string) => values[n]);
    return target === routing.defaultLocale ? path : `/${target}${path === '/' ? '' : path}`;
  }
  return null;
}
