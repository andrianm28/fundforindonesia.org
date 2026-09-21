import { Role, Assignment } from "@/generated/prisma/client";
import { DefaultSession, DefaultUser } from "next-auth";
import { DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      isVerified: boolean;
      verificationType: string | null;
      assignments: Assignment[];
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    role?: Role;
    isVerified?: boolean;
    verificationType?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id?: string;
    role?: Role;
    isVerified?: boolean;
    verificationType?: string | null;
    assignments?: Assignment[];
  }
}
