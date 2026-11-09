import { randomInt } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { lookupUserEmail } from '../../src/lib/contact-fields';
import { hashLoginCode } from '../../src/lib/login-code-hash';

/**
 * Signs an Admin or Verifier in the only way the app allows them: by mailed
 * code (ADR 0026; the password form refuses operators). There is no mailbox in
 * CI, so the helper plays the mail's part: it writes a fresh code for the
 * account straight into the throwaway database, hashed exactly as the server
 * checks it, and then signs in through NextAuth's own `email-otp` endpoint.
 * Everything after the code (verification, spending it, the session) is the
 * real path.
 *
 * Throwaway databases only, like the seed (tests/e2e/seed-e2e.ts).
 */

let prisma: PrismaClient | undefined;

function db(): PrismaClient {
  if (process.env.E2E_THROWAWAY_DATABASE !== '1') {
    throw new Error('operator-sign-in refuses to run without E2E_THROWAWAY_DATABASE=1 (throwaway databases only).');
  }
  const host = new URL(process.env.DATABASE_URL ?? 'postgresql://unset').hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    throw new Error(`operator-sign-in refuses DATABASE_URL host ${JSON.stringify(host)}: local databases only.`);
  }
  prisma ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  return prisma;
}

export async function signInByCode(page: Page, email: string): Promise<void> {
  const client = db();
  const user = await client.user.findFirst({ where: lookupUserEmail(email), select: { id: true, emailHmac: true } });
  if (!user) throw new Error(`no seeded account for ${email}`);

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const now = new Date();
  await client.$transaction([
    client.loginCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
    client.loginCode.create({
      data: {
        userId: user.id,
        codeHash: hashLoginCode(user.id, code),
        emailHmac: user.emailHmac,
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      },
    }),
  ]);

  const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
  const signedIn = await page.request.post('/api/auth/callback/email-otp', {
    form: { csrfToken, email, code, json: 'true' },
  });
  expect(signedIn.ok()).toBe(true);
  const session = await (await page.request.get('/api/auth/session')).json();
  expect(session.user?.email).toBe(email);
}
