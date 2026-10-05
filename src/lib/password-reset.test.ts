import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

/**
 * The Password Reset token (rilis-1 93). It is stateless: nothing is stored,
 * so the token must carry its own proof. It binds the account, an expiry and a
 * fingerprint of the account's CURRENT password hash and email lookup, which is
 * what makes it single-use (a password change moves the fingerprint) and
 * ties it to the address it was mailed to.
 */

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }));

import {
  PASSWORD_RESET_TTL_SECONDS,
  checkPasswordResetToken,
  readPasswordResetToken,
  sessionPasswordClaim,
  signPasswordResetToken,
  verifyPasswordResetToken,
  type ResetSubject,
} from './password-reset';
import { prisma } from '@/lib/prisma';

const findUser = prisma.user.findUnique as unknown as Mock;

const SECRET = 'test-secret-test-secret-test-secret';
const NOW = Date.UTC(2026, 9, 5, 10, 0, 0);

const subject: ResetSubject = { id: 'user-1', password: '$2b$12$' + 'a'.repeat(53), emailHmac: 'h'.repeat(64) };

beforeEach(() => {
  vi.resetAllMocks();
});

describe('signPasswordResetToken / checkPasswordResetToken', () => {
  it('accepts a fresh token for the account it was issued to', () => {
    const token = signPasswordResetToken(subject, NOW, SECRET);

    expect(checkPasswordResetToken(token, subject, NOW + 1000, SECRET)).toBe(true);
  });

  it('is a two-part base64url string that does not contain the password hash', () => {
    const token = signPasswordResetToken(subject, NOW, SECRET);

    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(token).not.toContain(subject.password!);
  });

  it('expires after 60 minutes, and not a second earlier', () => {
    const token = signPasswordResetToken(subject, NOW, SECRET);
    const ttlMs = PASSWORD_RESET_TTL_SECONDS * 1000;

    expect(PASSWORD_RESET_TTL_SECONDS).toBe(3600);
    expect(checkPasswordResetToken(token, subject, NOW + ttlMs - 1000, SECRET)).toBe(true);
    expect(checkPasswordResetToken(token, subject, NOW + ttlMs, SECRET)).toBe(false);
    expect(checkPasswordResetToken(token, subject, NOW + ttlMs + 1, SECRET)).toBe(false);
  });

  it('rejects a token whose signature was changed', () => {
    const [payload, sig] = signPasswordResetToken(subject, NOW, SECRET).split('.');
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);

    expect(checkPasswordResetToken(`${payload}.${flipped}`, subject, NOW, SECRET)).toBe(false);
  });

  it('rejects a token whose payload was changed to another account or a later expiry', () => {
    const [payload, sig] = signPasswordResetToken(subject, NOW, SECRET).split('.');
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    const [expiresAt, userId] = [decoded.split(':')[0], decoded.slice(decoded.indexOf(':') + 1)];

    const otherUser = Buffer.from(`${expiresAt}:user-2`).toString('base64url');
    const later = Buffer.from(`${Number(expiresAt) + 86400}:${userId}`).toString('base64url');

    expect(checkPasswordResetToken(`${otherUser}.${sig}`, { ...subject, id: 'user-2' }, NOW, SECRET)).toBe(false);
    expect(checkPasswordResetToken(`${later}.${sig}`, subject, NOW, SECRET)).toBe(false);
  });

  it("rejects a token presented against another account's state", () => {
    const token = signPasswordResetToken(subject, NOW, SECRET);

    expect(checkPasswordResetToken(token, { ...subject, id: 'user-2', password: '$2b$12$' + 'b'.repeat(53) }, NOW, SECRET)).toBe(false);
  });

  it('is dead once the password changes (single use)', () => {
    const token = signPasswordResetToken(subject, NOW, SECRET);
    const afterReset = { ...subject, password: '$2b$12$' + 'c'.repeat(53) };

    expect(checkPasswordResetToken(token, afterReset, NOW, SECRET)).toBe(false);
  });

  it('is dead once the email changes', () => {
    const token = signPasswordResetToken(subject, NOW, SECRET);

    expect(checkPasswordResetToken(token, { ...subject, emailHmac: 'z'.repeat(64) }, NOW, SECRET)).toBe(false);
  });

  it('works for an account with no password (Google sign-in), and dies when one is set', () => {
    const google = { ...subject, password: null };
    const token = signPasswordResetToken(google, NOW, SECRET);

    expect(checkPasswordResetToken(token, google, NOW, SECRET)).toBe(true);
    expect(checkPasswordResetToken(token, { ...google, password: '$2b$12$' + 'd'.repeat(53) }, NOW, SECRET)).toBe(false);
  });

  it('is not valid under another secret', () => {
    const token = signPasswordResetToken(subject, NOW, SECRET);

    expect(checkPasswordResetToken(token, subject, NOW, 'another-secret-another-secret-xx')).toBe(false);
  });
});

