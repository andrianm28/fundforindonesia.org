import { NextAuthOptions, getServerSession as nextAuthGetServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { hashPassword, verifyPassword } from "@/lib/password-hash";
import { prisma } from "@/lib/prisma";
import { PASSWORD_HASH_COST, isHashAtCurrentCost } from "@/lib/password-hash-cost";
import { Assignment } from "@/generated/prisma/client";
import { buildAuthAdapter } from "@/lib/auth-adapter";
import { isRemoteProviderPicture, providerPicture } from "@/lib/provider-picture";
import { lookupUserEmail, readUserEmail, SELECT_USER_EMAIL } from "@/lib/contact-fields";

// Both halves of the adapter need the schema it cannot see: the write goes
// through the hooked client, so an OAuth sign-in's address is sealed on the
// way in, and the read is rewired onto the lookup HMAC, because the plaintext
// column this one used to ask for is gone (ADR 0012, src/lib/auth-adapter.ts).
// Held here as well as on `authOptions` because the `jwt` callback writes the
// provider's picture through it, so `image` <-> `avatar` is mapped in one place.
const adapter = buildAuthAdapter(prisma);

export const authOptions: NextAuthOptions = {
  adapter: adapter as NextAuthOptions["adapter"],
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email dan password harus diisi");
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
      // grant or revocation takes effect on the next request.
      if (token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { assignments: { select: { assignment: true } } },
        });

        if (dbUser) {
          token.assignments = dbUser.assignments.map((a) => a.assignment);
        }
      }

      return token;
    },
    async session({ session, token }) {
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
