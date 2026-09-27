// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import type { AdapterUser } from 'next-auth/adapters';
import { buildAuthAdapter } from './auth-adapter';
import { contactFieldWrites } from './field-protection';
import { readUserEmail, sealUserEmail } from './contact-fields';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * The Auth.js adapter after the contact plaintext columns are gone
 * (prd-compliance 16, the contract step).
 *
 * The adapter is a third party and cannot be told about the schema, and its
 * email lookup was the half the client hook could not reach: it asked for
 * `User.email`, a column the database no longer has, so next-auth threw inside
 * `callback-handler.js` on a Google sign-in by an account that existed already,
 * and a user it did create came back with no address on it. The write side went
 * through the hook and was already right, which is exactly why a unit test that
 * mocked the adapter showed nothing wrong: the mock had both halves.
 *
 * So nothing here mocks the adapter. The real `PrismaAdapter` runs over a double
 * that answers the queries the adapter really makes, and the real
 * `next-auth/core/lib/callback-handler.js` -- the function the Google callback
 * route calls -- runs over the result, which is the sign-in flow as far as it
 * goes without a browser. The double reads its column list out of
 * prisma/schema.prisma and refuses a query naming a column the table does not
 * have, the way Prisma refuses one, so a lookup by the dropped `email` fails
 * here for the reason it fails in production.
 */

type Data = Record<string, unknown>;

/**
 * One model as the schema declares it: the names a `where` or a `data` may use
 * -- the columns, plus the `@@unique([a, b])` names Prisma generates for
 * composites, which is how the adapter looks a linked account up
 * (`provider_providerAccountId`) -- and a matcher that expands a composite name
 * back into its columns.
 *
 * A column the drop removed is genuinely absent from this, so a query naming it
 * is refused the way Prisma refuses one rather than quietly matching nothing.
 */
function modelOf(name: string) {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const start = schema.indexOf(`model ${name} {`);
  expect(start, `model ${name} is missing from prisma/schema.prisma`).toBeGreaterThan(-1);
  const body = schema.slice(start, schema.indexOf('\n}', start));
  const columns = [...body.matchAll(/^ {2}(\w+)\s+\w/gm)].map((match) => match[1]!);
  const composites = new Map(
    [...body.matchAll(/@@unique\(\[([^\]]+)\]/g)].map((match) => {
      const parts = match[1]!.split(',').map((column) => column.trim());
      return [parts.join('_'), parts] as [string, string[]];
    }),
  );

  return {
    /** Prisma's own complaint, so a failure here reads like the production one. */
    reject(operation: string, fields: Data) {
      for (const field of Object.keys(fields)) {
        if (!columns.includes(field) && !composites.has(field)) {
          throw new Error(`Invalid \`prisma.${name}.${operation}()\`: Unknown argument \`${field}\``);
        }
      }
    },
    matches(row: Data, where: Data) {
      return Object.entries(where).every(([field, value]) => {
        const parts = composites.get(field);
        if (!parts) return row[field] === value;
        // A composite is filtered either by a value it was passed whole
        // (`{ provider_providerAccountId: 'x' }`) or by its own columns
        // (`{ provider_providerAccountId: { provider, providerAccountId } }`,
        // which is the shape the adapter uses).
        if (value && typeof value === 'object') {
          return Object.entries(value as Data).every(([column, part]) => row[column] === part);
        }
        return parts.every((column) => row[column] === value);
      });
    },
  };
}

/**
 * The two models the adapter touches, over rows in memory, with the real client
 * hook on the writes -- `contactFieldWrites` is what `withContactFieldProtection`
 * installs -- so a row created here is sealed the way a row created in
 * production is. The tables come back with the client so a test can look at
 * what was actually written.
 */
function prismaDouble(seed: { users?: Data[]; accounts?: Data[] } = {}) {
  const users: Data[] = [...(seed.users ?? [])];
  const accounts: Data[] = [...(seed.accounts ?? [])];
  const user = modelOf('User');
  const account = modelOf('Account');
  const writes = contactFieldWrites() as unknown as Record<
    string,
    Record<string, (params: { args: Data; query: (args: Data) => unknown }) => unknown>
  >;

  const insert = (table: Data[], prefix: string, data: Data) => {
    const row = { id: `${prefix}-${table.length + 1}`, ...data };
    table.push(row);
    return row;
  };

  const client = {
    user: {
      findFirst: async ({ where }: { where: Data }) => {
        user.reject('findFirst', where);
        return users.find((row) => user.matches(row, where)) ?? null;
      },
      findUnique: async ({ where }: { where: Data }) => {
        user.reject('findUnique', where);
        return users.find((row) => user.matches(row, where)) ?? null;
      },
      // The hook rewrites `data` before Prisma would see it, so the refusal
      // happens inside `query` rather than on the way in: that is where the
      // database would reject a column it does not have.
      create: (args: Data) =>
        writes.user.create({
          args,
          query: (a) => {
            user.reject('create', a.data as Data);
            return insert(users, 'u', a.data as Data);
          },
        }),
      update: (args: Data) =>
        writes.user.update({
          args,
          query: (a) => {
            user.reject('update', a.data as Data);
            const row = users.find((candidate) => user.matches(candidate, a.where as Data))!;
            Object.assign(row, a.data as Data);
            return row;
          },
        }),
    },
    account: {
      findUnique: async ({ where, include }: { where: Data; include?: { user?: boolean } }) => {
        account.reject('findUnique', where);
        const found = accounts.find((row) => account.matches(row, where));
        return include?.user && found ? { ...found, user: users.find((row) => row.id === found.userId) } : (found ?? null);
      },
      create: (args: Data) => {
        account.reject('create', args.data as Data);
        return insert(accounts, 'a', args.data as Data);
      },
    },
  };

  return { client: client as unknown as PrismaClient, users, accounts };
}

