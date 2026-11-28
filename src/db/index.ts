import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import * as relations from "./relations";
import { getPool, isBuildTime } from "./pool";

const fullSchema = { ...schema, ...relations };
export type Database = NodePgDatabase<typeof fullSchema>;

const globalForDb = globalThis as unknown as { db: Database | undefined };

/**
 * Build-time stand-in, the Drizzle twin of the Prisma mock in
 * src/lib/prisma.ts: every query builder chain resolves to no rows, and
 * `transaction` runs its callback against the same stand-in. Prerendered pages
 * therefore build without a database, exactly as they do with Prisma.
 */
function createBuildTimeMock(): Database {
  const chain: object = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (rows: unknown[]) => unknown) => resolve([]);
      }
      if (prop === "transaction") {
        return async (fn: (tx: unknown) => unknown) => fn(chain);
      }
      return chain;
    },
    apply() {
      return chain;
    },
  });
  return chain as Database;
}

function createDb(): Database {
  if (isBuildTime) return createBuildTimeMock();
  return drizzle({ client: getPool(), schema: fullSchema });
}

export const db = globalForDb.db ?? createDb();
globalForDb.db = db;

export { schema };
