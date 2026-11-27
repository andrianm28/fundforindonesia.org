import { createHash } from 'node:crypto';
import { domainToASCII } from 'node:url';
import type { MailMessage } from './types';

/**
 * Domains the platform must never send email to, whatever the database or a
 * caller says. Stored as SHA-256 hashes of the lowercase domain so the names
 * themselves never appear in this public repository (owner rule, 2026-11-27).
 * A domain blocks all of its subdomains too.
 *
 * To add one: `printf %s example.com | sha256sum` and append the hex here,
 * or list it in plain text in MAIL_BLOCKED_DOMAINS on the host.
 */
const BUILT_IN_BLOCKED_DOMAIN_HASHES: ReadonlySet<string> = new Set([
  '91aee4f93832e8f1447794d379421e565a97b50814cd667e904cf6810e436ca5',
]);

/** Raised when a message would reach a blocked domain; the address is never in the text. */
export class BlockedRecipientError extends Error {
  constructor() {
    super('The recipient is on a blocked domain; the message was not sent.');
    this.name = 'BlockedRecipientError';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * The ASCII (punycode) form the relay sends, lowercase, without a trailing
 * dot. Fullwidth and ideographic dots count as dots, as they do in IDNA.
 * Returns '' for something that is not a domain.
 */
function normaliseDomain(raw: string): string {
  const dotted = raw.trim().replace(/[\u3002\uFF0E\uFF61]/g, '.').replace(/\.+$/, '');
  return domainToASCII(dotted).toLowerCase();
}

function envBlockedDomains(): string[] {
  return (process.env.MAIL_BLOCKED_DOMAINS ?? '')
    .split(',')
    .map((d) => normaliseDomain(d.trim().replace(/^@/, '').replace(/^\*\./, '')))
    .filter(Boolean);
}

/** The domain and each parent of it with at least two labels: a.b.c -> a.b.c, b.c. */
function domainAndParents(domain: string): string[] {
  const labels = domain.split('.');
  const out: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) out.push(labels.slice(i).join('.'));
  return out;
}

/** Whether any address in `field` (one address, a display name, or a list) is on a blocked domain. */
export function blockedDomainIn(
  field: string,
  hashes: ReadonlySet<string> = BUILT_IN_BLOCKED_DOMAIN_HASHES,
): boolean {
  const plain = new Set(envBlockedDomains());
  // Everything after an @ up to a separator, so a Unicode domain is read whole.
  const domains = [...field.matchAll(/@([^\s<>,;"'()\[\]]+)/g)].map((m) => normaliseDomain(m[1]));
  return domains.some((domain) => domainAndParents(domain).some((d) => plain.has(d) || hashes.has(sha256(d))));
}

/** Throws BlockedRecipientError when To or Reply-To reaches a blocked domain. */
export function assertDeliverable(
  message: Pick<MailMessage, 'to' | 'replyTo'>,
  hashes: ReadonlySet<string> = BUILT_IN_BLOCKED_DOMAIN_HASHES,
): void {
  if (blockedDomainIn(message.to, hashes) || (message.replyTo && blockedDomainIn(message.replyTo, hashes))) {
    throw new BlockedRecipientError();
  }
}
