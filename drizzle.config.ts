import { defineConfig } from "drizzle-kit";

// Drizzle reads the schema; it never writes it. prisma/migrations stays the
// only way the database changes until ticket 09 (ADR 0029), so there is no
// `out` folder of Drizzle migrations and `push`/`generate` are not used.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  schemaFilter: ["public"],
  tablesFilter: ["!_prisma_migrations"],
  casing: undefined,
});
