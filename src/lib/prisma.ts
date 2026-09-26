import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { withContactFieldProtection } from "./field-protection";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const isBuildTime = process.env.DATABASE_URL?.includes('dummy') || !process.env.DATABASE_URL;

// During build time, return a mock that returns empty results
function createBuildTimeMock(): PrismaClient {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      // Allow common utility props
      if (prop === 'then' || prop === 'catch' || prop === '$connect' || prop === '$disconnect') {
        return undefined;
      }
      // Return a model proxy for any model access
      return new Proxy({}, {
        get(_t, method) {
          // All query methods return empty results
          if (method === 'findMany') return async () => [];
          if (method === 'findUnique' || method === 'findFirst') return async () => null;
          if (method === 'count') return async () => 0;
          if (method === 'create' || method === 'update' || method === 'upsert') return async () => ({});
          if (method === 'delete') return async () => ({});
          return async () => null;
        }
      });
    }
  };
  return new Proxy({}, handler) as unknown as PrismaClient;
}

function createPrismaClient(): PrismaClient {
  if (isBuildTime) {
    return createBuildTimeMock();
  }
  const connectionString = process.env.DATABASE_URL!;
  const adapter = new PrismaPg({ connectionString });
  // Every User and BankAccount write also stores the encrypted forms of the
  // contact details (ADR 0012).
  return withContactFieldProtection(new PrismaClient({ adapter }));
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
