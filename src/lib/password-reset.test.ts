import { describe, it, expect } from 'vitest';

/** The session password claim carried in the JWT (src/lib/auth.ts). */

import { sessionPasswordClaim } from './password-reset';

const SECRET = 'test-secret-test-secret-test-secret';

describe('sessionPasswordClaim', () => {
  const hash = '$2b$12$' + 'a'.repeat(53);

  it('is short, stable for one hash, and different for another', () => {
    const claim = sessionPasswordClaim(hash, SECRET);

    expect(claim).toMatch(/^[0-9a-f]{16}$/);
    expect(sessionPasswordClaim(hash, SECRET)).toBe(claim);
    expect(sessionPasswordClaim('$2b$12$' + 'b'.repeat(53), SECRET)).not.toBe(claim);
  });

  it('does not reveal the hash', () => {
    expect(sessionPasswordClaim(hash, SECRET)).not.toContain(hash.slice(7, 17));
  });

  it('has its own value for an account with no password', () => {
    const none = sessionPasswordClaim(null, SECRET);

    expect(none).toMatch(/^[0-9a-f]{16}$/);
    expect(none).not.toBe(sessionPasswordClaim('', SECRET));
    expect(none).not.toBe(sessionPasswordClaim(hash, SECRET));
  });
});
