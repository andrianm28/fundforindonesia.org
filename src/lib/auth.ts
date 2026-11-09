import { NextAuthOptions, getServerSession as nextAuthGetServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { isGoogleConfigured } from "@/lib/auth-providers";
import { prisma } from "@/lib/prisma";
import { Assignment } from "@/generated/prisma/client";
import { buildAuthAdapter } from "@/lib/auth-adapter";
import { isRemoteProviderPicture, providerPicture } from "@/lib/provider-picture";
import { clientAddress } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit-guard";
import { sessionPasswordClaim } from "@/lib/password-reset";
import { verifyLoginCode } from "@/lib/login-code";

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

/** The caller's address as the limiter counts it, read off the request next-auth hands `authorize`. */
function requestClient(req: { headers?: Record<string, unknown> } | undefined): string {
  const forwarded = req?.headers?.["x-forwarded-for"];
  const headers = new Headers();
  if (typeof forwarded === "string") headers.set("x-forwarded-for", forwarded);
  return clientAddress(headers);
}

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
    // Sign-in with a code mailed to the address (login OTP,
    // src/lib/login-code.ts). The code is spent and its guesses counted in
    // the database; the limits here bound guessing across many fresh codes.
    // Fail-open: the per-code limit still holds when only the limiter is down.
    CredentialsProvider({
      id: "email-otp",
      name: "email-otp",
      credentials: {
        email: { label: "Email", type: "email" },
        code: { label: "Kode", type: "text" },
      },
      async authorize(credentials, req) {
        const email = credentials?.email?.trim();
        if (!email || !credentials?.code) {
          throw new Error("Email dan kode harus diisi");
        }

        const client = requestClient(req);
        for (const attempt of [
          { scope: "auth-login-code", subject: `${client}|${email.toLowerCase()}`, limit: LOGIN_PER_ACCOUNT_LIMIT },
          { scope: "auth-login-code-client", subject: client, limit: LOGIN_PER_CLIENT_LIMIT },
        ]) {
          const verdict = await checkRateLimit({ ...attempt, windowSeconds: LOGIN_WINDOW_SECONDS, onUnavailable: "open" });
          if (!verdict.ok) throw new Error("Terlalu banyak percobaan masuk. Coba lagi nanti.");
        }

        const user = await verifyLoginCode(email, credentials.code);
        if (!user) throw new Error("Kode salah atau sudah tidak berlaku");
        return user;
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    // Google would walk around the operator code requirement, so
    // an existing account holding any Assignment is sent back to /login. A
    // first Google sign-in has no row yet, and so no Assignment.
    async signIn({ user, account }) {
      if (account?.provider !== "google" || !user?.id) return true;
      const row = await prisma.user.findUnique({
        where: { id: user.id },
        select: { assignments: { select: { assignment: true } } },
      });
      return row?.assignments.length ? "/login?error=OperatorCodeOnly" : true;
    },
    async jwt({ token, user, account, profile }) {
      if (user) {
        token.id = user.id;
        // How this session was signed in; read below, every request.
        token.amr = account?.provider;

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
          // ended, so deploying it signs nobody out. The stored hash is only ever
          // changed outside the app now (there is no password sign-in or change).
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
          // Operator authority needs a session signed in by mailed code (the
          // code stands in for MFA; ADR 0026). Refusing Google
          // at sign-in is not enough on its own: an Assignment granted to an
          // account while its password session is live, or a session from
          // before this rule, would carry authority without a code. Such a
          // session keeps working as an ordinary account and gets no
          // authority; signing in again by code brings it.
          token.assignments =
            token.amr === "email-otp" ? dbUser.assignments.map((a) => a.assignment) : [];
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