describe('readPasswordResetToken', () => {
  it('reads the account and expiry from a well-formed token', () => {
    const token = signPasswordResetToken(subject, NOW, SECRET);

    expect(readPasswordResetToken(token)).toEqual(
      expect.objectContaining({ userId: 'user-1', expiresAt: NOW / 1000 + PASSWORD_RESET_TTL_SECONDS }),
    );
  });

  it.each([
    ['empty', ''],
    ['no dot', 'abcdef'],
    ['three parts', 'a.b.c'],
    ['empty parts', '.'],
    ['not base64url', '!!!.???'],
    ['payload without colon', `${Buffer.from('nocolon').toString('base64url')}.${Buffer.from('x').toString('base64url')}`],
    ['non-numeric expiry', `${Buffer.from('soon:user-1').toString('base64url')}.${Buffer.from('x').toString('base64url')}`],
    ['empty user id', `${Buffer.from('1790000000:').toString('base64url')}.${Buffer.from('x').toString('base64url')}`],
    ['absurdly long', 'a'.repeat(5000) + '.' + 'b'.repeat(5000)],
  ])('returns null for malformed input: %s', (_label, token) => {
    expect(readPasswordResetToken(token)).toBeNull();
  });

  it('returns null, never throws, for non-string input', () => {
    expect(readPasswordResetToken(undefined as unknown as string)).toBeNull();
    expect(readPasswordResetToken(42 as unknown as string)).toBeNull();
  });

  it('checkPasswordResetToken is false, never an exception, for malformed input', () => {
    expect(checkPasswordResetToken('garbage', subject, NOW, SECRET)).toBe(false);
    expect(checkPasswordResetToken('a.b', subject, NOW, SECRET)).toBe(false);
  });
});

describe('verifyPasswordResetToken', () => {
  const row = { ...subject, emailVerifiedAt: null };

  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = SECRET;
  });

  it('loads the account and returns it for a valid token', async () => {
    const token = signPasswordResetToken(subject, NOW, SECRET);
    findUser.mockResolvedValue(row);

    const result = await verifyPasswordResetToken(token, new Date(NOW + 5000));

    expect(findUser).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' } }));
    expect(result).toEqual(row);
  });

  it('is null for a malformed token and does not touch the database', async () => {
    expect(await verifyPasswordResetToken('garbage', new Date(NOW))).toBeNull();
    expect(findUser).not.toHaveBeenCalled();
  });

  it('is null for an expired token and does not touch the database', async () => {
    const token = signPasswordResetToken(subject, NOW, SECRET);

    expect(await verifyPasswordResetToken(token, new Date(NOW + 3600_000))).toBeNull();
    expect(findUser).not.toHaveBeenCalled();
  });

  it('is null when the account no longer exists', async () => {
    const token = signPasswordResetToken(subject, NOW, SECRET);
    findUser.mockResolvedValue(null);

    expect(await verifyPasswordResetToken(token, new Date(NOW))).toBeNull();
  });

  it('is null after the password changed', async () => {
    const token = signPasswordResetToken(subject, NOW, SECRET);
    findUser.mockResolvedValue({ ...row, password: '$2b$12$' + 'e'.repeat(53) });

    expect(await verifyPasswordResetToken(token, new Date(NOW))).toBeNull();
  });
});

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