/**
 * next-auth's own sign-in step, reached the way the Google callback route
 * reaches it: core/routes/callback.js hands the OAuth profile and the provider
 * account straight in. It is a deep import because next-auth's package
 * `exports` does not name it; the path is resolved from the installed package,
 * so it follows whatever version is here.
 */
type CallbackHandler = (params: {
  sessionToken?: string;
  profile: Data;
  account: Data;
  options: Data;
}) => Promise<{ user: AdapterUser; isNewUser: boolean }>;

const require = createRequire(import.meta.url);
const { default: callbackHandler } = require(
  path.join(path.dirname(require.resolve('next-auth')), 'core', 'lib', 'callback-handler.js'),
) as { default: CallbackHandler };

const GOOGLE_ACCOUNT = {
  provider: 'google',
  type: 'oauth',
  providerAccountId: 'google-1234',
  access_token: 'ya29.token',
  token_type: 'Bearer',
  scope: 'openid email profile',
};
const GOOGLE_PROFILE = {
  id: 'google-1234',
  name: 'Andi Wijaya',
  email: 'andi@email.com',
  image: 'https://example.test/andi.png',
};

/** The token core/routes/callback.js builds out of the signed-in user. */
const DEFAULT_TOKEN = (user: AdapterUser) => ({
  name: user.name,
  email: user.email,
  picture: user.image,
  sub: user.id?.toString(),
});

/** One Google sign-in, through the adapter and next-auth's own sign-in step. */
async function signInWithGoogle({ client }: { client: PrismaClient }) {
  return callbackHandler({
    profile: GOOGLE_PROFILE,
    account: GOOGLE_ACCOUNT,
    options: {
      adapter: buildAuthAdapter(client),
      events: {},
      session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
      jwt: {
        secret: 'a-test-secret',
        maxAge: 30 * 24 * 60 * 60,
        encode: async (token: Data) => token,
        decode: async (token: Data) => token,
      },
    },
  });
}

/** A Donor account as the backfill leaves it: sealed, with its HMAC filled. */
function sealedUser(id: string, email: string): Data {
  return { id, name: 'Andi Wijaya', password: 'hash', donationBalance: 0, ...sealUserEmail(email) };
}

describe('a Google sign-in by a Donor whose account already exists', () => {
  it('signs them in, with their address on the token', async () => {
    // A Donor who signed in with Google before this release: the User row is
    // sealed, and the Account row is what links the Google identity to it.
    const { client } = prismaDouble({
      users: [sealedUser('u1', 'andi@email.com')],
      accounts: [{ userId: 'u1', ...GOOGLE_ACCOUNT }],
    });

    const { user, isNewUser } = await signInWithGoogle({ client });

    expect(isNewUser).toBe(false);
    expect(user.id).toBe('u1');
    // What AppShell.tsx and akun/page.tsx render: session.user.email.
    expect(DEFAULT_TOKEN(user).email).toBe('andi@email.com');
  });

  // The step the drop broke. `User.email` is not a column any more, so the
  // adapter's own lookup throws on it -- and the same throw in production is an
  // error on the callback route, before a session exists.
  it('finds the account by its sealed address when the Google identity is not linked yet', async () => {
    const { client } = prismaDouble({ users: [sealedUser('u1', 'andi@email.com')] });

    const found = await buildAuthAdapter(client).getUserByEmail!('Andi@Email.com');

    expect(found?.id).toBe('u1');
    expect(found?.email).toBe('andi@email.com');
  });

  it('does not open a second account on an address that already has one', async () => {
    // next-auth's own rule, now reachable because the lookup works: an address
    // that already has an account cannot become a Google sign-in by accident.
    // Before this release the same refusal happened, because the lookup worked
    // then; what must not happen is a second row.
    const { client, users } = prismaDouble({ users: [sealedUser('u1', 'andi@email.com')] });

    await expect(signInWithGoogle({ client })).rejects.toThrow(/already exists with the same e-mail address/);
    expect(users).toHaveLength(1);
  });
});

describe('a Google sign-in by an address with no account', () => {
  it('creates the account sealed, and signs the new Donor in with their address', async () => {
    const { client, users } = prismaDouble();

    const { user, isNewUser } = await signInWithGoogle({ client });

    expect(isNewUser).toBe(true);
    expect(DEFAULT_TOKEN(user).email).toBe('andi@email.com');

    // `createUser` is handed a NextAuth-shaped user, and `User` has neither
    // `image` nor `emailVerified`: it has `avatar`, and the self-claimed
    // verification is retired. The write has to be mapped rather than passed
    // through, or it names a column the database does not have.
    expect(Object.keys(users[0]!).sort()).toEqual([
      'avatar',
      'emailCiphertext',
      'emailHmac',
      'emailHmacKeyId',
      'emailKeyId',
      'id',
      'name',
    ]);
    expect(users[0]!.avatar).toBe('https://example.test/andi.png');
    expect(readUserEmail(users[0] as never)).toBe('andi@email.com');
  });

  it('signs the same Donor in again through the linked Google account', async () => {
    const db = prismaDouble();
    const created = await signInWithGoogle(db);

    const again = await signInWithGoogle(db);

    expect(again.isNewUser).toBe(false);
    expect(again.user.id).toBe(created.user.id);
    expect(DEFAULT_TOKEN(again.user).email).toBe('andi@email.com');
  });
});
