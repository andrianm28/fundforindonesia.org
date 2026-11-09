import { Assignment } from "@/generated/prisma/client";
import type { MfaState } from "@/lib/mfa-gate";
import { DefaultSession } from "next-auth";
import { DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      assignments: Assignment[];
      /** Second-factor state (src/lib/mfa-gate.ts); 'challenge' and 'enroll' mean no authority yet. */
      mfaState?: MfaState;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id?: string;
    assignments?: Assignment[];
    /** Random per sign-in; second-factor proofs are bound to it. */
    sid?: string;
    /** The enrolment (UserMfa.enabledAt, ms) this session proved a code for. */
    mfaEnabledAt?: number;
    mfaState?: MfaState;
  }
}
