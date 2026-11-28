import { Pool } from "pg";

/**
 * The one Postgres pool of a process (ADR 0029). Prisma (through
 * @prisma/adapter-pg) and Drizzle both draw from it during the migration, so
 * moving a call site from one to the other does not double the connections.
 * Cached on globalThis for the same reason src/lib/prisma.ts caches its client:
 * src/proxy.ts runs in its own module graph in production.
 */
const globalForPool = globalThis as unknown as { pgPool: Pool | undefined };

/** No real database: `next build` (a dummy URL) and unit tests (none). */
export const isBuildTime =
  process.env.DATABASE_URL?.includes("dummy") || !process.env.DATABASE_URL;

export function getPool(): Pool {
  if (!globalForPool.pgPool) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    // An idle client that loses its connection (a Postgres restart, a network
    // blip) emits 'error' on the pool; unhandled, that would crash the process.
    // The client is discarded and the next query opens a fresh one.
    pool.on("error", (error) => {
      console.error(JSON.stringify({ event: "db_pool_idle_client_error", message: error.message }));
    });
    globalForPool.pgPool = pool;
  }
  return globalForPool.pgPool;
}
