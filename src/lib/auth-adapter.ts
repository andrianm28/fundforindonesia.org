import { PrismaAdapter } from '@auth/prisma-adapter';
import type { Adapter, AdapterUser } from 'next-auth/adapters';
import type { PrismaClient } from '@/generated/prisma/client';
import { lookupUserEmail, readUserEmail } from './contact-fields';

/**
 * The Auth.js adapter, rewired for the contact plaintext columns that are gone
 * (prd-compliance 16, the contract step).
 *
 * The adapter is a third party and cannot be told about the schema, so it kept
 * asking for a column the database no longer has: `getUserByEmail` ran
 * `user.findUnique({ where: { email } })` and Prisma refused the argument. In a
 * Google sign-in that is `callback-handler.js` throwing before any session
 * exists, and a user it managed to create came back with no address on it, so
 * `token.email` was undefined and the AppShell and the account page rendered an
 * empty one. The write side was already right -- the client hook in
 * src/lib/field-protection.ts seals whatever the adapter hands it -- so the two
 * halves needed different work, and only one of them had had any.
 *
 * What this does, both of it the same contract the rest of the application
 * follows (ADR 0012):
 *
 * - **Find by the lookup HMAC, never by the address.** `lookupUserEmail` is the
 *   same filter src/app/api/auth/register uses for its duplicate check, so a
 *   Donor can register with an address and then sign in with it through Google,
 *   and the case-insensitive match the HMAC gives is the match the account was
 *   created under. No scan over decrypted addresses: that is the thing the
 *   scheme exists to prevent.
 * - **Hand next-auth an address it can put on the token.** The user object the
 *   adapter returns is what `core/routes/callback.js` reads `user.email` from,
 *   and the row has only a ciphertext. Every user-returning method decrypts the
 *   one field next-auth asks for and leaves the rest of the row as the adapter
 *   returned it, so the AppShell and akun/page.tsx show the Donor's own address
 *   again. Without this the session is silently anonymous, which is a worse
 *   failure than a refused sign-in and much harder to notice.
 *
 * `createUser` is mapped as well, because the shape it is handed is NextAuth's
 * and not Prisma's: `User` has `avatar` rather than `image`, and the
 * self-claimed `emailVerified` is retired (retire-role-hierarchy). Passed
 * through unchanged they name columns the database does not have, so a first
 * Google sign-in failed on the create. The address is passed as `email` and
 * sealed by the client hook, exactly as it is everywhere else.
 */

/** A User row as the adapter sees it now: sealed columns, no plaintext. */
type SealedUser = { id: string; name: string; emailCiphertext: string; emailKeyId: string };

/**
 * The adapter methods this module calls. `Adapter` declares them all optional --
 * a deployment may have no database sessions at all -- and PrismaAdapter
 * implements every one of these, so the calls below are not the optional kind.
 */
type AdapterUserMethods = Required<
  Pick<Adapter, 'getUser' | 'getUserByEmail' | 'getUserByAccount' | 'updateUser' | 'createUser'>
>;

/**
 * The row with its address decrypted, for the one field next-auth reads it in
 * (core/routes/callback.js builds the token from `user.email`). A row that
 * cannot be read is a row that cannot be signed in as, and `readUserEmail`
 * raises rather than returning a half-account.
 *
 * `known` is for the one method that has the address in hand anyway --
 * `createUser`, where the caller has just said it and this module has just
 * sealed it. It is used there so a session can never be anonymous because a
 * write went somewhere unexpected: the failure this module exists to prevent
 * is an empty address, not a wrong one.
 */
function withAddress(user: SealedUser, known?: string): AdapterUser {
  return { ...user, email: known ?? readUserEmail(user) } as unknown as AdapterUser;
}

export function buildAuthAdapter(prisma: PrismaClient): Adapter {
  const base = PrismaAdapter(prisma) as AdapterUserMethods;
  const createUser = base.createUser as unknown as (data: Record<string, unknown>) => Promise<SealedUser>;

  return {
    ...base,

    async getUserByEmail(email) {
      const user = await prisma.user.findFirst({ where: lookupUserEmail(email) });
      return user ? withAddress(user as unknown as SealedUser) : null;
    },

    async getUser(id) {
      const user = await base.getUser(id);
      return user ? withAddress(user as unknown as SealedUser) : null;
    },

    async getUserByAccount(providerAndAccountId) {
      const user = await base.getUserByAccount(providerAndAccountId);
      return user ? withAddress(user as unknown as SealedUser) : null;
    },

    async updateUser(user) {
      const updated = await base.updateUser(user);
      return withAddress(updated as unknown as SealedUser);
    },

    async createUser(user: Omit<AdapterUser, 'id'>) {
      // Prisma's own shape, not NextAuth's: `avatar` rather than `image`, and
      // no `emailVerified` (retire-role-hierarchy). The address goes in as
      // `email` so the client hook seals it, which is the only place a write of
      // a contact detail is allowed to happen through.
      const created = await createUser({ name: user.name, email: user.email, avatar: user.image ?? null });
      return withAddress(created, user.email);
    },
  };
}
