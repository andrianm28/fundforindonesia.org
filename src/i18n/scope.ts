/**
 * Which paths the language middleware may handle (ADR 0024 section 2): pages
 * only. The back-office is Indonesian and outside i18n (also under /en), and
 * API routes, Next internals, uploads and root files are not pages. Once the
 * proxy composes the language middleware it dispatches on this.
 */
const EXCLUDED = /^(?:\/en)?\/(?:admin|moderasi)(?:\/|$)|^\/(?:api|_next|uploads)(?:\/|$)|^\/[^/]+\.[^/]+$/;

export function isLocalizedPath(pathname: string): boolean {
  return !EXCLUDED.test(pathname);
}
