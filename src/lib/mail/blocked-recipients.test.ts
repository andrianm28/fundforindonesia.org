import { createHash } from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import { BlockedRecipientError, assertDeliverable, blockedDomainIn } from './blocked-recipients';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const HASHES = new Set([sha('blocked.example')]);
const MESSAGE = { to: 'someone@fine.example', subject: 's', text: 't', html: '<p>t</p>' };

afterEach(() => {
  delete process.env.MAIL_BLOCKED_DOMAINS;
});

describe('blockedDomainIn', () => {
  it('passes an address on a domain nobody blocked', () => {
    expect(blockedDomainIn('a@fine.example', HASHES)).toBe(false);
  });

  it('blocks a domain whose hash is on the list, whatever its case', () => {
    expect(blockedDomainIn('A@Blocked.Example', HASHES)).toBe(true);
  });

  it('blocks every subdomain of a blocked domain', () => {
    expect(blockedDomainIn('a@mail.blocked.example', HASHES)).toBe(true);
  });

  it('does not block a domain that only ends with the same letters', () => {
    expect(blockedDomainIn('a@notblocked.example', HASHES)).toBe(false);
  });

  it('finds a blocked address inside a display name or a list', () => {
    expect(blockedDomainIn('Name <x@fine.example>, Other <y@blocked.example>', HASHES)).toBe(true);
  });

  it('blocks a Unicode domain by its punycode (ASCII) form, as the relay would send it', () => {
    const idn = new Set([sha('xn--bcher-kva.example')]);
    expect(blockedDomainIn('a@bücher.example', idn)).toBe(true);
    expect(blockedDomainIn('a@BÜCHER.example', idn)).toBe(true);
  });

  it('reads a domain with a fullwidth or ideographic dot as the same domain', () => {
    expect(blockedDomainIn('a@blocked\uFF0Eexample', HASHES)).toBe(true);
    expect(blockedDomainIn('a@blocked\u3002example', HASHES)).toBe(true);
  });

  it('normalises MAIL_BLOCKED_DOMAINS entries written with a trailing dot or a wildcard', () => {
    process.env.MAIL_BLOCKED_DOMAINS = 'one.example., *.two.example';
    expect(blockedDomainIn('a@one.example', new Set())).toBe(true);
    expect(blockedDomainIn('a@x.two.example', new Set())).toBe(true);
  });

  it('also reads plain domains from MAIL_BLOCKED_DOMAINS', () => {
    process.env.MAIL_BLOCKED_DOMAINS = ' other.example , ';
    expect(blockedDomainIn('a@sub.other.example', new Set())).toBe(true);
    expect(blockedDomainIn('a@fine.example', new Set())).toBe(false);
  });
});

describe('assertDeliverable', () => {
  it('lets a message to an unblocked domain through', () => {
    expect(() => assertDeliverable(MESSAGE, HASHES)).not.toThrow();
  });

  it('refuses a blocked recipient without naming the address', () => {
    const run = () => assertDeliverable({ ...MESSAGE, to: 'x@blocked.example' }, HASHES);
    expect(run).toThrow(BlockedRecipientError);
    expect(run).not.toThrow(/blocked\.example/);
  });

  it('refuses a blocked Reply-To too', () => {
    expect(() => assertDeliverable({ ...MESSAGE, replyTo: 'x@blocked.example' }, HASHES)).toThrow(BlockedRecipientError);
  });

  it('ships with at least one built-in blocked domain, stored only as a hash', () => {
    expect(() => assertDeliverable(MESSAGE)).not.toThrow();
  });
});
