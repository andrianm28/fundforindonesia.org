import { NextAuthOptions, getServerSession as nextAuthGetServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { isGoogleConfigured } from "@/lib/auth-providers";
import { hashPassword, verifyPassword } from "@/lib/password-hash";
import { prisma } from "@/lib/prisma";
import { PASSWORD_HASH_COST, isHashAtCurrentCost } from "@/lib/password-hash-cost";
import { Assignment } from "@/generated/prisma/client";
import { buildAuthAdapter } from "@/lib/auth-adapter";
import { isRemoteProviderPicture, providerPicture } from "@/lib/provider-picture";
import { clientAddress } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit-guard";
import { sessionPasswordClaim } from "@/lib/password-reset";
import { lookupUserEmail, readUserEmail, SELECT_USER_EMAIL } from "@/lib/contact-fields";

// Both halves of the adapter need the schema it cannot see: the write goes
// through the hooked client, so an OAuth sign-in's address is sealed on the
// way in, and the read is rewired onto the lookup HMAC, because the plaintext
// column this one used to ask for is gone (ADR 0012, src/lib/auth-adapter.ts).
// Held here as well as on `authOptions` because the `jwt` callback writes the
// provider's picture through it, so `image` <-> `avatar` is mapped in one place.
const adapter = buildAuthAdapter(prisma);

/** Login attempts per window. */
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_PER_ACCOUNT_LIMIT = 10;
const LOGIN_PER_CLIENT_LIMIT = 50;

export const authOptions: NextAuthOptions = {
  adapter: adapter as NextAuthOptions["adapter"],
  providers: [
    // Only when both halves are configured; the login page hides its button
    // when this provider is absent from /api/auth/providers.
    ...(isGoogleConfigured()
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          }),
        ]
      : []),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email dan password harus diisi");
        }

        // Counted before any lookup or hash, every attempt, right or wrong:
        // per client + address (guessing one account) and per client (many
        // accounts). Fail-open, like the other non-mail paths: the lookup
        // below needs the same database, so this only matters when the
        // limiter alone is broken, and that must not lock everyone out.
        const forwarded = req?.headers?.["x-forwarded-for"];
        const headers = new Headers();
        if (typeof forwarded === "string") headers.set("x-forwarded-for", forwarded);
        const client = clientAddress(headers);
        for (const attempt of [
          { scope: "auth-login", subject: `${client}|${credentials.email.trim().toLowerCase()}`, limit: LOGIN_PER_ACCOUNT_LIMIT },
          { scope: "auth-login-client", subject: client, limit: LOGIN_PER_CLIENT_LIMIT },
        ]) {
          const verdict = await checkRateLimit({ ...attempt, windowSeconds: LOGIN_WINDOW_SECONDS, onUnavailable: "open" });
          if (!verdict.ok) throw new Error("Terlalu banyak percobaan masuk. Coba lagi nanti.");
        }

        // Through the HMAC, never a scan over decrypted addresses (ADR 0012):
        // the plaintext email column is gone, and decrypting every account to
        // compare it would be the thing this scheme exists to prevent.
        const user = await prisma.user.findFirst({
          where: lookupUserEmail(credentials.email),
          select: { ...SELECT_USER_EMAIL, id: true, password: true, name: true, avatar: true },
        });

        if (!user || !user.password) {
          throw new Error("Email atau password salah");
        }

        const isPasswordValid = await verifyPassword(
          credentials.password,
          user.password
        );

        if (!isPasswordValid) {
          throw new Error("Email atau password salah");
        }

        // An account whose hash sits below the current factor — because an
        // older password change re-hashed it more weakly, see ADR 0017 — is
        // brought back up here, on the login where we hold the plaintext and
        // without asking the user for anything. The factor is read off the
        // stored hash's own prefix, so this is not a write on the request path:
        // `authorize` runs on an actual sign-in, not per request, and once
        // rewritten the hash reports the current factor and the next login
        // skips this entirely. Best-effort, because failing to upgrade a hash
        // must never cost a user their login.
        if (!isHashAtCurrentCost(user.password)) {
          try {
            const rehashed = await hashPassword(
              credentials.password,
              PASSWORD_HASH_COST
            );
            await prisma.user.update({
              where: { id: user.id },
              data: { password: rehashed },
            });
          } catch (error) {
            console.error("Failed to re-hash password at the current cost:", error);
          }
        }

        const email = readUserEmail(user);
        if (!email) {
          throw new Error("Email atau password salah");
        }

        return {
          id: user.id,
          email,
          name: user.name,
          image: user.avatar,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user, account, profile }) {
      if (user) {
        token.id = user.id;

        // Signing in again with a different picture updates the stored one
        // (ticket 47). A picture the user uploaded here (a local path) is not
        // the provider's to overwrite; only a missing or provider-hosted one is.
        // Best-effort: a failed write must not cost a user their login.
        const incoming = account?.type === "oauth" ? providerPicture(profile) : null;
        const stored = user.image ?? null;
        if (incoming && incoming !== stored && (!stored || isRemoteProviderPicture(stored))) {
          try {
            await adapter.updateUser!({ id: user.id, image: incoming });
            token.picture = incoming;
          } catch (error) {
            console.error(
              "Failed to store the provider's picture:",
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      }

      // Authority comes only from assignments (ADR 0005), read fresh so a
      // grant or revocation takes effect on the next request. The same read
      // carries the stored password so a reset can end old sessions.
      if (token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { password: true, assignments: { select: { assignment: true } } },
        });

        if (dbUser) {
          // A session lasts only as long as the password it was issued under
          // (rilis-1 93): the claim is set at sign-in, and a changed hash ends
          // the session without any stored state. A token from before this
          // claim existed has none and is upgraded to the current one, not
          // ended, so deploying it signs nobody out. A password change from
          // the settings page also ends the session it is made in, which is why
          // that page signs out after it.
          const claim = sessionPasswordClaim(dbUser.password ?? null);
          if (user || token.pwf === undefined) {
            token.pwf = claim;
          } else if (token.pwf !== claim) {
            // Ended: no id and no authority, so the session callback returns
            // nothing and getServerSession is null.
            delete token.id;
            delete token.pwf;
            token.assignments = [];
            return token;
          }
          token.assignments = dbUser.assignments.map((a) => a.assignment);
        }
      }

      return token;
    },
    async session({ session, token }) {
      // The jwt callback ended this session (its password changed). An empty
      // object is what next-auth turns into "no session" for getServerSession
      // and for the client.
      if (!token.id) return {} as typeof session;
      if (session.user) {
        session.user.id = token.id as string;
        session.user.assignments = (token.assignments as Assignment[]) ?? [];
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
};

/**
 * Get the current server session.
 * Use this in Server Components and API routes.
 */
export async function getServerSession() {
  return nextAuthGetServerSession(authOptions);
}

/**
 * Require authentication middleware.
 * Returns the session if authenticated, throws an error otherwise.
 * Use this in API routes that require authentication.
 */
export async function requireAuth() {
  const session = await getServerSession();

  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  return session;
}
