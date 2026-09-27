/**
 * Traffic Source (ticket 24, "Traffic Source on Donation", CONTEXT.md
 * concepts it builds on: Campaign, Donation): the `src` a shared link
 * carries, recorded on the Donation it produced so a Fundraiser can see
 * which shared link actually produced Donations.
 *
 * The value comes from a URL query parameter -- a visitor can put anything
 * there, so it is untrusted input from the moment it is read, on the
 * campaign page and again at the API. This is the single place that turns
 * that raw value into what is safe to store and, later, to show back to a
 * Fundraiser: never a validation that can fail the request, only one that
 * degrades toward null. "Absent or malformed parameters never block a
 * Donation" (ticket 24) means this never throws.
 */

/** Long enough for a channel name plus a short campaign tag, short enough that no one URL can spend the whole column. */
export const TRAFFIC_SOURCE_MAX_LENGTH = 40;

/** Letters, digits, dash and underscore only -- never reflected unescaped because nothing else can ever be in it. */
const SAFE_CHARACTERS = /[^a-zA-Z0-9_-]/g;

/**
 * Untrusted input in, a value safe to store and display, or null, out.
 * Never throws and never signals "invalid": absent, wrong-typed, empty, or
 * entirely unsafe input all collapse to null the same way a Donation with no
 * traffic source at all does.
 */
export function sanitizeTrafficSource(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  const stripped = raw.trim().replace(SAFE_CHARACTERS, '');
  if (stripped.length === 0) return null;

  return stripped.slice(0, TRAFFIC_SOURCE_MAX_LENGTH);
}
