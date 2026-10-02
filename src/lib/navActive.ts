/**
 * Shared nav helpers for the Admin and Moderasi shells. Pure (no server or
 * client imports), so both shells can use them.
 */

/** Most specific nav href that matches the pathname, or null. */
export function activeHref(pathname: string | null, hrefs: readonly string[]): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  for (const href of hrefs) {
    const hit = pathname === href || pathname.startsWith(`${href}/`);
    if (hit && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

/** Same hover and active treatment in both shells; brand tokens only. */
export const NAV_IDLE = "text-text hover:bg-primary/10 hover:text-primary";
export const NAV_ACTIVE = "bg-primary/10 font-semibold text-primary";
