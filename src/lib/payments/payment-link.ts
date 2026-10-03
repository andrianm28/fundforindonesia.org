/**
 * The one place that decides which payment links the platform will send a
 * Volunteer to. The link comes from the provider's charge response and is
 * stored on Payment.redirectUrl; it is rendered as an <a href>, so a value
 * that is not an https link on a payment-provider host (javascript:, http,
 * a look-alike domain) must never reach a page.
 *
 * The allowlist is host names, no secrets. A host matches when it equals an
 * entry or is a subdomain of it. `PAYMENT_LINK_ALLOWED_HOSTS` (comma
 * separated) replaces the default when set, e.g. if Sumopod serves links from
 * another domain.
 */
const DEFAULT_ALLOWED_HOSTS = ['sumopod.com'];

function allowedHosts(): string[] {
  const configured = process.env.PAYMENT_LINK_ALLOWED_HOSTS?.split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return configured && configured.length > 0 ? configured : DEFAULT_ALLOWED_HOSTS;
}

/** The link as given when it is safe to offer, otherwise null. */
export function safePaymentLink(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  const host = parsed.hostname.toLowerCase();
  return allowedHosts().some((allowed) => host === allowed || host.endsWith(`.${allowed}`)) ? url : null;
}
